import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { config } from './config/env.js';
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
import { preFilter } from './preFilter.js';
import { computeScore } from './scoring/scorer.js';
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
  const configuredSymbols = config.trading.symbols ?? [];
  if (configuredSymbols.length > 0) {
    return configuredSymbols;
  }

  const universeEntries = getUniverse({
    enableStocks: config.trading.enableStocks,
    enableCrypto: config.trading.enableCrypto,
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

async function getRiskState() {
  const state = await loadRiskState();
  return { dailyLossPct: state.dailyRealizedLoss ?? 0, halted: false, ...state };
}

async function evaluateExecutionGuards(decision, brokerPositions) {
  const blockers = [];
  const openTrades = await getOpenTrades();
  const riskState = await getRiskState();
  const maxPositions = config.trading.maxOpenPositions;
  const dailyLossLimit = config.trading.dailyLossLimitPct;

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

async function recordDecision(decision, extra = {}) {
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
    scoreBreakdown: decision.scoreBreakdown ?? null,
    rejectionClass: decision.rejectionClass ?? null,
    context: decision.context ?? null,
    rejectStage: decision.rejectStage ?? null,
    ...extra,
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

export async function runAutopilotCycle(options = {}, triggerSource = 'cron', { onStarted } = {}) {
  const dryRun = isDryRunEnabled(options);
  const cycleId = randomUUID();
  const startedAt = nowIso();
  const { session, allowCrypto, allowStocks } = resolveSession();

  const counters = {
    symbolCount: 0,
    scanned: 0,
    approved: 0,
    rejected: 0,
    placed: 0,
    blocked: 0,
    errors: 0,
    preFiltered: 0,
    shortlisted: 0,
    rankedOut: 0,
  };

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
      preFiltered: counters.preFiltered,
      shortlisted: counters.shortlisted,
      rankedOut: counters.rankedOut,
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
      triggerSource,
    });
    onStarted?.(cycleId);
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
      triggerSource,
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

    // ── Phase A: Fetch all bars ────────────────────────────────────────────────
    await setRuntimeStage(CYCLE_STAGES.FETCHING_MARKET_DATA, 'Fetching latest market data');
    const rawBarsBySymbol = await fetchBarsBySymbol(symbols);
    // Normalise to strategy bar format once, keyed by symbol
    const barsBySymbol = {};
    for (const sym of symbols) {
      barsBySymbol[sym] = toStrategyBars(rawBarsBySymbol[sym] ?? []);
    }

    // ── Phase B: Pre-filter all symbols ───────────────────────────────────────
    await setRuntimeStage(CYCLE_STAGES.PRE_FILTERING, 'Pre-filtering symbols');

    const equity = toNumber(account?.equity, 100000);
    const riskPercent = config.trading.riskPercent;

    const preFilterResults = symbols.map((sym) =>
      preFilter(sym, inferAssetClass(sym), barsBySymbol[sym]),
    );
    const viable = preFilterResults.filter((r) => r.passed);
    const preFilteredOut = preFilterResults.filter((r) => !r.passed);

    counters.preFiltered = preFilteredOut.length;

    // Record decisions for pre-filtered-out symbols
    for (const pfResult of preFilteredOut) {
      counters.scanned += 1;
      counters.rejected += 1;
      const decision = {
        id: randomUUID(),
        approved: false,
        symbol: pfResult.symbol,
        normalizedSymbol: pfResult.symbol,
        assetClass: pfResult.assetClass,
        strategyName: 'momentum_breakout_atr_v1',
        timestamp: nowIso(),
        timeframe: '15Min',
        reason: pfResult.rejectReason,
        rejectStage: 'pre_filter',
        blockers: [pfResult.rejectReason],
        metrics: null,
        setupScore: null,
        setupGrade: null,
        rejectionClass: null,
        context: null,
      };
      await recordDecision(decision, {
        cycleId,
        stage: 'pre_filter',
        shortlisted: false,
        rankedOut: false,
        rejectStage: 'pre_filter',
      });
    }

    // ── Phase C: Score viable symbols ─────────────────────────────────────────
    await setRuntimeStage(CYCLE_STAGES.SCORING_CANDIDATES, `Scoring ${viable.length} viable symbols`);

    const scored = viable.map((pfResult) => {
      const scoreResult = computeScore(
        {
          distanceToBreakoutPct: pfResult.metrics.distanceToBreakoutPct,
          volumeRatio: pfResult.metrics.volumeRatio,
          atr: pfResult.metrics.atr,
          closePrice: pfResult.metrics.closePrice,
          riskReward: null,
        },
      );
      return { ...pfResult, scoreResult };
    });

    // ── Phase D: Shortlist top N ───────────────────────────────────────────────
    await setRuntimeStage(CYCLE_STAGES.SHORTLISTING, 'Shortlisting top candidates');

    const maxCandidates = config.trading.maxCandidatesPerCycle;
    const sortedScored = [...scored].sort((a, b) => b.scoreResult.total - a.scoreResult.total);
    const shortlist = sortedScored.slice(0, maxCandidates);
    const rankedOutItems = sortedScored.slice(maxCandidates);

    counters.shortlisted = shortlist.length;
    counters.rankedOut = rankedOutItems.length;

    // Record decisions for ranked-out symbols (scored but not shortlisted)
    for (let i = 0; i < rankedOutItems.length; i++) {
      const item = rankedOutItems[i];
      counters.scanned += 1;
      counters.rejected += 1;
      const rank = shortlist.length + i + 1;
      await recordDecision(
        {
          id: randomUUID(),
          approved: false,
          symbol: item.symbol,
          normalizedSymbol: item.symbol,
          assetClass: item.assetClass,
          strategyName: 'momentum_breakout_atr_v1',
          timestamp: nowIso(),
          timeframe: '15Min',
          reason: 'ranked_out',
          rejectStage: 'ranked_out',
          blockers: ['ranked_out'],
          metrics: {
            closePrice: item.metrics.closePrice,
            breakoutLevel: item.metrics.highestHigh,
            atr: item.metrics.atr,
            volumeRatio: item.metrics.volumeRatio,
            distanceToBreakoutPct: item.metrics.distanceToBreakoutPct,
          },
          setupScore: item.scoreResult.total,
          setupGrade: item.scoreResult.grade,
          scoreBreakdown: item.scoreResult.breakdown,
          context: item.scoreResult.context,
          rejectionClass: null,
        },
        {
          cycleId,
          stage: 'scored',
          rank,
          shortlisted: false,
          rankedOut: true,
          rejectStage: 'ranked_out',
        },
      );
      await appendCycleEvent({
        type: 'candidate_ranked_out',
        timestamp: nowIso(),
        cycleId,
        symbol: item.symbol,
        setupScore: item.scoreResult.total,
        rank,
      });
    }

    // ── Phase E: Strategy confirm on shortlist ────────────────────────────────
    await setRuntimeStage(CYCLE_STAGES.EVALUATING_SIGNALS, 'Running strategy on shortlisted symbols');

    const decisions = [];
    for (let i = 0; i < shortlist.length; i++) {
      const item = shortlist[i];
      const rank = i + 1;

      const decision = evaluateBreakout({
        symbol: item.symbol,
        assetClass: item.assetClass,
        bars: barsBySymbol[item.symbol],
        preFilterMetrics: item.metrics,
        accountEquity: equity,
        riskPercent,
      });

      const decisionWithId = { id: randomUUID(), ...decision };
      counters.scanned += 1;

      await recordDecision(decisionWithId, {
        cycleId,
        stage: decision.approved ? 'strategy' : 'strategy',
        rank,
        shortlisted: true,
        rankedOut: false,
        rejectStage: decision.approved ? null : (decision.rejectStage ?? 'strategy'),
      });

      if (!decision.approved) {
        counters.rejected += 1;
      }

      decisions.push(decisionWithId);
    }

    // ── Rank confirmed candidates ──────────────────────────────────────────────
    const approvedDecisions = decisions.filter((d) => d.approved);
    approvedDecisions.sort((a, b) => (b.setupScore ?? 0) - (a.setupScore ?? 0));
    const candidatePool = approvedDecisions.slice(0, maxCandidates);
    const furtherRankedOut = approvedDecisions.slice(maxCandidates);

    await setRuntimeStage(
      CYCLE_STAGES.RANKING_CANDIDATES,
      `Ranked ${candidatePool.length} candidates (${furtherRankedOut.length} further ranked out)`,
    );

    for (let i = 0; i < furtherRankedOut.length; i++) {
      const d = furtherRankedOut[i];
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
        candidates: candidatePool.map((d, i) => ({
          rank: i + 1,
          symbol: d.symbol,
          setupScore: d.setupScore ?? null,
          setupGrade: d.setupGrade ?? null,
        })),
      });
    }

    await setRuntimeStage(CYCLE_STAGES.APPLYING_RISK_GUARDS, 'Applying risk guards');

    // ── Per-symbol execution guards ───────────────────────────────────────────
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
    const portfolioResult = checkPortfolioRisk({
      candidates: perGuardPassed,
      openTrades: openTradesForPortfolio,
      brokerPositions: brokerPositionsForPortfolio,
      accountEquity: toNumber(account?.equity, 100000),
      riskState: riskStateForPortfolio,
      maxCandidatesOverride: maxCandidates,
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

    // ── Place orders ──────────────────────────────────────────────────────────
    const placements = [];
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
        preFiltered: counters.preFiltered,
        shortlisted: counters.shortlisted,
        rankedOut: counters.rankedOut,
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
      preFiltered: counters.preFiltered,
      shortlisted: counters.shortlisted,
      rankedOut: counters.rankedOut,
      startedAt,
      completedAt,
      triggerSource,
    };

    await setRuntimeStage(CYCLE_STAGES.COMPLETED, 'Cycle complete', { status: 'completed', currentSymbol: null });
    await appendCycleEvent({ type: 'cycle_complete', timestamp: completedAt, ...summary });
    await appendCycleEvent({ type: 'completed', timestamp: completedAt, ...summary });
    await completeCycleRuntime({ cycleId, message: 'Cycle complete', ...summary });

    const triggerLabel = triggerSource === 'manual' ? '[manual] ' : '';
    console.log(
      `[autopilot] ${triggerLabel}cycle completed — scanned: ${summary.scanned}, pre-filtered: ${summary.preFiltered}, shortlisted: ${summary.shortlisted}, approved: ${summary.approved}, placed: ${summary.placed}`,
    );

    return {
      cycleId,
      status: 'completed',
      triggerSource,
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
