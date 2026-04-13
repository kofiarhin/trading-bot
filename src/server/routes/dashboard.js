import { Router } from "express";
import { getAccount, getOpenPositions } from "../../execution/alpacaTrading.js";
import { config } from "../../config/env.js";
import { loadDecisionLog } from "../../journal/decisionLogger.js";
import {
  getOpenTrades,
  getClosedTrades,
} from "../../journal/tradeJournal.js";
import { getCyclesForDate } from "../../repositories/cycleRepo.mongo.js";
import { getCycleRuntime } from "../../repositories/cycleRuntimeRepo.mongo.js";
import { londonDateString, resolveSession } from "../../utils/time.js";
import {
  getTradeEventsForDate,
  getClosedTradesForDate,
} from "../../repositories/tradeJournalRepo.mongo.js";
import { loadRiskState } from "../../risk/riskState.js";
import { normalizeSymbol } from "../../utils/symbolNorm.js";
import { logger } from "../../utils/logger.js";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shouldUseDecisionFallback(value) {
  if (value == null) return true;
  const normalized = String(value).trim().toLowerCase();
  return !["0", "false", "no", "none", "off"].includes(normalized);
}

async function getTodayCycles() {
  return getCyclesForDate(londonDateString());
}

async function getTodayJournal() {
  return getTradeEventsForDate(londonDateString());
}

async function getDecisionLogForToday({ fallbackToLatest = false } = {}) {
  return loadDecisionLog({ date: londonDateString(), fallbackToLatest });
}

// Current canonical terminal cycle event types for the session-aware model.
const CANONICAL_TERMINAL_TYPES = ["completed", "skipped", "failed", "cycle_complete", "cycle_failed"];

// Legacy event types retained solely for backward-compatible reads of old DB records.
const LEGACY_TERMINAL_TYPES = ["skipped_outside_overlap"];

// Combined set for reading historical data — includes legacy types so old records are handled.
const ALL_TERMINAL_TYPES = [...CANONICAL_TERMINAL_TYPES, ...LEGACY_TERMINAL_TYPES];

function deriveBotStatus(cycles) {
  const last = [...cycles].reverse().find((c) => ALL_TERMINAL_TYPES.includes(c.type));
  if (!last) return { botStatus: "idle", lastCycleAt: null, lastCycleType: null };
  const diffMs = Date.now() - new Date(last.timestamp).getTime();
  return {
    botStatus: diffMs < 25 * 60 * 1000 ? "active" : "idle",
    lastCycleAt: last.timestamp,
    lastCycleType: last.type,
  };
}

function normalizeRuntimeStatus(runtime, fallbackStatus, lastCycleAt) {
  const status = runtime?.status;
  if (status === "running") return "running";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "idle") {
    if (!lastCycleAt) return "idle";
    const diffMs = Date.now() - new Date(lastCycleAt).getTime();
    return diffMs < 20 * 60 * 1000 ? "waiting" : "idle";
  }
  if (fallbackStatus === "active") return "running";
  return lastCycleAt ? "waiting" : "idle";
}

function buildRuntimePayload(runtime) {
  if (!runtime) return null;
  return {
    cycleId: runtime.cycleId ?? null,
    status: runtime.status ?? "idle",
    stage: runtime.stage ?? null,
    progressPct: runtime.progressPct ?? 0,
    startedAt: runtime.startedAt ?? null,
    endedAt: runtime.endedAt ?? null,
    lastCompletedAt: runtime.lastCompletedAt ?? null,
    message: runtime.message ?? null,
    symbolCount: runtime.symbolCount ?? runtime.metrics?.symbolCount ?? 0,
    scanned: runtime.scanned ?? runtime.metrics?.scanned ?? 0,
    approved: runtime.approved ?? runtime.metrics?.approved ?? 0,
    rejected: runtime.rejected ?? runtime.metrics?.rejected ?? 0,
    placed: runtime.placed ?? runtime.metrics?.placed ?? 0,
    errors: runtime.errors ?? runtime.metrics?.errors ?? 0,
    currentSymbol: runtime.currentSymbol ?? null,
    heartbeatAt: runtime.heartbeatAt ?? null,
    lastError: runtime.lastError ?? null,
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

/**
 * Build the merged open-positions list from broker data + journal trades.
 * Prefers status=open trades when multiple journal entries share a symbol.
 */
function buildOpenPositions(brokerPositions, openTrades) {
  const tradesByNorm = {};
  for (const t of openTrades) {
    if (t.status === "canceled") continue;
    const key = t.normalizedSymbol;
    if (!tradesByNorm[key]) tradesByNorm[key] = [];
    tradesByNorm[key].push(t);
  }

  return brokerPositions.map((p) => {
    const normalized = normalizeSymbol(p.symbol);
    const matchingTrades = tradesByNorm[normalized] ?? [];
    let trade = null;
    let orphaned = false;

    if (matchingTrades.length === 1) {
      trade = matchingTrades[0];
    } else if (matchingTrades.length > 1) {
      // Resolve ambiguity: prefer status=open over pending
      const openOnly = matchingTrades.filter((t) => t.status === "open");
      if (openOnly.length === 1) {
        trade = openOnly[0];
      } else {
        orphaned = true;
        logger.warn("Ambiguous journal match for broker position — marking orphaned", {
          symbol: p.symbol,
          matchCount: matchingTrades.length,
        });
      }
    } else {
      orphaned = true;
    }

    return normalizeOpenTradeForApi(trade, p, orphaned);
  });
}

/**
 * Parse and validate pagination params from a request.
 * Returns { page, limit } with defaults applied and limit clamped to max 100.
 */
function parsePaginationParams(query, { defaultLimit = 25 } = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit };
}

/**
 * Build the activity event list from pre-fetched data.
 * Accepts today's date string and the already-fetched collections.
 */
function buildActivityEvents({ todayStr, cycles, journal, decisions, closedToday, tradeEvents }) {
  const events = [];

  // Exit events from today's closed trades
  for (const t of closedToday) {
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

  // Trade lifecycle events (trade_opened, orphan_detected, sync_warning)
  // tradeEvents is already date-scoped — no startsWith filter needed
  for (const e of tradeEvents) {
    if (e.type === "trade_opened") {
      events.push({ type: "trade_opened", label: `Trade opened — ${e.symbol}`, timestamp: e.timestamp });
    } else if (e.type === "orphan_detected") {
      events.push({ type: "orphan_detected", label: `Orphaned position — ${e.symbol}: missing journal metadata`, timestamp: e.timestamp });
    } else if (e.type === "sync_warning") {
      events.push({ type: "sync_warning", label: `Sync warning — ${e.symbol}: ${e.message}`, timestamp: e.timestamp });
    }
  }

  for (const c of cycles) {
    if (c.type === "cycle_start" || c.type === "cycle_started") {
      const sessionLabel = c.session ? ` [${c.session}]` : "";
      const countLabel = c.symbolCount != null ? ` — ${c.symbolCount} symbols in scope` : "";
      events.push({
        type: "cycle_started",
        label: `Cycle started${sessionLabel}${countLabel}`,
        timestamp: c.recordedAt ?? c.timestamp,
      });
    } else if (c.type === "completed" || c.type === "cycle_complete") {
      const sessionLabel = c.session ? ` [${c.session}]` : "";
      events.push({
        type: "cycle_complete",
        label: `Cycle complete${sessionLabel} — scanned ${c.scanned ?? "?"}, approved ${c.approved ?? 0}, placed ${c.placed ?? 0}`,
        timestamp: c.recordedAt ?? c.timestamp,
      });
    } else if (c.type === "skipped_outside_overlap") {
      // Legacy DB record — translated to canonical 'skipped' for display.
      events.push({ type: "skipped", label: `Cycle skipped — outside configured sessions`, timestamp: c.recordedAt ?? c.timestamp });
    } else if (c.type === "skipped") {
      const sessionLabel = c.session ? ` [${c.session}]` : "";
      events.push({ type: "skipped", label: `Cycle skipped${sessionLabel} — ${c.reason}`, timestamp: c.recordedAt ?? c.timestamp });
    } else if (c.type === "failed" || c.type === "cycle_failed") {
      events.push({ type: "failed", label: `Cycle failed — ${c.error ?? "unknown error"}`, timestamp: c.recordedAt ?? c.timestamp });
    } else if (c.type === "cycle_stage") {
      events.push({
        type: "cycle_stage",
        label: `Cycle stage — ${(c.stage ?? "running").replaceAll("_", " ")}${c.currentSymbol ? ` (${c.currentSymbol})` : ""}`,
        timestamp: c.recordedAt ?? c.timestamp,
      });
    } else if (c.type === "symbol_rejected") {
      // Actionable rejection from strategy — not emitted for data-missing cases.
      events.push({
        type: "symbol_rejected",
        label: `Signal rejected — ${c.symbol}: ${c.reason}`,
        timestamp: c.recordedAt ?? c.timestamp,
      });
    } else if (c.type === "order_submitted" || c.type === "trade_placed") {
      events.push({
        type: "trade_placed",
        label: `Trade placed — ${c.symbol} qty ${c.quantity}`,
        timestamp: c.recordedAt ?? c.timestamp,
      });
    } else if (c.type === "trade_closed") {
      events.push({
        type: "trade_closed",
        label: `Trade closed — ${c.symbol} (${c.reason ?? "exit"})${c.exitPrice != null ? ` @ ${c.exitPrice}` : ""}`,
        timestamp: c.recordedAt ?? c.timestamp,
      });
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

  // journal is today's TradeEvent records — use for order-lifecycle events
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
  return events;
}

// ─── In-memory cache for /overview ────────────────────────────────────────────

const overviewCache = { data: null, ts: 0 };
const OVERVIEW_CACHE_TTL_MS = 10_000;

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/dashboard/overview — single aggregated payload for the main dashboard
router.get("/overview", async (req, res) => {
  const now = Date.now();
  const runtimeForCache = await getCycleRuntime();
  if (runtimeForCache?.status !== "running" && overviewCache.data && now - overviewCache.ts < OVERVIEW_CACHE_TTL_MS) {
    res.set("X-Cache", "HIT");
    return res.json(overviewCache.data);
  }

  try {
    const todayStr = londonDateString();
    const fallbackToLatest = shouldUseDecisionFallback(req.query.fallbackLatest ?? req.query.fallback);

    // Single batch of all DB reads
    const [cycles, journal, decisionLog, riskState, openTrades, closedToday, tradeEvents] =
      await Promise.all([
        getTodayCycles(),
        getTodayJournal(),
        getDecisionLogForToday({ fallbackToLatest }),
        loadRiskState(),
        getOpenTrades(),
        getClosedTradesForDate(todayStr),
        getTradeEventsForDate(todayStr),
      ]);

    // Single batch of Alpaca calls
    let account = null;
    let brokerPositions = [];
    try {
      [account, brokerPositions] = await Promise.all([getAccount(), getOpenPositions()]);
    } catch {
      // Alpaca unreachable — proceed with partial data
    }

    // ── status ──
    const runtime = runtimeForCache;
    const normalizedRuntime = buildRuntimePayload(runtime);
    const { botStatus: inferredStatus, lastCycleAt, lastCycleType } = deriveBotStatus(cycles);
    const normalizedStatus = normalizeRuntimeStatus(runtime, inferredStatus, lastCycleAt);
    const botStatus = normalizedStatus;
    const { session: currentSession, allowCrypto, allowStocks } = resolveSession();
    const runMode = config.trading.runMode;
    const dryRun = config.trading.dryRun;

    const statusLabelMap = {
      running: runtime?.message ?? "Cycle running",
      waiting: "Waiting for next trigger",
      completed: "Cycle complete",
      failed: "Cycle failed",
      idle: "Idle",
    };

    const status = {
      status: normalizedStatus,
      botStatus,
      statusLabel: statusLabelMap[normalizedStatus] ?? "Idle",
      lastCycleAt,
      lastCycleType,
      runMode,
      dryRun: !!dryRun,
      currentSession,
      allowCrypto,
      allowStocks,
      runtime: normalizedRuntime,
    };

    // ── summary ──
    const lastCompleted = [...cycles].reverse().find((c) => c.type === "completed" || c.type === "cycle_complete");
    const realizedPnl = journal.reduce((sum, e) => sum + (e.pnl ?? 0), 0);
    const unrealizedPnl = brokerPositions.reduce((sum, p) => sum + parseFloat(p.unrealized_pl ?? 0), 0);
    const ordersPlacedToday = journal.filter(
      (e) => e.orderStatus === "filled" || e.orderStatus === "pending",
    ).length;

    const summary = {
      botStatus,
      lastCycleTime: lastCycleAt,
      symbolsScanned: lastCompleted?.scanned ?? 0,
      approvedSignals: lastCompleted?.approved ?? 0,
      ordersPlacedToday,
      openPositionsCount: brokerPositions.length,
      realizedPnl,
      unrealizedPnl,
      dailyPnl: realizedPnl + unrealizedPnl,
      equity: account ? parseFloat(account.equity) : null,
      portfolioValue: account ? parseFloat(account.portfolio_value) : null,
      dailyRealizedLoss: riskState.dailyRealizedLoss ?? 0,
    };

    // ── latestCycle ──
    const terminalIndexes = cycles.map((c, i) => ({ c, i })).filter(({ c }) => ALL_TERMINAL_TYPES.includes(c.type));
    let latestCycle = null;
    if (runtime?.startedAt || terminalIndexes.length) {
      const latest = terminalIndexes.length ? terminalIndexes[terminalIndexes.length - 1].c : null;
      const startTime = runtime?.startedAt ?? null;
      const endTime = runtime?.endedAt ?? runtime?.completedAt ?? latest?.recordedAt ?? null;
      let durationMs = null;
      if (startTime && endTime) durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();
      latestCycle = {
        type: runtime?.status ?? latest?.type ?? null,
        stage: runtime?.stage ?? null,
        progressPct: runtime?.progressPct ?? 0,
        startTime,
        endTime,
        durationMs,
        scanned: runtime?.scanned ?? latest?.scanned ?? null,
        approved: runtime?.approved ?? latest?.approved ?? null,
        rejected: runtime?.rejected ?? null,
        placed: runtime?.placed ?? latest?.placed ?? null,
        errors: runtime?.errors ?? latest?.errors ?? null,
        reason: latest?.reason ?? null,
        timestamp: runtime?.heartbeatAt ?? latest?.timestamp ?? null,
      };
    }

    // ── decisions ──
    const decisions = decisionLog.records
      .map((d) => ({
        timestamp: d.timestamp,
        symbol: d.symbol,
        assetClass: formatAssetClass(d.assetClass),
        decision: d.approved ? "Approved" : "Rejected",
        strategyName: d.strategyName ?? null,
        reason: d.reason ?? null,
        blockers: d.blockers ?? [],
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
        riskReward: d.riskReward ?? null,
      }))
      .reverse();

    // ── openPositions ──
    const openPositions = buildOpenPositions(brokerPositions, openTrades);

    // ── activity ──
    const activity = buildActivityEvents({
      todayStr,
      cycles,
      journal,
      decisions: decisionLog.records,
      closedToday,
      tradeEvents,
    });

    const payload = { status, runtime: normalizedRuntime, summary, latestCycle, decisions, openPositions, activity };
    if (normalizedStatus !== "running") {
      overviewCache.data = payload;
      overviewCache.ts = Date.now();
    }

    res.set("X-Cache", "MISS");
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/status
router.get("/status", async (req, res) => {
  try {
    const [cycles, runtime] = await Promise.all([getTodayCycles(), getCycleRuntime()]);
    const { botStatus: inferredStatus, lastCycleAt, lastCycleType } = deriveBotStatus(cycles);
    const status = normalizeRuntimeStatus(runtime, inferredStatus, lastCycleAt);
    const { session: currentSession, allowCrypto, allowStocks } = resolveSession();

    const runMode = config.trading.runMode;
    const dryRun = config.trading.dryRun;

    const statusLabelMap = {
      running: runtime?.message ?? "Cycle running",
      waiting: "Waiting for next trigger",
      completed: "Cycle complete",
      failed: "Cycle failed",
      idle: "Idle",
    };

    res.json({
      status,
      botStatus: status,
      statusLabel: statusLabelMap[status] ?? "Idle",
      stage: runtime?.stage ?? null,
      progressPct: runtime?.progressPct ?? 0,
      message: runtime?.message ?? null,
      lastCycleAt,
      lastCycleType,
      runMode,
      dryRun: !!dryRun,
      currentSession,
      allowCrypto,
      allowStocks,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/summary
router.get("/summary", async (req, res) => {
  try {
    const [cycles, journal, riskState, runtime] = await Promise.all([
      getTodayCycles(),
      getTodayJournal(),
      loadRiskState(),
      getCycleRuntime(),
    ]);
    const lastCompleted = [...cycles].reverse().find((c) => c.type === "completed" || c.type === "cycle_complete");
    const derived = deriveBotStatus(cycles);
    const botStatus = normalizeRuntimeStatus(runtime, derived.botStatus, derived.lastCycleAt);
    const lastCycleAt = derived.lastCycleAt;

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
    const [cycles, runtime] = await Promise.all([getTodayCycles(), getCycleRuntime()]);
    const terminalIndexes = cycles
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => ALL_TERMINAL_TYPES.includes(c.type));

    if (!runtime?.startedAt && !terminalIndexes.length) return res.json(null);

    const latest = terminalIndexes.length ? terminalIndexes[terminalIndexes.length - 1].c : null;
    const startTime = runtime?.startedAt ?? null;
    const endTime = runtime?.endedAt ?? runtime?.completedAt ?? latest?.recordedAt ?? null;
    let durationMs = null;
    if (startTime && endTime) {
      durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();
    }

    res.json({
      type: runtime?.status ?? latest?.type ?? null,
      stage: runtime?.stage ?? null,
      progressPct: runtime?.progressPct ?? 0,
      startTime,
      endTime,
      durationMs,
      scanned: runtime?.scanned ?? latest?.scanned ?? null,
      approved: runtime?.approved ?? latest?.approved ?? null,
      rejected: runtime?.rejected ?? null,
      placed: runtime?.placed ?? latest?.placed ?? null,
      errors: runtime?.errors ?? latest?.errors ?? null,
      reason: latest?.reason ?? null,
      timestamp: runtime?.heartbeatAt ?? latest?.timestamp ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/decisions
router.get("/decisions", async (req, res) => {
  try {
    const { page, limit } = parsePaginationParams(req.query);
    const filterDecision = req.query.decision?.toLowerCase(); // 'approved' | 'rejected'
    const filterSymbol = req.query.symbol?.toUpperCase();
    const filterAssetClass = req.query.assetClass?.toLowerCase();

    const decisionLog = await getDecisionLogForToday({
      fallbackToLatest: shouldUseDecisionFallback(req.query.fallbackLatest ?? req.query.fallback),
    });

    if (decisionLog.isFallback) {
      logger.info("Dashboard decisions using latest available record", {
        requestedDate: decisionLog.requestedDate,
        servedDate: decisionLog.date,
      });
    }

    // Normalize all records, newest first
    let items = decisionLog.records
      .map((d) => ({
        timestamp: d.timestamp,
        symbol: d.symbol,
        assetClass: formatAssetClass(d.assetClass),
        decision: d.approved ? "Approved" : "Rejected",
        strategyName: d.strategyName ?? null,
        reason: d.reason ?? null,
        blockers: d.blockers ?? [],
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
        riskReward: d.riskReward ?? null,
      }))
      .reverse();

    // Apply filters
    if (filterDecision === "approved") items = items.filter((d) => d.decision === "Approved");
    else if (filterDecision === "rejected") items = items.filter((d) => d.decision === "Rejected");
    if (filterSymbol) items = items.filter((d) => d.symbol?.toUpperCase().includes(filterSymbol));
    if (filterAssetClass) {
      items = items.filter((d) => d.assetClass?.toLowerCase() === filterAssetClass);
    }

    // Summary counts from the filtered set (before pagination)
    const approvedCount = items.filter((d) => d.decision === "Approved").length;
    const rejectedCount = items.filter((d) => d.decision === "Rejected").length;

    // Paginate
    const total = items.length;
    const pages = Math.ceil(total / limit) || 0;
    const offset = (page - 1) * limit;
    const pagedItems = items.slice(offset, offset + limit);

    // Build active filters object (only include set filters)
    const filters = {};
    if (filterDecision) filters.decision = filterDecision;
    if (filterSymbol) filters.symbol = req.query.symbol;
    if (filterAssetClass) filters.assetClass = req.query.assetClass;

    res.set("X-Decisions-Date", decisionLog.date);
    res.set("X-Decisions-Fallback", decisionLog.isFallback ? "true" : "false");
    res.json({
      items: pagedItems,
      pagination: {
        page,
        limit,
        total,
        pages,
        hasPrevPage: page > 1,
        hasNextPage: page < pages,
      },
      filters,
      summary: { approved: approvedCount, rejected: rejectedCount },
    });
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
    res.json(buildOpenPositions(positions, openTrades));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/positions/closed
router.get("/positions/closed", async (req, res) => {
  try {
    // Sort and limit in the DB query — avoid loading the full collection
    const closed = (await getClosedTrades(100)).map(normalizeClosedTradeForApi);
    res.json(closed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/performance
router.get("/performance", async (req, res) => {
  try {
    // Use a reasonable cap to avoid unbounded reads.
    // Exclude broker_sync records — they are reconciliation artefacts, not
    // strategy trades, and must not pollute performance statistics.
    const all = await getClosedTrades(1000);
    const closed = all.filter((e) => e.pnl != null && e.strategyName !== 'broker_sync');

    const totalTrades = closed.length;
    const winners = closed.filter((e) => e.pnl > 0);
    const losers = closed.filter((e) => e.pnl < 0);
    const totalPnl = closed.reduce((sum, e) => sum + e.pnl, 0);
    const winRate = totalTrades ? (winners.length / totalTrades) * 100 : 0;
    const avgWin = winners.length ? winners.reduce((s, e) => s + e.pnl, 0) / winners.length : 0;
    const avgLoss = losers.length ? losers.reduce((s, e) => s + e.pnl, 0) / losers.length : 0;

    const byDate = {};
    for (const e of closed) {
      const date = (e.closedAt ?? e.recordedAt ?? "").slice(0, 10);
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
    const { page, limit } = parsePaginationParams(req.query);
    const filterType = req.query.type;
    const filterSearch = req.query.search?.toLowerCase();

    const todayStr = londonDateString();
    // All queries are now date-scoped — no full-collection reads
    const [cycles, journal, decisionLog, closedToday, tradeEvents] = await Promise.all([
      getTodayCycles(),
      getTodayJournal(),
      getDecisionLogForToday(),
      getClosedTradesForDate(todayStr),
      getTradeEventsForDate(todayStr),
    ]);

    let events = buildActivityEvents({
      todayStr,
      cycles,
      journal,
      decisions: decisionLog.records,
      closedToday,
      tradeEvents,
    });

    // Apply filters
    if (filterType) events = events.filter((e) => e.type === filterType);
    if (filterSearch) events = events.filter((e) => e.label?.toLowerCase().includes(filterSearch));

    // Paginate
    const total = events.length;
    const pages = Math.ceil(total / limit) || 0;
    const offset = (page - 1) * limit;
    const pagedItems = events.slice(offset, offset + limit);

    const filters = {};
    if (filterType) filters.type = filterType;
    if (filterSearch) filters.search = req.query.search;

    res.json({
      items: pagedItems,
      pagination: {
        page,
        limit,
        total,
        pages,
        hasPrevPage: page > 1,
        hasNextPage: page < pages,
      },
      filters,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
