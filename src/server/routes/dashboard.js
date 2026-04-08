import { Router } from "express";
import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getAccount, getOpenPositions } from "../../execution/alpacaTrading.js";
import { config } from "../../config/env.js";

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const STORAGE = resolve(__dirname, "../../../storage");

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function todayDate() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function getTodayCycles() {
  return readJson(resolve(STORAGE, "logs", `${todayDate()}.json`)) ?? [];
}

function getTodayJournal() {
  return readJson(resolve(STORAGE, "journal", `${todayDate()}.json`)) ?? [];
}

function getTodayDecisions() {
  return readJson(resolve(STORAGE, "decisions", `${todayDate()}.json`)) ?? [];
}

function getAllJournal() {
  const dir = resolve(STORAGE, "journal");
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();
  const entries = [];
  for (const file of files) {
    const data = readJson(resolve(dir, file));
    if (Array.isArray(data)) entries.push(...data);
  }
  return entries;
}

function deriveBotStatus(cycles) {
  const last = [...cycles].reverse().find((c) => c.type === "completed");
  if (!last) return { botStatus: "idle", lastCycleAt: null };
  const diffMs = Date.now() - new Date(last.timestamp).getTime();
  return {
    botStatus: diffMs < 25 * 60 * 1000 ? "active" : "idle",
    lastCycleAt: last.timestamp,
  };
}

function formatAssetClass(raw) {
  if (!raw) return raw;
  const lower = raw.toLowerCase();
  if (lower === "us_equity" || lower === "stock") return "Stock";
  if (lower === "crypto") return "Crypto";
  return raw;
}

// GET /api/dashboard/status
router.get("/status", (req, res) => {
  const cycles = getTodayCycles();
  const { botStatus, lastCycleAt } = deriveBotStatus(cycles);

  // Determine richer status label
  let statusLabel = botStatus;
  const runMode = config.trading.runMode;
  const dryRun = config.trading.dryRun;

  if (botStatus === "active") {
    statusLabel = dryRun ? "Dry Run" : runMode === "paper" ? "Paper Trading" : "Running";
  } else {
    // Check if last cycle was recent enough to be "waiting for next cycle"
    if (lastCycleAt) {
      const diffMs = Date.now() - new Date(lastCycleAt).getTime();
      statusLabel = diffMs < 20 * 60 * 1000 ? "Waiting for next cycle" : "Idle";
    } else {
      statusLabel = "Idle";
    }
  }

  res.json({
    botStatus,
    statusLabel,
    lastCycleAt,
    runMode,
    dryRun: !!dryRun,
  });
});

// GET /api/dashboard/summary
router.get("/summary", async (req, res) => {
  try {
    const cycles = getTodayCycles();
    const journal = getTodayJournal();
    const riskState = readJson(resolve(STORAGE, "riskState.json")) ?? {};
    const lastCompleted = [...cycles].reverse().find((c) => c.type === "completed");
    const { botStatus, lastCycleAt } = deriveBotStatus(cycles);

    let account = null;
    let openPositions = [];
    try {
      [account, openPositions] = await Promise.all([getAccount(), getOpenPositions()]);
    } catch {
      // Alpaca unreachable — return what we have from files
    }

    const realizedPnl = journal.reduce((sum, e) => sum + (e.pnl ?? 0), 0);
    const unrealizedPnl = openPositions.reduce(
      (sum, p) => sum + parseFloat(p.unrealized_pl ?? 0),
      0
    );
    const ordersPlacedToday = journal.filter(
      (e) => e.orderStatus === "filled" || e.orderStatus === "pending"
    ).length;

    res.json({
      botStatus,
      lastCycleTime: lastCycleAt,
      symbolsScanned: lastCompleted?.scanned ?? 0,
      approvedSignals: lastCompleted?.approved ?? 0,
      ordersPlacedToday,
      openPositionsCount: openPositions.length,
      realizedPnl,
      unrealizedPnl,
      dailyPnl: realizedPnl + unrealizedPnl,
      equity: account ? parseFloat(account.equity) : null,
      portfolioValue: account ? parseFloat(account.portfolio_value) : null,
      dailyRealizedLoss: riskState.dailyRealizedLoss ?? 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/cycles/latest
router.get("/cycles/latest", (req, res) => {
  const cycles = getTodayCycles();
  const completedIndexes = cycles
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.type === "completed");

  if (!completedIndexes.length) return res.json(null);

  const { c: latest, i: latestIndex } = completedIndexes[completedIndexes.length - 1];
  const startEvent = latestIndex > 0 ? cycles[latestIndex - 1] : null;

  const startTime = startEvent?.recordedAt ?? null;
  const endTime = latest.recordedAt ?? null;
  let durationMs = null;
  if (startTime && endTime) {
    durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();
  }

  res.json({
    startTime,
    endTime,
    durationMs,
    scanned: latest.scanned ?? 0,
    approved: latest.approved ?? 0,
    rejected: (latest.scanned ?? 0) - (latest.approved ?? 0),
    placed: latest.placed ?? 0,
    errors: latest.errors ?? 0,
    timestamp: latest.timestamp,
  });
});

// GET /api/dashboard/decisions
router.get("/decisions", (req, res) => {
  const decisions = getTodayDecisions();
  const mapped = decisions.map((d) => ({
    timestamp: d.timestamp,
    symbol: d.symbol,
    assetClass: formatAssetClass(d.assetClass),
    decision: d.approved ? "Approved" : "Rejected",
    reason: d.reason,
    closePrice: d.closePrice,
    breakoutLevel: d.breakoutLevel,
    atr: d.atr,
    volumeRatio: d.volumeRatio,
  }));
  // Most recent first
  mapped.reverse();
  res.json(mapped);
});

// GET /api/dashboard/signals
router.get("/signals", (req, res) => {
  const journal = getTodayJournal();
  const signals = journal.map((e) => ({
    symbol: e.symbol,
    assetClass: formatAssetClass(e.assetClass),
    decision: e.orderStatus === "dry_run" ? "approved (dry)" : "approved",
    reason: e.approvalReason,
    entryPrice: e.entryPricePlanned,
    stopLoss: e.stopLoss,
    takeProfit: e.takeProfit,
    quantity: e.quantity,
    orderStatus: e.orderStatus,
    signalTime: e.signalTime,
    recordedAt: e.recordedAt,
  }));
  res.json(signals);
});

// GET /api/dashboard/positions/open
router.get("/positions/open", async (req, res) => {
  try {
    const positions = await getOpenPositions();
    const journal = getTodayJournal();

    // Build a lookup from journal for stop/target/risk/strategy/openedAt
    const journalLookup = {};
    for (const e of journal) {
      journalLookup[e.symbol] = e;
    }

    const mapped = positions.map((p) => {
      const je = journalLookup[p.symbol] ?? null;
      return {
        symbol: p.symbol,
        assetClass: formatAssetClass(p.asset_class),
        qty: parseFloat(p.qty),
        entryPrice: parseFloat(p.avg_entry_price),
        currentPrice: parseFloat(p.current_price),
        marketValue: parseFloat(p.market_value),
        unrealizedPnl: parseFloat(p.unrealized_pl),
        unrealizedPnlPct: parseFloat(p.unrealized_plpc) * 100,
        side: p.side,
        stopLoss: je?.stopLoss ?? null,
        takeProfit: je?.takeProfit ?? null,
        openedAt: je?.signalTime ?? je?.recordedAt ?? null,
        riskAmount: je?.riskAmount ?? null,
        strategyName: je?.strategyName ?? null,
      };
    });
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/positions/closed
router.get("/positions/closed", (req, res) => {
  const closed = getAllJournal()
    .filter((e) => e.exitPrice != null)
    .map((e) => ({
      symbol: e.symbol,
      assetClass: formatAssetClass(e.assetClass),
      entryPrice: e.entryPriceFilled ?? e.entryPricePlanned,
      exitPrice: e.exitPrice,
      quantity: e.quantity,
      pnl: e.pnl,
      exitReason: e.exitReason,
      signalTime: e.signalTime,
      recordedAt: e.recordedAt,
    }))
    .sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt))
    .slice(0, 100);

  res.json(closed);
});

// GET /api/dashboard/performance
router.get("/performance", (req, res) => {
  const closed = getAllJournal().filter((e) => e.pnl != null);

  const totalTrades = closed.length;
  const winners = closed.filter((e) => e.pnl > 0);
  const losers = closed.filter((e) => e.pnl < 0);
  const totalPnl = closed.reduce((sum, e) => sum + e.pnl, 0);
  const winRate = totalTrades ? (winners.length / totalTrades) * 100 : 0;
  const avgWin = winners.length
    ? winners.reduce((s, e) => s + e.pnl, 0) / winners.length
    : 0;
  const avgLoss = losers.length
    ? losers.reduce((s, e) => s + e.pnl, 0) / losers.length
    : 0;

  const byDate = {};
  for (const e of closed) {
    const date = (e.recordedAt ?? e.signalTime ?? "").slice(0, 10);
    if (!date) continue;
    byDate[date] = (byDate[date] ?? 0) + e.pnl;
  }
  const dailyPnl = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, pnl]) => ({ date, pnl }));

  res.json({ totalTrades, winners: winners.length, losers: losers.length, totalPnl, winRate, avgWin, avgLoss, dailyPnl });
});

// GET /api/dashboard/activity
router.get("/activity", (req, res) => {
  const cycles = getTodayCycles();
  const journal = getTodayJournal();
  const decisions = getTodayDecisions();
  const events = [];

  for (const c of cycles) {
    if (c.type === "completed") {
      events.push({
        type: "cycle_complete",
        label: `Cycle complete — scanned ${c.scanned}, approved ${c.approved}, placed ${c.placed}`,
        timestamp: c.recordedAt ?? c.timestamp,
      });
    } else if (c.type === "skipped") {
      events.push({
        type: "skipped",
        label: `Cycle skipped — ${c.reason}`,
        timestamp: c.recordedAt ?? c.timestamp,
      });
    }
  }

  for (const d of decisions) {
    if (d.approved) {
      events.push({
        type: "approved",
        label: `Strategy approved — ${d.symbol} (${formatAssetClass(d.assetClass)}) @ ${d.closePrice ?? "—"}`,
        timestamp: d.timestamp,
      });
    } else {
      events.push({
        type: "rejected",
        label: `Strategy rejected — ${d.symbol}: ${d.reason}`,
        timestamp: d.timestamp,
      });
    }
  }

  for (const e of journal) {
    if (e.orderStatus === "filled") {
      events.push({
        type: "order_filled",
        label: `Order filled — ${e.symbol} qty ${e.quantity} @ ${e.entryPriceFilled ?? e.entryPricePlanned}`,
        timestamp: e.recordedAt,
      });
    } else if (e.orderStatus === "failed") {
      events.push({
        type: "order_failed",
        label: `Order failed — ${e.symbol}`,
        timestamp: e.recordedAt,
      });
    } else if (e.orderStatus === "dry_run") {
      events.push({
        type: "dry_run",
        label: `Dry run — ${e.symbol} would place qty ${e.quantity} @ ${e.entryPricePlanned}`,
        timestamp: e.recordedAt,
      });
    }
  }

  events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  res.json(events.slice(0, 100));
});

export default router;
