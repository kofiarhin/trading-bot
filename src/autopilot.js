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
import { normalizeSymbol } from './utils/symbolNorm.js';
import { maybeForceTrade } from './strategies/forceTrade.js';

function toNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function roundPrice(value) {
  return Number(toNumber(value, 0).toFixed(2));
}

function average(values) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
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

function calculateAtr(bars, period = 14) {
  if (!bars.length) {
    return 0;
  }

  const startIndex = Math.max(1, bars.length - period);
  const trueRanges = [];

  for (let index = startIndex; index < bars.length; index += 1) {
    const currentBar = bars[index];
    const previousBar = bars[index - 1] ?? currentBar;
    const intrabarRange = currentBar.high - currentBar.low;
    const highToPreviousClose = Math.abs(currentBar.high - previousBar.close);
    const lowToPreviousClose = Math.abs(currentBar.low - previousBar.close);
    trueRanges.push(Math.max(intrabarRange, highToPreviousClose, lowToPreviousClose));
  }

  return average(trueRanges);
}

function inferAssetClass(symbol) {
  return typeof symbol === 'string' && symbol.includes('/') ? 'crypto' : 'stock';
}

function normalizeBar(bar) {
  return {
    timestamp: bar.t,
    open: toNumber(bar.o),
    high: toNumber(bar.h),
    low: toNumber(bar.l),
    close: toNumber(bar.c),
    volume: toNumber(bar.v),
  };
}

async function fetchBarsBySymbol(symbols) {
  const stockSymbols = symbols.filter((s) => inferAssetClass(s) === 'stock');
  const cryptoSymbols = symbols.filter((s) => inferAssetClass(s) === 'crypto');
  const results = {};

  // Stocks: use the multi-symbol limit-based endpoint (works outside market hours)
  if (stockSymbols.length) {
    try {
      const stockBars = await getBarsForSymbols(stockSymbols, { timeframe: '15Min', limit: 60 });
      Object.assign(results, stockBars);
    } catch (err) {
      console.error(`Failed to fetch stock bars: ${err.message}`);
      for (const s of stockSymbols) results[s] = [];
    }
  }

  // Crypto: must use the dedicated crypto endpoint — stocks endpoint rejects these symbols
  await Promise.all(
    cryptoSymbols.map(async (symbol) => {
      try {
        const rawBars = await fetchCryptoBars(symbol, 60);
        results[symbol] = rawBars.map(normalizeBar);
      } catch (err) {
        console.error(`Failed to fetch crypto bars for ${symbol}: ${err.message}`);
        results[symbol] = [];
      }
    }),
  );

  return results;
}

function buildDecision(symbol, bars, account) {
  const timestamp = nowIso();
  const normalizedSym = normalizeSymbol(symbol);
  const assetClass = inferAssetClass(symbol);

  if (!Array.isArray(bars) || bars.length < 21) {
    return {
      id: randomUUID(),
      symbol,
      normalizedSymbol: normalizedSym,
      assetClass,
      strategyName: 'breakout',
      timestamp,
      approved: false,
      side: 'buy',
      reason: 'insufficient_market_data',
      entryPrice: 0,
      stopLoss: 0,
      takeProfit: 0,
      quantity: 0,
      riskAmount: 0,
      metrics: {
        closePrice: 0,
        breakoutLevel: 0,
        atr: 0,
        volumeRatio: 0,
        distanceToBreakoutPct: 0,
      },
      blockers: ['insufficient_market_data'],
    };
  }

  const recentBars = bars.slice(-21);
  const priorBars = recentBars.slice(0, -1);
  const currentBar = recentBars[recentBars.length - 1];
  const close = toNumber(currentBar.close, 0);

  const forcedResult = maybeForceTrade({ symbol, assetClass, latestPrice: close });
  if (forcedResult) {
    const forcedQty = Number(process.env.FORCE_FIRST_TRADE_QTY ?? 0.001);
    const sl = Number((close * 0.99).toFixed(2));
    const tp = Number((close * 1.02).toFixed(2));
    return {
      id: randomUUID(),
      symbol,
      normalizedSymbol: normalizedSym,
      assetClass,
      strategyName: forcedResult.strategyName,
      timestamp,
      approved: true,
      side: 'buy',
      reason: forcedResult.reason,
      entryPrice: roundPrice(close),
      stopLoss: sl,
      takeProfit: tp,
      quantity: forcedQty,
      riskAmount: Number((close * 0.01 * forcedQty).toFixed(2)),
      metrics: forcedResult.metrics,
      isForced: true,
      blockers: [],
    };
  }

  const breakoutLevel = Math.max(...priorBars.map((bar) => toNumber(bar.high, 0)));
  const atr = calculateAtr(bars.slice(-15));
  const averageVolume = average(priorBars.slice(-10).map((bar) => toNumber(bar.volume, 0)));
  const volumeRatio = averageVolume ? toNumber(currentBar.volume, 0) / averageVolume : 0;
  const distanceToBreakoutPct = breakoutLevel ? ((close - breakoutLevel) / breakoutLevel) * 100 : 0;
  const stopLoss = roundPrice(close - atr * 1.5);
  const takeProfit = roundPrice(close + atr * 3);
  const riskPerShare = Math.max(roundPrice(close - stopLoss), 0.01);
  const riskBudget = toNumber(account?.equity, 100000) * 0.005;
  const quantity = Math.max(1, Math.floor(riskBudget / riskPerShare));
  const approved = close >= breakoutLevel && volumeRatio >= 1.2 && atr > 0;
  const blockers = approved ? [] : ['signal_not_confirmed'];

  return {
    id: randomUUID(),
    symbol,
    normalizedSymbol: normalizedSym,
    assetClass,
    strategyName: 'breakout',
    timestamp,
    approved,
    side: 'buy',
    reason: approved ? 'breakout_confirmed' : 'breakout_not_confirmed',
    entryPrice: roundPrice(close),
    stopLoss,
    takeProfit,
    quantity,
    riskAmount: riskPerShare,
    metrics: {
      closePrice: roundPrice(close),
      breakoutLevel: roundPrice(breakoutLevel),
      atr: roundPrice(atr),
      volumeRatio: Number(volumeRatio.toFixed(2)),
      distanceToBreakoutPct: Number(distanceToBreakoutPct.toFixed(2)),
    },
    blockers,
  };
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
  });
  await appendCycleEvent({
    type: 'decision_recorded',
    timestamp: nowIso(),
    decisionId: decision.id,
    symbol: decision.symbol,
    approved: decision.approved,
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
  }
}

export async function runAutopilotCycle(options = {}) {
  const dryRun = isDryRunEnabled(options);
  const cycleId = randomUUID();
  const startedAt = nowIso();

  const { session, allowCrypto, allowStocks } = resolveSession();

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
  });

  const account = await getAccount();

  // Filter the configured universe to assets eligible in the current session.
  const allSymbols = getConfiguredSymbols();
  const universeEntries = allSymbols.map((s) => ({
    symbol: s,
    assetClass: inferAssetClass(s) === 'crypto' ? 'crypto' : 'stock',
  }));
  const symbols = filterEligible(universeEntries).map((e) => e.symbol);
  const brokerPositionsBefore = await getPositions();
  const brokerOrdersBefore = await getOrders({ status: 'all', limit: 200, nested: true, direction: 'desc' });

  await syncTradesWithBroker({
    brokerPositions: brokerPositionsBefore,
    brokerOrders: brokerOrdersBefore,
  });

  await handleExits(dryRun);

  const barsBySymbol = await fetchBarsBySymbol(symbols);
  const decisions = symbols.map((symbol) => buildDecision(symbol, barsBySymbol[symbol] ?? [], account));

  for (const decision of decisions) {
    await recordDecision(decision);
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
    decision.blockers = guardResult.blockers;

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
 
