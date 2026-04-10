import { Router } from "express";
import { getAccount, getOpenPositions } from "../../execution/alpacaTrading.js";
import { config } from "../../config/env.js";
import { loadDecisionLog } from "../../journal/decisionLogger.js";
import {
  getOpenTrades,
  getClosedTrades,
  getTradeEvents,
} from "../../journal/tradeJournal.js";
import { getCyclesForDate } from "../../repositories/cycleRepo.mongo.js";
import { getTradeEventsForDate } from "../../repositories/tradeJournalRepo.mongo.js";
import { loadRiskState } from "../../risk/riskState.js";
import { normalizeSymbol } from "../../utils/symbolNorm.js";
import { logger } from "../../utils/logger.js";
import { etDateString } from "../../utils/time.js";

const router = Router();

function shouldUseDecisionFallback(value) {
  if (value == null) return true;
  const normalized = String(value).trim().toLowerCase();
  return !["0", "false", "no", "none", "off"].includes(normalized);
}

async function getTodayCycles() {
  return getCyclesForDate(etDateString());
}

async function getTodayJournal() {
  return getTradeEventsForDate(etDateString());
}

async function getDecisionLogForToday({ fallbackToLatest = false } = {}) {
  return loadDecisionLog({ date: etDateString(), fallbackToLatest });
}

async function getAllJournal() {
  const events = await getTradeEvents();
  return events;
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

function normalizeOpenTradeForApi(trade, livePosition, orphaned = false) {
  const quantity = trade?.quantity ?? (livePosition ? parseFloat(livePosition.qty) : null);
  const entryPrice = trade?.entryPrice ?? (livePosition ? parseFloat(livePosition.avg_entry_price) : null);
  const currentPrice =
    livePosition?.current_price != null
      ? parseFloat(livePosition.current_price)
      : trade?.currentPrice ?? null;

  const unrealizedPnl =
    livePosition?.unrealized_pl != null
      ? parseFloat(livePosition.unrealized_pl)
      : trade?.unrealizedPnl ?? null;

  const unrealizedPnlPct =
    livePosition?.unrealized_plpc != null
      ? parseFloat(livePosition.unrealized_plpc) * 100
      : trade?.unrealizedPnlPct ?? null;

  const marketValue =
    livePosition?.market_value != null
      ? parseFloat(livePosition.market_value)
      : typeof currentPrice === "number" && typeof quantity === "number"
      ? currentPrice * quantity
      : null;

  return {
    tradeId: trade?.tradeId ?? null,
    symbol: livePosition?.symbol ?? trade?.symbol ?? null,
    normalizedSymbol: trade?.normalizedSymbol ?? null,
    assetClass: formatAssetClass(livePosition?.asset_class ?? trade?.assetClass) ?? null,
    strategyName: trade?.strategyName ?? null,
    side: livePosition?.side ?? trade?.side ?? "long",
    quantity,
    entryPrice,
    currentPrice,
    stopLoss: trade?.stopLoss ?? null,
    takeProfit: trade?.takeProfit ?? null,
    riskAmount: trade?.plannedRiskAmount ?? trade?.riskAmount ?? null,
    riskPerUnit: trade?.riskPerUnit ?? null,
    marketValue,
    unrealizedPnl,
    unrealizedPnlPct,
    openedAt: trade?.openedAt ?? null,
    status: trade?.status ?? (orphaned ? "orphaned" : "open"),
    orphaned,
    metrics: trade?.metrics ?? {},
  };
}

function normalizeClosedTradeForApi(trade) {
  return {
    tradeId: trade.tradeId ?? null,
    symbol: trade.symbol ?? null,
    normalizedSymbol: trade.normalizedSymbol ?? null,
    assetClass: formatAssetClass(trade.assetClass) ?? null,
    strategyName: trade.strategyName ?? null,
    quantity: trade.quantity ?? null,
    entryPrice: trade.entryPrice ?? null,
    exitPrice: trade.exitPrice ?? null,
    stopLoss: trade.stopLoss ?? null,
    takeProfit: trade.takeProfit ?? null,
    riskAmount: trade.riskAmount ?? null,
    pnl: trade.pnl ?? null,
    pnlPct: trade.pnlPct ?? null,
    exitReason: trade.exitReason ?? null,
    openedAt: trade.openedAt ?? null,
    closedAt: trade.closedAt ?? null,
    status: trade.status ?? "closed",
    metrics: trade.metrics ?? {},
  };
}

// GET /api/dashboard/status
router.get("/status", async (req, res) => {
  try {
    const cycles = await getTodayCycles();
    const { botStatus, lastCycleAt } = deriveBotStatus(cycles);

    let statusLabel = botStatus;
    const runMode = config.trading.runMode;
    const dryRun = config.trading.dryRun;

    if (botStatus === "active") {
      statusLabel = dryRun ? "Dry Run" : runMode === "paper" ? "Paper Trading" : "Running";
    } else {
      if (lastCycleAt) {
        const diffMs = Date.now() - new Date(lastCycleAt).getTime();
        statusLabel = diffMs < 20 * 60 * 1000 ? "Waiting for next cycle" : "Idle";
      } else {
        statusLabel = "Idle";
      }
    }

    res.json({ botStatus, statusLabel, lastCycleAt, runMode, dryRun: !!dryRun });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/summary
router.get("/summary", async (req, res) => {
  try {
    const [cycles, journal, riskState] = await Promise.all([
      getTodayCycles(),
      getTodayJournal(),
      loadRiskState(),
    ]);
    const lastCompleted = [...cycles].reverse().find((c) => c.type === "completed");
    const { botStatus, lastCycleAt } = deriveBotStatus(cycles);

    let account = null;
    let openPositions = [];
    try {
      [account, openPositions] = await Promise.all([getAccount(), getOpenPositions()]);
    } catch {
      // Alpaca unreachable — return what we have
    }

    const realizedPnl = journal.reduce((sum, e) => sum + (e.pnl ?? 0), 0);
    const unrealizedPnl = openPositions.reduce(
      (sum, p) => sum + parseFloat(p.unrealized_pl ?? 0),
      0,
    );
    const ordersPlacedToday = journal.filter(
      (e) => e.orderStatus === "filled" || e.orderStatus === "pending",
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
router.get("/cycles/latest", async (req, res) => {
  try {
    const cycles = await getTodayCycles();
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/decisions
router.get("/decisions", async (req, res) => {
  try {
    const decisionLog = await getDecisionLogForToday({
      fallbackToLatest: shouldUseDecisionFallback(req.query.fallbackLatest ?? req.query.fallback),
    });

    if (decisionLog.isFallback) {
      logger.info("Dashboard decisions using latest available record", {
        requestedDate: decisionLog.requestedDate,
        servedDate: decisionLog.date,
      });
    }

    const mapped = decisionLog.records.map((d) => ({
      timestamp: d.timestamp,
      symbol: d.symbol,
      assetClass: formatAssetClass(d.assetClass),
      decision: d.approved ? "Approved" : "Rejected",
      strategyName: d.strategyName ?? null,
      reason: d.reason,
      closePrice: d.metrics?.closePrice ?? d.closePrice ?? null,
      breakoutLevel: d.metrics?.breakoutLevel ?? d.breakoutLevel ?? null,
      atr: d.metrics?.atr ?? d.atr ?? null,
      volumeRatio: d.metrics?.volumeRatio ?? d.volumeRatio ?? null,
      distanceToBreakoutPct: d.metrics?.distanceToBreakoutPct ?? d.distanceToBreakoutPct ?? null,
      entryPrice: d.entryPrice ?? null,
      stopLoss: d.stopLoss ?? null,
      takeProfit: d.takeProfit ?? null,
      quantity: d.quantity ?? null,
      riskAmount: d.riskAmount ?? null,
    }));

    mapped.reverse();
    res.set("X-Decisions-Date", decisionLog.date);
    res.set("X-Decisions-Fallback", decisionLog.isFallback ? "true" : "false");
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/signals
router.get("/signals", async (req, res) => {
  try {
    const journal = await getTodayJournal();
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/positions/open
router.get("/positions/open", async (req, res) => {
  try {
    const [positions, openTrades] = await Promise.all([getOpenPositions(), getOpenTrades()]);

    const tradesByNorm = {};
    for (const t of openTrades) {
      if (t.status === "canceled") continue;
      const key = t.normalizedSymbol;
      if (!tradesByNorm[key]) tradesByNorm[key] = [];
      tradesByNorm[key].push(t);
    }

    const mapped = positions.map((p) => {
      const normalized = normalizeSymbol(p.symbol);
      const matchingTrades = tradesByNorm[normalized] ?? [];
      let trade = null;
      let orphaned = false;

      if (matchingTrades.length === 1) {
        trade = matchingTrades[0];
      } else if (matchingTrades.length > 1) {
        orphaned = true;
        logger.warn("Ambiguous journal match for broker position — marking orphaned", {
          symbol: p.symbol,
          matchCount: matchingTrades.length,
        });
      } else {
        orphaned = true;
      }

      return normalizeOpenTradeForApi(trade, p, orphaned);
    });

    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/positions/closed
router.get("/positions/closed", async (req, res) => {
  try {
    const closed = (await getClosedTrades())
      .map(normalizeClosedTradeForApi)
      .sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt))
      .slice(0, 100);
    res.json(closed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/performance
router.get("/performance", async (req, res) => {
  try {
    const all = await getAllJournal();
    const closed = all.filter((e) => e.pnl != null);

    const totalTrades = closed.length;
    const winners = closed.filter((e) => e.pnl > 0);
    const losers = closed.filter((e) => e.pnl < 0);
    const totalPnl = closed.reduce((sum, e) => sum + e.pnl, 0);
    const winRate = totalTrades ? (winners.length / totalTrades) * 100 : 0;
    const avgWin = winners.length ? winners.reduce((s, e) => s + e.pnl, 0) / winners.length : 0;
    const avgLoss = losers.length ? losers.reduce((s, e) => s + e.pnl, 0) / losers.length : 0;

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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/activity
router.get("/activity", async (req, res) => {
  try {
    const todayStr = etDateString();
    const [cycles, journal, decisionLog, closedTrades, tradeEvents] = await Promise.all([
      getTodayCycles(),
      getTodayJournal(),
      getDecisionLogForToday(),
      getClosedTrades(),
      getTradeEvents(),
    ]);

    const decisions = decisionLog.records;
    const events = [];

    // Exit events from closed trades
    for (const t of closedTrades) {
      if (!t.closedAt || !t.closedAt.startsWith(todayStr)) continue;
      if (t.exitReason === "stop_hit" || t.exitReason === "stopLoss") {
        events.push({
          type: "stop_loss_hit",
          label: `Stop loss hit — ${t.symbol} closed @ ${t.exitPrice} | PnL: ${t.pnl != null ? t.pnl.toFixed(2) : "—"}`,
          timestamp: t.closedAt,
        });
      } else if (t.exitReason === "target_hit" || t.exitReason === "takeProfit") {
        events.push({
          type: "take_profit_hit",
          label: `Take profit hit — ${t.symbol} closed @ ${t.exitPrice} | PnL: ${t.pnl != null ? t.pnl.toFixed(2) : "—"}`,
          timestamp: t.closedAt,
        });
      } else if (t.exitReason === "broker_sync_close") {
        events.push({
          type: "broker_sync_close",
          label: `Broker sync close — ${t.symbol} (no matching broker position)`,
          timestamp: t.closedAt,
        });
      } else {
        events.push({
          type: "trade_closed",
          label: `Trade closed — ${t.symbol} @ ${t.exitPrice ?? "—"} (${t.exitReason ?? "manual"}) | PnL: ${t.pnl != null ? t.pnl.toFixed(2) : "—"}`,
          timestamp: t.closedAt,
        });
      }
    }

    // Journal lifecycle events
    for (const e of tradeEvents) {
      if (!e.timestamp || !e.timestamp.startsWith(todayStr)) continue;
      if (e.type === "trade_opened") {
        events.push({ type: "trade_opened", label: `Trade opened — ${e.symbol}`, timestamp: e.timestamp });
      } else if (e.type === "orphan_detected") {
        events.push({ type: "orphan_detected", label: `Orphaned position — ${e.symbol}: missing journal metadata`, timestamp: e.timestamp });
      } else if (e.type === "sync_warning") {
        events.push({ type: "sync_warning", label: `Sync warning — ${e.symbol}: ${e.message}`, timestamp: e.timestamp });
      }
    }

    for (const c of cycles) {
      if (c.type === "completed") {
        events.push({
          type: "cycle_complete",
          label: `Cycle complete — scanned ${c.scanned}, approved ${c.approved}, placed ${c.placed}`,
          timestamp: c.recordedAt ?? c.timestamp,
        });
      } else if (c.type === "skipped") {
        events.push({ type: "skipped", label: `Cycle skipped — ${c.reason}`, timestamp: c.recordedAt ?? c.timestamp });
      }
    }

    for (const d of decisions) {
      if (d.approved) {
        events.push({
          type: "approved",
          label: `Strategy approved — ${d.symbol} (${formatAssetClass(d.assetClass)}) @ ${d.metrics?.closePrice ?? d.closePrice ?? "—"}`,
          timestamp: d.timestamp,
        });
      } else {
        events.push({ type: "rejected", label: `Strategy rejected — ${d.symbol}: ${d.reason}`, timestamp: d.timestamp });
      }
    }

    for (const e of journal) {
      if (e.orderStatus === "filled") {
        events.push({ type: "order_filled", label: `Order filled — ${e.symbol} qty ${e.quantity} @ ${e.entryPriceFilled ?? e.entryPricePlanned}`, timestamp: e.recordedAt });
      } else if (e.orderStatus === "failed") {
        events.push({ type: "order_failed", label: `Order failed — ${e.symbol}`, timestamp: e.recordedAt });
      } else if (e.orderStatus === "dry_run") {
        events.push({ type: "dry_run", label: `Dry run — ${e.symbol} would place qty ${e.quantity} @ ${e.entryPricePlanned}`, timestamp: e.recordedAt });
      }
    }

    events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json(events.slice(0, 100));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
