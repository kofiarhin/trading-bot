import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { connectMongo, disconnectMongo } from './db/connectMongo.js';
import { placeOrder } from './execution/orderManager.js';
import { getAccount, getBarsForSymbols, getOrders, getPositions, isDryRunEnabled } from './lib/alpaca.js';
import { fetchCryptoBars } from './market/alpacaMarketData.js';
import { getUniverse } from './market/universe.js';
import { nowIso } from './lib/storage.js';
import { resolveSession } from './utils/time.js';
import { filterEligible } from './market/marketHours.js';
import {
  getOpenTrades,
  syncTradesWithBroker,
} from './journal/tradeJournal.js';
import { saveDecision } from './repositories/decisionRepo.mongo.js';
import { appendCycleEvent } from './repositories/cycleRepo.mongo.js';
import { loadRiskState } from './risk/riskState.js';
import { checkOpenTradesForExit } from './positions/positionMonitor.js';
import { closeTrade } from './execution/orderManager.js';
import { evaluateBreakout } from './strategies/breakoutStrategy.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function inferAssetClass(symbol) {
  return typeof symbol === 'string' && symbol.includes('/') ? 'crypto' : 'stock';
}

/**
 * Converts any bar format (Alpaca raw or long-name normalized) to the raw
 * short-name format expected by the strategy indicators: { t, o, h, l, c, v }.
 */
function toStrategyBars(bars) {
  return (bars ?? []).map((b) => ({
    t: b.timestamp ?? b.t,
    o: b.open ?? b.o,
    h: b.high ?? b.h,
    l: b.low ?? b.l,
    c: b.close ?? b.c,
    v: b.volume ?? b.v,
  }));
}

function getConfiguredSymbols() {
  // Explicit override — comma-separated list in env takes priority.
  const rawSymbols =
    process.env.AUTOPILOT_SYMBOLS ??
    process.env.SYMBOLS ??
    process.env.WATCHLIST ??
    process.env.TICKERS;

  if (rawSymbols) {
    return [...new Set(rawSymbols.split(',').map((symbol) => symbol.trim()).filter(Boolean))];
  }

  // Default: derive from the configured universe, respecting ENABLE_STOCKS / ENABLE_CRYPTO.
  const universeEntries = getUniverse({
    enableStocks: process.env.ENABLE_STOCKS !== 'false',
    enableCrypto: process.env.ENABLE_CRYPTO !== 'false',
  });
  return universeEntries.map((e) => e.symbol);
}

async function fetchBarsBySymbol(symbols) {
  const stockSymbols = symbols.filter((s) => inferAssetClass(s) === 'stock');
  const cryptoSymbols = symbols.filter((s) => inferAssetClass(s) === 'crypto');
  const results = {};

  // Stocks: use the multi-symbol limit-based endpoint (works outside market hours).
  // getBarsForSymbols returns long-name format; toStrategyBars() converts at call site.
  if (stockSymbols.length) {
    try {
      const stockBars = await getBarsForSymbols(stockSymbols, { timeframe: '15Min', limit: 60 });
      Object.assign(results, stockBars);
    } catch (err) {
      console.error(`Failed to fetch stock bars: ${err.message}`);
      for (const s of stockSymbols) results[s] = [];
    }
  }

  // Crypto: dedicated endpoint returns raw { t, o, h, l, c, v } format directly.
  await Promise.all(
    cryptoSymbols.map(async (symbol) => {
      try {
        results[symbol] = await fetchCryptoBars(symbol, 60);
      } catch (err) {
        console.error(`Failed to fetch crypto bars for ${symbol}: ${err.message}`);
        results[symbol] = [];
      }
    }),
  );

  return results;
}

/**
 * Evaluates a single symbol by delegating to the canonical strategy module.
 * Returns a decision in the canonical shape with a unique `id`.
 */
function evaluateSymbol(symbol, bars, account) {
  const equity = toNumber(account?.equity, 100000);
  const riskPercent = toNumber(process.env.RISK_PERCENT, 0.005);

  // Convert bars to raw short-name format expected by indicators / strategy.
  const rawBars = toStrategyBars(bars);

  const decision = evaluateBreakout({
    symbol,
    assetClass: inferAssetClass(symbol),
    bars: rawBars,
    accountEquity: equity,
    riskPercent,
  });

  return { id: randomUUID(), ...decision };
}

async function getRiskState() {
  const state = await loadRiskState();
  return { dailyLossPct: state.dailyRealizedLoss ?? 0, halted: false, ...state };
}

async function evaluateExecutionGuards(decision, brokerPositions) {
  const blockers = [];
  const openTrades = await getOpenTrades();
  const riskState = await getRiskState();
  const maxPositions = toNumber(process.env.MAX_POSITIONS, 3);
  const dailyLossLimit = toNumber(process.env.DAILY_LOSS_LIMIT_PCT, 2);

  const hasMatchingBrokerPosition = brokerPositions.some((position) => position.symbol === decision.symbol);
  const hasMatchingJournalTrade = openTrades.some(
    (trade) => trade.symbol === decision.symbol && ['pending', 'open'].includes(trade.status),
  );

  if (hasMatchingBrokerPosition || hasMatchingJournalTrade) {
    blockers.push('duplicate_position_guard');
  }

  const activeSymbols = new Set([
    ...brokerPositions.map((position) => position.symbol),
    ...openTrades.filter((trade) => ['pending', 'open'].includes(trade.status)).map((trade) => trade.symbol),
  ]);

  if (activeSymbols.size >= maxPositions) {
    blockers.push('max_positions_guard');
  }

  if (riskState.halted || toNumber(riskState.dailyLossPct, 0) >= dailyLossLimit) {
    blockers.push('daily_loss_guard');
  }

  return {
    allowed: blockers.length === 0,
    blockers,
  };
}

async function recordDecision(decision) {
  await saveDecision({
    timestamp: decision.timestamp ?? nowIso(),
    recordedAt: nowIso(),
    symbol: decision.symbol,
    normalizedSymbol: decision.normalizedSymbol ?? null,
    assetClass: decision.assetClass ?? null,
    approved: !!decision.approved,
    reason: decision.reason ?? null,
    timeframe: decision.timeframe ?? null,
    strategyName: decision.strategyName ?? null,
    closePrice: decision.metrics?.closePrice ?? decision.entryPrice ?? null,
    entryPrice: decision.entryPrice ?? null,
    breakoutLevel: decision.metrics?.breakoutLevel ?? null,
    atr: decision.metrics?.atr ?? null,
    volumeRatio: decision.metrics?.volumeRatio ?? null,
    distanceToBreakoutPct: decision.metrics?.distanceToBreakoutPct ?? null,
    stopLoss: decision.stopLoss ?? null,
    takeProfit: decision.takeProfit ?? null,
    quantity: decision.quantity ?? null,
    riskAmount: decision.riskAmount ?? null,
    riskReward: decision.riskReward ?? null,
    blockers: decision.blockers ?? [],
  });
  await appendCycleEvent({
    type: 'decision_recorded',
    timestamp: nowIso(),
    decisionId: decision.id,
    symbol: decision.symbol,
    approved: decision.approved,
    reason: decision.reason,
    strategyName: decision.strategyName,
  });
}

async function recordApproval(decision, blockers) {
  await appendCycleEvent({
    type: blockers.length ? 'decision_blocked' : 'decision_approved',
    timestamp: nowIso(),
    decisionId: decision.id,
    symbol: decision.symbol,
    strategyName: decision.strategyName,
    blockers,
  });
}

async function handleExits(dryRun) {
  const openTrades = await getOpenTrades();
  const exitDecisions = await checkOpenTradesForExit(openTrades);

  for (const exit of exitDecisions) {
    if (!exit.shouldExit) continue;

    await closeTrade({
      tradeId: exit.tradeId,
      symbol: exit.symbol,
      exitPrice: exit.currentPrice,
      reason: exit.reason,
      dryRun,
    });

    await appendCycleEvent({
      type: 'trade_closed',
      timestamp: nowIso(),
      symbol: exit.symbol,
      tradeId: exit.tradeId,
      reason: exit.reason,
      exitPrice: exit.currentPrice,
    });
  }
}

export async function runAutopilotCycle(options = {}) {
  const dryRun = isDryRunEnabled(options);
  const cycleId = randomUUID();
  const startedAt = nowIso();

  const { session, allowCrypto, allowStocks } = resolveSession();

  const account = await getAccount();

  // Filter the configured universe to assets eligible in the current session.
  const allSymbols = getConfiguredSymbols();
  const universeEntries = allSymbols.map((s) => ({
    symbol: s,
    assetClass: inferAssetClass(s) === 'crypto' ? 'crypto' : 'stock',
  }));
  const symbols = filterEligible(universeEntries).map((e) => e.symbol);

  // Emit cycle_start after symbol filtering so symbolCount is accurate.
  await appendCycleEvent({
    type: 'cycle_start',
    timestamp: startedAt,
    id: cycleId,
    cycleId,
    dryRun,
    startedAt,
    session,
    allowCrypto,
    allowStocks,
    symbolCount: symbols.length,
  });

  const brokerPositionsBefore = await getPositions();
  const brokerOrdersBefore = await getOrders({ status: 'all', limit: 200, nested: true, direction: 'desc' });

  await syncTradesWithBroker({
    brokerPositions: brokerPositionsBefore,
    brokerOrders: brokerOrdersBefore,
  });

  await handleExits(dryRun);

  const barsBySymbol = await fetchBarsBySymbol(symbols);

  // Delegate all signal evaluation to the canonical strategy module.
  const decisions = symbols.map((symbol) => evaluateSymbol(symbol, barsBySymbol[symbol] ?? [], account));

  for (const decision of decisions) {
    await recordDecision(decision);

    // Emit a diagnostic cycle event for actionable rejections so the activity
    // feed can show which symbols were filtered and why — without flooding it
    // with data-missing rejections.
    if (!decision.approved) {
      const diagnosticReasons = ['no_breakout', 'weak_volume', 'atr_too_low', 'breakout_too_extended', 'invalid_risk_reward', 'invalid_stop_distance'];
      if (diagnosticReasons.includes(decision.reason)) {
        await appendCycleEvent({
          type: 'symbol_rejected',
          timestamp: nowIso(),
          symbol: decision.symbol,
          reason: decision.reason,
          metrics: decision.metrics ?? null,
        });
      }
    }
  }

  let approvedCount = 0;
  let placedCount = 0;
  const placements = [];

  for (const decision of decisions) {
    if (!decision.approved) {
      continue;
    }

    const brokerPositions = await getPositions();
    const guardResult = await evaluateExecutionGuards(decision, brokerPositions);

    // Append guard blockers to the decision's blockers array while preserving
    // the strategy's original blockers (should be empty for an approved decision).
    decision.blockers = [...(decision.blockers ?? []), ...guardResult.blockers];

    await recordApproval(decision, guardResult.blockers);

    if (!guardResult.allowed) {
      continue;
    }

    approvedCount += 1;

    const placement = await placeOrder({ decision, dryRun });
    placements.push({ decision, placement });

    if (!placement.placed) {
      await appendCycleEvent({
        type: 'order_skipped',
        timestamp: nowIso(),
        decisionId: decision.id,
        symbol: decision.symbol,
        reason: placement.message,
        dryRun: placement.dryRun,
      });
      continue;
    }

    placedCount += 1;

    await appendCycleEvent({
      type: 'order_submitted',
      timestamp: nowIso(),
      decisionId: decision.id,
      symbol: decision.symbol,
      brokerOrderId: placement.orderId ?? null,
      quantity: decision.quantity,
    });
  }

  const brokerPositionsAfter = await getPositions();
  const brokerOrdersAfter = await getOrders({ status: 'all', limit: 200, nested: true, direction: 'desc' });

  await syncTradesWithBroker({
    brokerPositions: brokerPositionsAfter,
    brokerOrders: brokerOrdersAfter,
  });

  const summary = {
    cycleId,
    dryRun,
    session,
    allowCrypto,
    allowStocks,
    scanned: decisions.length,
    approved: approvedCount,
    placed: placedCount,
    startedAt,
    completedAt: nowIso(),
  };

  await appendCycleEvent({ type: 'completed', timestamp: nowIso(), ...summary });

  console.log(`[autopilot] cycle completed — scanned: ${summary.scanned}, approved: ${summary.approved}, placed: ${summary.placed}`);

  return {
    summary,
    decisions,
    placements,
  };
}

export default runAutopilotCycle;

const executedFile = process.argv[1]?.replace(/\\/g, '/');
if (executedFile?.endsWith('/src/autopilot.js')) {
  (async () => {
    const { session } = resolveSession();
    console.log(`[autopilot] session: ${session} (${new Date().toISOString()})`);

    try {
      await connectMongo();
      await runAutopilotCycle();
    } catch (error) {
      console.error(`[autopilot] cycle failed: ${error instanceof Error ? error.message : error}`);
      // Best-effort: try to persist the failure before exiting.
      try {
        await appendCycleEvent({
          type: 'failed',
          timestamp: nowIso(),
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // Ignore secondary failure — DB may be unavailable.
      }
      process.exitCode = 1;
    } finally {
      await disconnectMongo();
    }
  })();
}
