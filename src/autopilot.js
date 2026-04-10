import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { placeOrder } from './execution/orderManager.js';
import { getAccount, getBarsForSymbols, getOrders, getPositions, isDryRunEnabled } from './lib/alpaca.js';
import { appendDailyRecord, appendLogEvent, getStoragePath, nowIso, readJson } from './lib/storage.js';
import {
  getOpenTrades,
  syncTradesWithBroker,
} from './journal/tradeJournal.js';
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
  const rawSymbols =
    process.env.AUTOPILOT_SYMBOLS ??
    process.env.SYMBOLS ??
    process.env.WATCHLIST ??
    process.env.TICKERS ??
    'AAPL';

  return [...new Set(rawSymbols.split(',').map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
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
  return readJson(getStoragePath('riskState.json'), {
    dailyLossPct: 0,
    halted: false,
  });
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
  await appendDailyRecord('decisions', decision);
  await appendLogEvent('decision_recorded', {
    decisionId: decision.id,
    symbol: decision.symbol,
    approved: decision.approved,
    strategyName: decision.strategyName,
    metrics: decision.metrics,
  });
}

async function recordApproval(decision, blockers) {
  await appendLogEvent(blockers.length ? 'decision_blocked' : 'decision_approved', {
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

  await appendLogEvent('cycle_start', {
    id: cycleId,
    cycleId,
    dryRun,
    startedAt,
  });

  const account = await getAccount();
  const symbols = getConfiguredSymbols();
  const brokerPositionsBefore = await getPositions();
  const brokerOrdersBefore = await getOrders({ status: 'all', limit: 200, nested: true, direction: 'desc' });

  await syncTradesWithBroker({
    brokerPositions: brokerPositionsBefore,
    brokerOrders: brokerOrdersBefore,
  });

  await handleExits(dryRun);

  const barsBySymbol = await getBarsForSymbols(symbols, { timeframe: '15Min', limit: 60 });
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
      await appendLogEvent('order_skipped', {
        decisionId: decision.id,
        symbol: decision.symbol,
        reason: placement.message,
        dryRun: placement.dryRun,
      });
      continue;
    }

    placedCount += 1;

    await appendLogEvent('order_submitted', {
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
    scanned: decisions.length,
    approved: approvedCount,
    placed: placedCount,
    startedAt,
    completedAt: nowIso(),
  };

  await appendLogEvent('cycle_complete', summary);

  console.log(`approved: ${summary.approved}`);
  console.log(`placed: ${summary.placed}`);

  return {
    summary,
    decisions,
    placements,
  };
}

export default runAutopilotCycle;

const executedFile = process.argv[1]?.replace(/\\/g, '/');
if (executedFile?.endsWith('/src/autopilot.js')) {
  runAutopilotCycle().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
 
