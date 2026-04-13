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
import { getOpenTrades, syncTradesWithBroker } from './journal/tradeJournal.js';
import { saveDecision } from './repositories/decisionRepo.mongo.js';
import { appendCycleEvent } from './repositories/cycleRepo.mongo.js';
import { loadRiskState } from './risk/riskState.js';
import { checkOpenTradesForExit } from './positions/positionMonitor.js';
import { closeTrade } from './execution/orderManager.js';
import { evaluateBreakout } from './strategies/breakoutStrategy.js';
import { checkPortfolioRisk } from './risk/portfolioRisk.js';
import { CYCLE_STAGES } from './autopilot/cycleStages.js';
import {
  startCycleRuntime,
  updateCycleRuntime,
  completeCycleRuntime,
  failCycleRuntime,
  CycleAlreadyRunningError,
} from './repositories/cycleRuntimeRepo.mongo.js';

function toNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function inferAssetClass(symbol) {
  return typeof symbol === 'string' && symbol.includes('/') ? 'crypto' : 'stock';
}

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
  const rawSymbols =
    process.env.AUTOPILOT_SYMBOLS ??
    process.env.SYMBOLS ??
    process.env.WATCHLIST ??
    process.env.TICKERS;

  if (rawSymbols) {
    return [...new Set(rawSymbols.split(',').map((symbol) => symbol.trim()).filter(Boolean))];
  }

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

  if (stockSymbols.length) {
    try {
      const stockBars = await getBarsForSymbols(stockSymbols, { timeframe: '15Min', limit: 60 });
      Object.assign(results, stockBars);
    } catch (err) {
      console.error(`Failed to fetch stock bars: ${err.message}`);
      for (const s of stockSymbols) results[s] = [];
    }
  }

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

function evaluateSymbol(symbol, bars, account) {
  const equity = toNumber(account?.equity, 100000);
  const riskPercent = toNumber(process.env.RISK_PERCENT, 0.005);
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
    setupScore: decision.setupScore ?? null,
    setupGrade: decision.setupGrade ?? null,
    rejectionClass: decision.rejectionClass ?? null,
    context: decision.context ?? null,
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
    if (!exit.shouldExit) {
      // Stop level updated (breakeven / trailing) — emit informational event
      await appendCycleEvent({
        type: 'trade_stop_updated',
        timestamp: nowIso(),
        symbol: exit.symbol,
        tradeId: exit.tradeId,
        reason: exit.reason,
        currentPrice: exit.currentPrice,
        newStop: exit.updatedTrade?.stopLoss ?? null,
        trailingStopPrice: exit.updatedTrade?.trailingStopPrice ?? null,
      });
      continue;
    }

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

  const counters = { symbolCount: 0, scanned: 0, approved: 0, rejected: 0, placed: 0, blocked: 0, errors: 0 };

  const setRuntimeStage = async (stage, message, patch = {}) => {
    const runtimeStatus = patch.status ?? 'running';
    await updateCycleRuntime({
      cycleId,
      status: runtimeStatus,
      stage,
      message,
      session,
      dryRun,
      symbolCount: counters.symbolCount,
      scanned: counters.scanned,
      approved: counters.approved,
      rejected: counters.rejected,
      placed: counters.placed,
      errors: counters.errors,
      currentSymbol: patch.currentSymbol,
      ...patch,
    });

    await appendCycleEvent({
      type: 'cycle_stage',
      timestamp: nowIso(),
      cycleId,
      stage,
      message,
      currentSymbol: patch.currentSymbol ?? null,
    });
  };

  try {
    await startCycleRuntime({
      cycleId,
      stage: CYCLE_STAGES.STARTING,
      message: 'Cycle started',
      startedAt,
      session,
      dryRun,
    });
  } catch (error) {
    if (error instanceof CycleAlreadyRunningError || error?.code === 'CYCLE_ALREADY_RUNNING') {
      throw error;
    }
    throw error;
  }

  try {
    const account = await getAccount();

    const allSymbols = getConfiguredSymbols();
    const universeEntries = allSymbols.map((s) => ({
      symbol: s,
      assetClass: inferAssetClass(s) === 'crypto' ? 'crypto' : 'stock',
    }));
    const symbols = filterEligible(universeEntries).map((e) => e.symbol);
    counters.symbolCount = symbols.length;

    await appendCycleEvent({
      type: 'cycle_started',
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

    await setRuntimeStage(CYCLE_STAGES.STARTING, 'Cycle started');
    await setRuntimeStage(CYCLE_STAGES.SYNCING_BROKER, 'Syncing broker positions');

    const brokerPositionsBefore = await getPositions();
    const brokerOrdersBefore = await getOrders({ status: 'all', limit: 200, nested: true, direction: 'desc' });

    await syncTradesWithBroker({
      brokerPositions: brokerPositionsBefore,
      brokerOrders: brokerOrdersBefore,
    });

    await setRuntimeStage(CYCLE_STAGES.MONITORING_POSITIONS, 'Checking open trades for exits');
    await handleExits(dryRun);

    await setRuntimeStage(CYCLE_STAGES.FETCHING_MARKET_DATA, 'Fetching latest market data');
    const barsBySymbol = await fetchBarsBySymbol(symbols);

    await setRuntimeStage(CYCLE_STAGES.EVALUATING_SIGNALS, 'Evaluating strategy signals');
    const decisions = symbols.map((symbol) => evaluateSymbol(symbol, barsBySymbol[symbol] ?? [], account));

    for (const decision of decisions) {
      counters.scanned += 1;
      await updateCycleRuntime({ cycleId, currentSymbol: decision.symbol, scanned: counters.scanned, heartbeatAt: nowIso() });
      await recordDecision(decision);

      if (!decision.approved) {
        counters.rejected += 1;
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

    // ── Rank candidates ────────────────────────────────────────────────────────
    const maxCandidates = toNumber(process.env.MAX_CANDIDATES_PER_CYCLE, 3);
    const approvedDecisions = decisions.filter((d) => d.approved);

    // Sort descending by setupScore (null scores treated as 0)
    approvedDecisions.sort((a, b) => (b.setupScore ?? 0) - (a.setupScore ?? 0));

    const candidatePool = approvedDecisions.slice(0, maxCandidates);
    const rankedOutDecisions = approvedDecisions.slice(maxCandidates);

    await setRuntimeStage(CYCLE_STAGES.RANKING_CANDIDATES, `Ranked ${candidatePool.length} candidates (${rankedOutDecisions.length} ranked out)`);

    // Emit ranked-out events
    for (let i = 0; i < rankedOutDecisions.length; i++) {
      const d = rankedOutDecisions[i];
      // Mark as no longer eligible so placing orders loop skips them
      d._rankedOut = true;
      await appendCycleEvent({
        type: 'candidate_ranked_out',
        timestamp: nowIso(),
        cycleId,
        symbol: d.symbol,
        setupScore: d.setupScore ?? null,
        rank: maxCandidates + i + 1,
      });
    }

    if (candidatePool.length > 0) {
      await appendCycleEvent({
        type: 'candidates_ranked',
        timestamp: nowIso(),
        cycleId,
        count: candidatePool.length,
        candidates: candidatePool.map((d, i) => ({ rank: i + 1, symbol: d.symbol, setupScore: d.setupScore ?? null, setupGrade: d.setupGrade ?? null })),
      });
    }

    await setRuntimeStage(CYCLE_STAGES.APPLYING_RISK_GUARDS, 'Applying risk guards');

    // ── Per-symbol execution guards ───────────────────────────────────────────
    const placements = [];
    const perGuardPassed = [];
    for (const decision of decisions) {
      if (!decision.approved || decision._rankedOut) continue;

      await updateCycleRuntime({ cycleId, currentSymbol: decision.symbol });
      const brokerPositions = await getPositions();
      const guardResult = await evaluateExecutionGuards(decision, brokerPositions);
      decision.blockers = [...(decision.blockers ?? []), ...guardResult.blockers];
      await recordApproval(decision, guardResult.blockers);

      if (!guardResult.allowed) {
        counters.blocked += 1;
        continue;
      }

      perGuardPassed.push(decision);
    }

    // ── Portfolio-level risk batch check ──────────────────────────────────────
    const brokerPositionsForPortfolio = await getPositions();
    const openTradesForPortfolio = await getOpenTrades();
    const riskStateForPortfolio = await getRiskState();
    const { account: _acct } = { account };
    const portfolioResult = checkPortfolioRisk({
      candidates: perGuardPassed,
      openTrades: openTradesForPortfolio,
      brokerPositions: brokerPositionsForPortfolio,
      accountEquity: toNumber(account?.equity, 100000),
      riskState: riskStateForPortfolio,
      maxCandidatesOverride: toNumber(process.env.MAX_CANDIDATES_PER_CYCLE, 3),
    });

    for (const { candidate, reason } of portfolioResult.blocked) {
      candidate._portfolioBlocked = true;
      counters.blocked += 1;
      await appendCycleEvent({
        type: 'candidate_portfolio_blocked',
        timestamp: nowIso(),
        cycleId,
        symbol: candidate.symbol,
        reason,
      });
    }

    for (const candidate of portfolioResult.allowed) {
      counters.approved += 1;
    }

    await setRuntimeStage(CYCLE_STAGES.PLACING_ORDERS, 'Placing approved orders');

    for (const decision of decisions) {
      if (!decision.approved || decision._rankedOut || decision._portfolioBlocked || (decision.blockers?.length ?? 0) > 0) continue;

      await updateCycleRuntime({ cycleId, currentSymbol: decision.symbol });
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

      counters.placed += 1;
      await appendCycleEvent({
        type: 'trade_placed',
        timestamp: nowIso(),
        cycleId,
        decisionId: decision.id,
        symbol: decision.symbol,
        brokerOrderId: placement.orderId ?? null,
        quantity: decision.quantity,
      });

      await updateCycleRuntime({
        cycleId,
        scanned: counters.scanned,
        approved: counters.approved,
        rejected: counters.rejected,
        placed: counters.placed,
        errors: counters.errors,
      });
    }

    await setRuntimeStage(CYCLE_STAGES.FINAL_SYNC, 'Finalizing cycle state', { currentSymbol: null });

    const brokerPositionsAfter = await getPositions();
    const brokerOrdersAfter = await getOrders({ status: 'all', limit: 200, nested: true, direction: 'desc' });

    await syncTradesWithBroker({
      brokerPositions: brokerPositionsAfter,
      brokerOrders: brokerOrdersAfter,
    });

    const completedAt = nowIso();
    const summary = {
      cycleId,
      dryRun,
      session,
      allowCrypto,
      allowStocks,
      symbolCount: counters.symbolCount,
      scanned: counters.scanned,
      approved: counters.approved,
      rejected: counters.rejected,
      placed: counters.placed,
      errors: counters.errors,
      startedAt,
      completedAt,
    };

    await setRuntimeStage(CYCLE_STAGES.COMPLETED, 'Cycle complete', { status: 'completed', currentSymbol: null });
    await appendCycleEvent({ type: 'cycle_complete', timestamp: completedAt, ...summary });
    await appendCycleEvent({ type: 'completed', timestamp: completedAt, ...summary });
    await completeCycleRuntime({ cycleId, message: 'Cycle complete', ...summary });

    console.log(`[autopilot] cycle completed — scanned: ${summary.scanned}, approved: ${summary.approved}, placed: ${summary.placed}`);

    return {
      cycleId,
      status: 'completed',
      summary,
      decisions,
      placements,
    };
  } catch (error) {
    counters.errors += 1;
    const errorMessage = error instanceof Error ? error.message : String(error);

    await appendCycleEvent({
      type: 'cycle_failed',
      timestamp: nowIso(),
      cycleId,
      error: errorMessage,
    });
    await appendCycleEvent({ type: 'failed', timestamp: nowIso(), cycleId, error: errorMessage });
    try {
      await setRuntimeStage(CYCLE_STAGES.FAILED, 'Cycle failed', { status: 'failed', currentSymbol: null });
    } catch {
      // best effort; failCycleRuntime remains authoritative
    }

    await failCycleRuntime({
      cycleId,
      message: errorMessage,
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
