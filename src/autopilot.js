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
import { CYCLE_STAGES } from './autopilot/cycleStages.js';
import {
  startCycleRuntime,
  updateCycleRuntime,
  completeCycleRuntime,
  failCycleRuntime,
} from './repositories/cycleRuntimeRepo.mongo.js';

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

  const runtimeStarted = await startCycleRuntime({
    metrics: {
      scanned: 0,
      approved: 0,
      blocked: 0,
      placed: 0,
      rejected: 0,
      errors: 0,
    },
  });

  if (!runtimeStarted) {
    const concurrencyError = new Error('Cycle already running');
    concurrencyError.code = 'CYCLE_ALREADY_RUNNING';
    throw concurrencyError;
  }

  try {
    const { session, allowCrypto, allowStocks } = resolveSession();

    const account = await getAccount();

    const allSymbols = getConfiguredSymbols();
    const universeEntries = allSymbols.map((s) => ({
      symbol: s,
      assetClass: inferAssetClass(s) === 'crypto' ? 'crypto' : 'stock',
    }));
    const symbols = filterEligible(universeEntries).map((e) => e.symbol);

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

    await updateCycleRuntime({
      stage: CYCLE_STAGES.SYNCING_BROKER,
      metrics: { scanned: symbols.length, approved: 0, blocked: 0, placed: 0, rejected: 0, errors: 0 },
    });

    const brokerPositionsBefore = await getPositions();
    const brokerOrdersBefore = await getOrders({ status: 'all', limit: 200, nested: true, direction: 'desc' });

    await syncTradesWithBroker({
      brokerPositions: brokerPositionsBefore,
      brokerOrders: brokerOrdersBefore,
    });

    await updateCycleRuntime({ stage: CYCLE_STAGES.MONITORING_POSITIONS });
    await handleExits(dryRun);

    await updateCycleRuntime({ stage: CYCLE_STAGES.FETCHING_MARKET_DATA });
    const barsBySymbol = await fetchBarsBySymbol(symbols);

    await updateCycleRuntime({ stage: CYCLE_STAGES.EVALUATING_SIGNALS });
    const decisions = symbols.map((symbol) => evaluateSymbol(symbol, barsBySymbol[symbol] ?? [], account));

    let rejectedCount = 0;
    for (const decision of decisions) {
      await recordDecision(decision);
      if (!decision.approved) {
        rejectedCount += 1;
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

    await updateCycleRuntime({
      stage: CYCLE_STAGES.APPLYING_RISK_GUARDS,
      metrics: { scanned: decisions.length, approved: 0, blocked: 0, placed: 0, rejected: rejectedCount, errors: 0 },
    });

    let approvedCount = 0;
    let blockedCount = 0;
    let placedCount = 0;
    const placements = [];

    for (const decision of decisions) {
      if (!decision.approved) {
        continue;
      }

      const brokerPositions = await getPositions();
      const guardResult = await evaluateExecutionGuards(decision, brokerPositions);
      decision.blockers = [...(decision.blockers ?? []), ...guardResult.blockers];
      await recordApproval(decision, guardResult.blockers);

      if (!guardResult.allowed) {
        blockedCount += 1;
        continue;
      }

      approvedCount += 1;
    }

    await updateCycleRuntime({
      stage: CYCLE_STAGES.PLACING_ORDERS,
      metrics: {
        scanned: decisions.length,
        approved: approvedCount,
        blocked: blockedCount,
        placed: placedCount,
        rejected: rejectedCount,
        errors: 0,
      },
    });

    for (const decision of decisions) {
      if (!decision.approved || (decision.blockers?.length ?? 0) > 0) {
        continue;
      }

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

      await updateCycleRuntime({
        metrics: {
          scanned: decisions.length,
          approved: approvedCount,
          blocked: blockedCount,
          placed: placedCount,
          rejected: rejectedCount,
          errors: 0,
        },
      });
    }

    await updateCycleRuntime({ stage: CYCLE_STAGES.FINAL_SYNC });

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
    await completeCycleRuntime({
      metrics: {
        scanned: decisions.length,
        approved: approvedCount,
        blocked: blockedCount,
        placed: placedCount,
        rejected: rejectedCount,
        errors: 0,
      },
    });

    console.log(`[autopilot] cycle completed — scanned: ${summary.scanned}, approved: ${summary.approved}, placed: ${summary.placed}`);

    return {
      summary,
      decisions,
      placements,
    };
  } catch (error) {
    await failCycleRuntime({
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
      context: { cycleId },
    });
    throw error;
  }
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
