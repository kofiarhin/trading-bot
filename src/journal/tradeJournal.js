import { randomUUID } from 'node:crypto';

import {
  appendDailyRecord,
  appendJsonArray,
  getStoragePath,
  nowIso,
  readJson,
  writeJson,
} from '../lib/storage.js';

export const openTradesPath = getStoragePath('trades', 'open.json');
export const closedTradesPath = getStoragePath('trades', 'closed.json');
export const tradeEventsPath = getStoragePath('trades', 'events.json');

function toNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function roundPrice(value) {
  return Number(toNumber(value, 0).toFixed(2));
}

function normalizeStatus(status) {
  return ['pending', 'open', 'closed'].includes(status) ? status : 'pending';
}

function calculatePnl(trade) {
  const entryPrice = toNumber(trade.entryPrice, 0);
  const exitPrice = toNumber(trade.exitPrice, 0);
  const quantity = toNumber(trade.qty, 0);

  if (!entryPrice || !exitPrice || !quantity) {
    return 0;
  }

  const multiplier = trade.side === 'sell' ? -1 : 1;
  return Number(((exitPrice - entryPrice) * quantity * multiplier).toFixed(2));
}

async function persistTradeEvent(type, trade, details = {}) {
  const event = {
    id: randomUUID(),
    type,
    tradeId: trade.tradeId,
    symbol: trade.symbol,
    timestamp: details.timestamp ?? nowIso(),
    status: trade.status,
    strategy: trade.strategy,
    ...details,
  };

  await appendJsonArray(tradeEventsPath, event);
  await appendDailyRecord('journal', event);
  return event;
}

function buildTradeRecord({ decision = {}, order = {}, trade = {}, source = 'autopilot' }) {
  return {
    tradeId: trade.tradeId ?? decision.tradeId ?? randomUUID(),
    decisionId: decision.id ?? trade.decisionId ?? null,
    symbol: trade.symbol ?? decision.symbol ?? order.symbol ?? null,
    strategy: trade.strategy ?? decision.strategy ?? 'breakout',
    side: trade.side ?? decision.side ?? order.side ?? 'buy',
    qty: toNumber(trade.qty ?? decision.qty ?? decision.quantity ?? order.qty, 0),
    status: normalizeStatus(trade.status ?? 'pending'),
    pendingAt: trade.pendingAt ?? decision.timestamp ?? nowIso(),
    openedAt: trade.openedAt ?? null,
    closedAt: trade.closedAt ?? null,
    entryPrice: trade.entryPrice ?? null,
    exitPrice: trade.exitPrice ?? null,
    brokerOrderId: trade.brokerOrderId ?? order.id ?? null,
    brokerClientOrderId: trade.brokerClientOrderId ?? order.client_order_id ?? null,
    stop: roundPrice(trade.stop ?? decision.stop ?? 0),
    target: roundPrice(trade.target ?? decision.target ?? 0),
    risk: roundPrice(trade.risk ?? decision.risk ?? decision.riskPerShare ?? 0),
    orphaned: Boolean(trade.orphaned ?? false),
    source: trade.source ?? source,
    metrics: {
      close: toNumber(trade.metrics?.close ?? decision.close, 0),
      breakoutLevel: toNumber(trade.metrics?.breakoutLevel ?? decision.breakoutLevel, 0),
      atr: toNumber(trade.metrics?.atr ?? decision.atr, 0),
      volumeRatio: toNumber(trade.metrics?.volumeRatio ?? decision.volumeRatio, 0),
      distanceToBreakoutPct: toNumber(
        trade.metrics?.distanceToBreakoutPct ?? decision.distanceToBreakoutPct,
        0,
      ),
    },
    notes: trade.notes ?? null,
    updatedAt: nowIso(),
  };
}

function inferCloseReason(trade, brokerOrders = []) {
  const matchingOrders = brokerOrders.filter((order) => {
    const orderSymbol = order.symbol ?? order.asset_symbol;
    return orderSymbol === trade.symbol;
  });

  for (const order of matchingOrders) {
    const orderSide = order.side ?? '';
    const oppositeSide = trade.side === 'buy' ? 'sell' : 'buy';

    if (orderSide !== oppositeSide) {
      continue;
    }

    const stopPrice = toNumber(order.stop_price, 0);
    const limitPrice = toNumber(order.limit_price, 0);

    if (stopPrice && trade.stop && Math.abs(stopPrice - trade.stop) < 0.05) {
      return 'stop_hit';
    }

    if (limitPrice && trade.target && Math.abs(limitPrice - trade.target) < 0.05) {
      return 'target_hit';
    }

    if ((order.type ?? '').includes('stop')) {
      return 'stop_hit';
    }

    if ((order.type ?? '') === 'limit') {
      return 'target_hit';
    }
  }

  return 'broker_sync';
}

function findMatchingOrder(trade, brokerOrders = []) {
  return brokerOrders.find((order) => {
    if (trade.brokerOrderId && order.id === trade.brokerOrderId) {
      return true;
    }

    if (trade.brokerClientOrderId && order.client_order_id === trade.brokerClientOrderId) {
      return true;
    }

    return (order.symbol ?? order.asset_symbol) === trade.symbol;
  });
}

export async function getOpenTrades() {
  return readJson(openTradesPath, []);
}

export async function getClosedTrades() {
  return readJson(closedTradesPath, []);
}

export async function getTradeEvents() {
  return readJson(tradeEventsPath, []);
}

export async function createPendingTrade({ decision, order = {}, source = 'autopilot' }) {
  const openTrades = await getOpenTrades();
  const existingTrade = openTrades.find((trade) => {
    if (decision?.id && trade.decisionId === decision.id) {
      return true;
    }

    if (order?.id && trade.brokerOrderId === order.id) {
      return true;
    }

    return trade.symbol === decision?.symbol && ['pending', 'open'].includes(trade.status);
  });

  const nextTrade = buildTradeRecord({
    decision,
    order,
    trade: existingTrade ?? { tradeId: randomUUID(), status: 'pending' },
    source,
  });

  nextTrade.status = 'pending';
  nextTrade.pendingAt = nextTrade.pendingAt ?? nowIso();
  nextTrade.orphaned = false;

  const updatedTrades = existingTrade
    ? openTrades.map((trade) => (trade.tradeId === existingTrade.tradeId ? nextTrade : trade))
    : [...openTrades, nextTrade];

  await writeJson(openTradesPath, updatedTrades);
  await persistTradeEvent('trade_pending', nextTrade, {
    decisionId: nextTrade.decisionId,
    brokerOrderId: nextTrade.brokerOrderId,
  });

  return nextTrade;
}

export async function markTradeOpen({ tradeId, symbol, order = {}, brokerPosition = {}, source = 'autopilot' }) {
  const openTrades = await getOpenTrades();
  const matchingTrade = openTrades.find((trade) => {
    if (tradeId && trade.tradeId === tradeId) {
      return true;
    }

    if (order?.id && trade.brokerOrderId === order.id) {
      return true;
    }

    return trade.symbol === (symbol ?? brokerPosition.symbol ?? order.symbol);
  });

  if (!matchingTrade) {
    const brokerBackedTrade = buildTradeRecord({
      decision: {
        symbol: symbol ?? brokerPosition.symbol ?? order.symbol,
        qty: brokerPosition.qty ?? order.qty,
        stop: brokerPosition.stop_price,
        target: brokerPosition.target_price,
      },
      order,
      trade: {
        tradeId: randomUUID(),
        status: 'open',
        entryPrice: brokerPosition.avg_entry_price ?? order.filled_avg_price,
        openedAt: nowIso(),
        strategy: 'broker_sync',
      },
      source: 'broker_sync',
    });

    const nextTrades = [...openTrades, brokerBackedTrade];
    await writeJson(openTradesPath, nextTrades);
    await persistTradeEvent('trade_open', brokerBackedTrade, {
      brokerOrderId: brokerBackedTrade.brokerOrderId,
      source: 'broker_sync',
    });
    return brokerBackedTrade;
  }

  const nextTrade = {
    ...matchingTrade,
    status: 'open',
    qty: toNumber(brokerPosition.qty, matchingTrade.qty),
    entryPrice:
      toNumber(brokerPosition.avg_entry_price, 0) ||
      toNumber(order.filled_avg_price, 0) ||
      toNumber(matchingTrade.entryPrice, 0) ||
      toNumber(matchingTrade.metrics?.close, 0) ||
      null,
    brokerOrderId: matchingTrade.brokerOrderId ?? order.id ?? null,
    brokerClientOrderId: matchingTrade.brokerClientOrderId ?? order.client_order_id ?? null,
    openedAt: matchingTrade.openedAt ?? order.filled_at ?? nowIso(),
    orphaned: false,
    source,
    updatedAt: nowIso(),
  };

  const updatedTrades = openTrades.map((trade) => (trade.tradeId === matchingTrade.tradeId ? nextTrade : trade));
  await writeJson(openTradesPath, updatedTrades);
  await persistTradeEvent('trade_open', nextTrade, {
    brokerOrderId: nextTrade.brokerOrderId,
  });

  return nextTrade;
}

export async function markTradeClosed({ tradeId, symbol, reason = 'broker_sync', brokerOrder = {}, brokerPosition = {} }) {
  const openTrades = await getOpenTrades();
  const closedTrades = await getClosedTrades();
  const matchingTrade = openTrades.find((trade) => {
    if (tradeId && trade.tradeId === tradeId) {
      return true;
    }

    return trade.symbol === (symbol ?? brokerPosition.symbol ?? brokerOrder.symbol);
  });

  if (!matchingTrade) {
    return null;
  }

  const remainingOpenTrades = openTrades.filter((trade) => trade.tradeId !== matchingTrade.tradeId);
  const closedTrade = {
    ...matchingTrade,
    status: 'closed',
    closedAt: brokerOrder.filled_at ?? nowIso(),
    exitPrice:
      toNumber(brokerOrder.filled_avg_price, 0) ||
      toNumber(brokerPosition.current_price, 0) ||
      toNumber(matchingTrade.exitPrice, 0) ||
      null,
    orphaned: false,
    closeReason: reason,
    updatedAt: nowIso(),
  };

  closedTrade.pnl = calculatePnl(closedTrade);

  const nextClosedTrades = [
    ...closedTrades.filter((trade) => trade.tradeId !== closedTrade.tradeId),
    closedTrade,
  ];

  await writeJson(openTradesPath, remainingOpenTrades);
  await writeJson(closedTradesPath, nextClosedTrades);
  await persistTradeEvent('trade_closed', closedTrade, {
    reason,
    brokerOrderId: closedTrade.brokerOrderId,
    pnl: closedTrade.pnl,
  });

  return closedTrade;
}

export async function syncTradesWithBroker({ brokerPositions = [], brokerOrders = [] }) {
  const openTrades = await getOpenTrades();
  const openSymbols = new Set(openTrades.map((trade) => trade.symbol));

  for (const trade of openTrades) {
    const brokerPosition = brokerPositions.find((position) => position.symbol === trade.symbol);
    const brokerOrder = findMatchingOrder(trade, brokerOrders);

    if (brokerPosition) {
      if (trade.status !== 'open') {
        await markTradeOpen({ tradeId: trade.tradeId, brokerPosition, source: 'broker_sync' });
      }

      continue;
    }

    if (trade.status === 'pending') {
      const orderStatus = brokerOrder?.status ?? '';

      if (orderStatus === 'filled') {
        await markTradeOpen({ tradeId: trade.tradeId, order: brokerOrder, source: 'broker_sync' });
        continue;
      }

      if (['new', 'accepted', 'pending_new', 'accepted_for_bidding', 'partially_filled', 'held'].includes(orderStatus)) {
        continue;
      }

      if (['canceled', 'expired', 'rejected'].includes(orderStatus)) {
        await markTradeClosed({
          tradeId: trade.tradeId,
          brokerOrder,
          reason: `order_${orderStatus}`,
        });
      }

      continue;
    }

    if (trade.status === 'open') {
      const reason = inferCloseReason(trade, brokerOrders);
      await markTradeClosed({ tradeId: trade.tradeId, brokerOrder, reason });
    }
  }

  for (const brokerPosition of brokerPositions) {
    if (openSymbols.has(brokerPosition.symbol)) {
      continue;
    }

    await markTradeOpen({
      symbol: brokerPosition.symbol,
      brokerPosition,
      source: 'broker_sync',
    });
  }

  return getOpenTrades();
}

export async function mergeBrokerPositionsWithJournal(brokerPositions = []) {
  const openTrades = await getOpenTrades();

  const mergedBrokerPositions = (brokerPositions ?? []).map((brokerPosition) => {
    const matchingTrade = openTrades.find((trade) => trade.symbol === brokerPosition.symbol);

    return {
      symbol: brokerPosition.symbol,
      qty: toNumber(brokerPosition.qty, 0),
      side: toNumber(brokerPosition.qty, 0) >= 0 ? 'buy' : 'sell',
      avgEntryPrice: toNumber(brokerPosition.avg_entry_price, 0),
      currentPrice: toNumber(brokerPosition.current_price, 0),
      marketValue: toNumber(brokerPosition.market_value, 0),
      unrealizedPnL: toNumber(brokerPosition.unrealized_pl, 0),
      strategy: matchingTrade?.strategy ?? 'broker_sync',
      openedAt: matchingTrade?.openedAt ?? null,
      pendingAt: matchingTrade?.pendingAt ?? null,
      status: matchingTrade?.status ?? 'open',
      stop: matchingTrade?.stop ?? null,
      target: matchingTrade?.target ?? null,
      risk: matchingTrade?.risk ?? null,
      metrics: matchingTrade?.metrics ?? null,
      close: matchingTrade?.metrics?.close ?? null,
      breakoutLevel: matchingTrade?.metrics?.breakoutLevel ?? null,
      atr: matchingTrade?.metrics?.atr ?? null,
      volumeRatio: matchingTrade?.metrics?.volumeRatio ?? null,
      distanceToBreakoutPct: matchingTrade?.metrics?.distanceToBreakoutPct ?? null,
      orphaned: !matchingTrade,
      broker: brokerPosition,
      journal: matchingTrade ?? null,
    };
  });

  const pendingTrades = openTrades
    .filter((trade) => trade.status === 'pending' && !brokerPositions.find((position) => position.symbol === trade.symbol))
    .map((trade) => ({
      symbol: trade.symbol,
      qty: trade.qty,
      side: trade.side,
      avgEntryPrice: trade.entryPrice,
      currentPrice: null,
      marketValue: null,
      unrealizedPnL: null,
      strategy: trade.strategy,
      openedAt: trade.openedAt,
      pendingAt: trade.pendingAt,
      status: trade.status,
      stop: trade.stop,
      target: trade.target,
      risk: trade.risk,
      metrics: trade.metrics,
      close: trade.metrics?.close ?? null,
      breakoutLevel: trade.metrics?.breakoutLevel ?? null,
      atr: trade.metrics?.atr ?? null,
      volumeRatio: trade.metrics?.volumeRatio ?? null,
      distanceToBreakoutPct: trade.metrics?.distanceToBreakoutPct ?? null,
      orphaned: false,
      broker: null,
      journal: trade,
    }));

  return [...mergedBrokerPositions, ...pendingTrades];
}

export async function getOpenTradeById(tradeId) {
  const trades = await readJson(openTradesPath, []);
  return trades.find((t) => t.tradeId === tradeId) ?? null;
}

export async function addOpenTrade(trade) {
  const trades = await readJson(openTradesPath, []);
  const idx = trades.findIndex((t) => t.tradeId === trade.tradeId);
  const updated = idx >= 0
    ? trades.map((t, i) => (i === idx ? { ...t, ...trade, updatedAt: nowIso() } : t))
    : [...trades, { ...trade, updatedAt: nowIso() }];
  await writeJson(openTradesPath, updated);
  return trade;
}

export async function removeOpenTrade(tradeId) {
  const trades = await readJson(openTradesPath, []);
  await writeJson(openTradesPath, trades.filter((t) => t.tradeId !== tradeId));
}

export async function addClosedTrade(trade) {
  const closed = await readJson(closedTradesPath, []);
  const filtered = closed.filter((t) => t.tradeId !== trade.tradeId);
  await writeJson(closedTradesPath, [...filtered, trade]);
  return trade;
}

export async function markTradeCanceled({ tradeId, reason = 'canceled' }) {
  const trades = await readJson(openTradesPath, []);
  const updated = trades.map((t) =>
    t.tradeId === tradeId ? { ...t, status: 'canceled', cancelReason: reason, updatedAt: nowIso() } : t,
  );
  await writeJson(openTradesPath, updated);
}

export default {
  createPendingTrade,
  markTradeOpen,
  markTradeClosed,
  markTradeCanceled,
  syncTradesWithBroker,
  mergeBrokerPositionsWithJournal,
  getOpenTrades,
  getOpenTradeById,
  addOpenTrade,
  removeOpenTrade,
  addClosedTrade,
  getClosedTrades,
  getTradeEvents,
};
