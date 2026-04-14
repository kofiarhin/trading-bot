import { randomUUID } from 'node:crypto';

import { normalizeSymbol } from '../utils/symbolNorm.js';
import { normalizeTradeForRead, normalizeTradeForWrite } from './normalizeTrade.js';
import { resolveSession } from '../utils/time.js';
import { enrichPosition } from './positionEnricher.js';
import {
  getOpenTrades as repoGetOpenTrades,
  getOpenTradeById as repoGetOpenTradeById,
  upsertOpenTrade,
  removeOpenTrade as repoRemoveOpenTrade,
  getClosedTrades as repoGetClosedTrades,
  upsertClosedTrade,
  getTradeEvents as repoGetTradeEvents,
  appendTradeEvent,
} from '../repositories/tradeJournalRepo.mongo.js';

function nowIso() {
  return new Date().toISOString();
}

function toNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function roundPrice(value) {
  return Number(toNumber(value, 0).toFixed(2));
}

function normalizeStatus(status) {
  return ['pending', 'open', 'closed', 'canceled'].includes(status) ? status : 'pending';
}

function calculatePnl(trade) {
  const entryPrice = toNumber(trade.entryPrice, 0);
  const exitPrice = toNumber(trade.exitPrice, 0);
  const quantity = toNumber(trade.quantity, 0);

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
    strategyName: trade.strategyName,
    ...details,
  };

  await appendTradeEvent(event);
  return event;
}

function buildCanonicalTradeRecord({ decision = {}, order = {}, trade = {}, source = 'autopilot' }) {
  const symbol = trade.symbol ?? decision.symbol ?? order.symbol ?? null;
  const normalizedSym = symbol ? normalizeSymbol(trade.normalizedSymbol ?? symbol) : null;

  const stopLoss =
    trade.stopLoss ?? decision.stopLoss ?? trade.stop ?? decision.stop ?? null;
  const takeProfit =
    trade.takeProfit ?? decision.takeProfit ?? trade.target ?? decision.target ?? null;
  const quantity = toNumber(
    trade.quantity ?? decision.quantity ?? trade.qty ?? decision.qty ?? order.qty,
    0,
  );
  const riskAmount = toNumber(
    trade.riskAmount ?? decision.riskAmount ?? trade.risk ?? decision.risk ?? 0,
    0,
  );
  const strategyName =
    trade.strategyName ?? decision.strategyName ?? trade.strategy ?? decision.strategy ?? 'breakout';

  const record = {
    tradeId: trade.tradeId ?? decision.tradeId ?? randomUUID(),
    symbol,
    normalizedSymbol: normalizedSym,
    assetClass: trade.assetClass ?? decision.assetClass ?? null,
    strategyName,
    entryPrice: trade.entryPrice ?? decision.entryPrice ?? null,
    stopLoss: stopLoss != null ? roundPrice(stopLoss) : null,
    takeProfit: takeProfit != null ? roundPrice(takeProfit) : null,
    quantity,
    riskAmount: riskAmount ? roundPrice(riskAmount) : 0,
    status: normalizeStatus(trade.status ?? 'pending'),
    openedAt: trade.openedAt ?? null,
    closedAt: trade.closedAt ?? null,
    exitPrice: trade.exitPrice ?? null,
    pnl: trade.pnl ?? null,
    pnlPct: trade.pnlPct ?? null,
    exitReason: trade.exitReason ?? null,
    metrics: trade.metrics ?? decision.metrics ?? {
      closePrice: toNumber(decision.entryPrice ?? decision.close, 0),
      breakoutLevel: toNumber(decision.breakoutLevel, 0),
      atr: toNumber(decision.atr, 0),
      volumeRatio: toNumber(decision.volumeRatio, 0),
      distanceToBreakoutPct: toNumber(decision.distanceToBreakoutPct, 0),
    },
    decisionId: trade.decisionId ?? decision.id ?? decision.decisionId ?? null,
    side: trade.side ?? decision.side ?? order.side ?? 'buy',
    pendingAt: trade.pendingAt ?? decision.timestamp ?? nowIso(),
    brokerOrderId: trade.brokerOrderId ?? order.id ?? null,
    brokerClientOrderId: trade.brokerClientOrderId ?? order.client_order_id ?? null,
    orphaned: Boolean(trade.orphaned ?? false),
    source: trade.source ?? source,
    notes: trade.notes ?? null,
    setupScore: trade.setupScore ?? decision.setupScore ?? null,
    setupGrade: trade.setupGrade ?? decision.setupGrade ?? null,
    updatedAt: nowIso(),
  };

  return normalizeTradeForWrite(record);
}

function inferCloseReason(trade, brokerOrders = []) {
  const matchingOrders = brokerOrders.filter((order) => {
    const orderSymbol = order.symbol ?? order.asset_symbol;
    return orderSymbol === trade.symbol;
  });

  for (const order of matchingOrders) {
    const orderSide = order.side ?? '';
    const oppositeSide = trade.side === 'buy' ? 'sell' : 'buy';

    if (orderSide !== oppositeSide) continue;

    const stopPrice = toNumber(order.stop_price, 0);
    const limitPrice = toNumber(order.limit_price, 0);

    if (stopPrice && trade.stopLoss && Math.abs(stopPrice - trade.stopLoss) < 0.05) return 'stop_hit';
    if (limitPrice && trade.takeProfit && Math.abs(limitPrice - trade.takeProfit) < 0.05) return 'target_hit';
    if ((order.type ?? '').includes('stop')) return 'stop_hit';
    if ((order.type ?? '') === 'limit') return 'target_hit';
  }

  return 'broker_sync';
}

function findMatchingOrder(trade, brokerOrders = []) {
  return brokerOrders.find((order) => {
    if (trade.brokerOrderId && order.id === trade.brokerOrderId) return true;
    if (trade.brokerClientOrderId && order.client_order_id === trade.brokerClientOrderId) return true;
    return (order.symbol ?? order.asset_symbol) === trade.symbol;
  });
}

export async function getOpenTrades() {
  const docs = await repoGetOpenTrades();
  return docs.map(normalizeTradeForRead).filter(Boolean);
}

export async function getClosedTrades() {
  const docs = await repoGetClosedTrades();
  return docs.map(normalizeTradeForRead).filter(Boolean);
}

export async function getTradeEvents() {
  return repoGetTradeEvents();
}

export async function createPendingTrade({ decision, order = {}, source = 'autopilot' }) {
  const openTrades = await getOpenTrades();
  const existingTrade = openTrades.find((trade) => {
    if (decision?.id && trade.decisionId === decision.id) return true;
    if (order?.id && trade.brokerOrderId === order.id) return true;
    return trade.symbol === decision?.symbol && ['pending', 'open'].includes(trade.status);
  });

  const nextTrade = buildCanonicalTradeRecord({
    decision,
    order,
    trade: existingTrade ?? { tradeId: randomUUID(), status: 'pending' },
    source,
  });

  nextTrade.status = 'pending';
  nextTrade.pendingAt = nextTrade.pendingAt ?? nowIso();
  nextTrade.orphaned = false;

  await upsertOpenTrade(nextTrade);
  await persistTradeEvent('trade_pending', nextTrade, {
    decisionId: nextTrade.decisionId,
    brokerOrderId: nextTrade.brokerOrderId,
  });

  return nextTrade;
}

export async function markTradeOpen({ tradeId, symbol, order = {}, brokerPosition = {}, source = 'autopilot' }) {
  const openTrades = await getOpenTrades();
  const matchingTrade = openTrades.find((trade) => {
    if (tradeId && trade.tradeId === tradeId) return true;
    if (order?.id && trade.brokerOrderId === order.id) return true;
    return trade.symbol === (symbol ?? brokerPosition.symbol ?? order.symbol);
  });

  if (!matchingTrade) {
    const brokerBackedTrade = buildCanonicalTradeRecord({
      decision: {
        symbol: symbol ?? brokerPosition.symbol ?? order.symbol,
        quantity: brokerPosition.qty ?? order.qty,
        stopLoss: brokerPosition.stop_price,
        takeProfit: brokerPosition.target_price,
      },
      order,
      trade: {
        tradeId: randomUUID(),
        status: 'open',
        entryPrice: brokerPosition.avg_entry_price ?? order.filled_avg_price,
        openedAt: nowIso(),
        strategyName: 'broker_sync',
      },
      source: 'broker_sync',
    });

    await upsertOpenTrade(brokerBackedTrade);
    await persistTradeEvent('trade_open', brokerBackedTrade, {
      brokerOrderId: brokerBackedTrade.brokerOrderId,
      source: 'broker_sync',
    });
    return brokerBackedTrade;
  }

  const nextTrade = normalizeTradeForWrite({
    ...matchingTrade,
    status: 'open',
    quantity: toNumber(brokerPosition.qty, matchingTrade.quantity),
    entryPrice:
      toNumber(brokerPosition.avg_entry_price, 0) ||
      toNumber(order.filled_avg_price, 0) ||
      toNumber(matchingTrade.entryPrice, 0) ||
      toNumber(matchingTrade.metrics?.closePrice ?? matchingTrade.metrics?.close, 0) ||
      null,
    brokerOrderId: matchingTrade.brokerOrderId ?? order.id ?? null,
    brokerClientOrderId: matchingTrade.brokerClientOrderId ?? order.client_order_id ?? null,
    openedAt: matchingTrade.openedAt ?? order.filled_at ?? nowIso(),
    orphaned: false,
    source,
    updatedAt: nowIso(),
  });

  await upsertOpenTrade(nextTrade);
  await persistTradeEvent('trade_open', nextTrade, { brokerOrderId: nextTrade.brokerOrderId });

  return nextTrade;
}

export async function markTradeClosed({ tradeId, symbol, reason = 'broker_sync', brokerOrder = {}, brokerPosition = {} }) {
  const openTrades = await getOpenTrades();
  const matchingTrade = openTrades.find((trade) => {
    if (tradeId && trade.tradeId === tradeId) return true;
    return trade.symbol === (symbol ?? brokerPosition.symbol ?? brokerOrder.symbol);
  });

  if (!matchingTrade) return null;

  const closedAt = brokerOrder.filled_at ?? nowIso();
  const exitPrice =
    toNumber(brokerOrder.filled_avg_price, 0) ||
    toNumber(brokerPosition.current_price, 0) ||
    toNumber(matchingTrade.exitPrice, 0) ||
    null;

  const closedTrade = {
    ...matchingTrade,
    status: 'closed',
    closedAt,
    exitPrice,
    orphaned: false,
    exitReason: reason,
    updatedAt: nowIso(),
  };

  closedTrade.pnl = calculatePnl(closedTrade);
  if (closedTrade.entryPrice && closedTrade.exitPrice) {
    closedTrade.pnlPct = Number(
      (((closedTrade.exitPrice - closedTrade.entryPrice) / closedTrade.entryPrice) * 100).toFixed(4),
    );
  }

  // ── Enrichment fields (Phase 7) ──────────────────────────────────────────
  // R multiple: (exitPrice - entryPrice) / riskPerUnit
  const entryNum = toNumber(matchingTrade.entryPrice, 0);
  const stopNum = toNumber(matchingTrade.stopLoss, 0);
  if (entryNum > 0 && exitPrice != null && stopNum > 0 && entryNum > stopNum) {
    const riskPerUnit = entryNum - stopNum;
    closedTrade.rMultiple = Number(((exitPrice - entryNum) / riskPerUnit).toFixed(4));
  }

  // Duration in minutes
  const openedAtMs = matchingTrade.openedAt ? new Date(matchingTrade.openedAt).getTime() : null;
  const closedAtMs = new Date(closedAt).getTime();
  if (openedAtMs && Number.isFinite(openedAtMs) && Number.isFinite(closedAtMs)) {
    closedTrade.durationMinutes = Math.round((closedAtMs - openedAtMs) / 60000);
  }

  // Session at close time
  const { session } = resolveSession();
  closedTrade.session = session;

  // Copy setup score/grade from the open trade record
  if (matchingTrade.setupScore != null) closedTrade.setupScore = matchingTrade.setupScore;
  if (matchingTrade.setupGrade != null) closedTrade.setupGrade = matchingTrade.setupGrade;

  const canonicalClosed = normalizeTradeForWrite(closedTrade);

  await repoRemoveOpenTrade(matchingTrade.tradeId);
  await upsertClosedTrade(canonicalClosed);
  await persistTradeEvent('trade_closed', canonicalClosed, {
    reason,
    brokerOrderId: canonicalClosed.brokerOrderId,
    pnl: canonicalClosed.pnl,
  });

  return canonicalClosed;
}

export async function syncTradesWithBroker({ brokerPositions = [], brokerOrders = [] }) {
  const openTrades = await getOpenTrades();
  const openSymbols = new Set(openTrades.map((trade) => trade.symbol));

  for (const trade of openTrades) {
    const brokerPosition = brokerPositions.find((p) => p.symbol === trade.symbol);
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
        await markTradeClosed({ tradeId: trade.tradeId, brokerOrder, reason: `order_${orderStatus}` });
      }

      continue;
    }

    if (trade.status === 'open') {
      const isBrokerSyncTrade = trade.strategyName === 'broker_sync';
      const reason = isBrokerSyncTrade
        ? 'broker_sync_reconciled'
        : inferCloseReason(trade, brokerOrders);
      await markTradeClosed({ tradeId: trade.tradeId, brokerOrder, reason });
    }
  }

  for (const brokerPosition of brokerPositions) {
    if (openSymbols.has(brokerPosition.symbol)) continue;
    await markTradeOpen({ symbol: brokerPosition.symbol, brokerPosition, source: 'broker_sync' });
  }

  return getOpenTrades();
}

export async function mergeBrokerPositionsWithJournal(brokerPositions = []) {
  const openTrades = await getOpenTrades();

  const mergedBrokerPositions = (brokerPositions ?? []).map((brokerPosition) => {
    const matchingTrade = openTrades.find((trade) => trade.symbol === brokerPosition.symbol);
    const enriched = enrichPosition(matchingTrade ?? null, brokerPosition);

    return {
      symbol: brokerPosition.symbol,
      qty: toNumber(brokerPosition.qty, 0),
      side: toNumber(brokerPosition.qty, 0) >= 0 ? 'buy' : 'sell',
      avgEntryPrice: toNumber(brokerPosition.avg_entry_price, 0),
      currentPrice: toNumber(brokerPosition.current_price, 0),
      marketValue: toNumber(brokerPosition.market_value, 0),
      unrealizedPnL: toNumber(brokerPosition.unrealized_pl, 0),
      strategyName: matchingTrade?.strategyName ?? 'broker_sync',
      openedAt: matchingTrade?.openedAt ?? null,
      pendingAt: matchingTrade?.pendingAt ?? null,
      status: matchingTrade?.status ?? 'open',
      // Risk fields — prefer enriched derivation over raw journal value to
      // guarantee stopLoss/takeProfit are either properly sourced or explicitly null.
      stopLoss: enriched.stopLoss,
      takeProfit: enriched.takeProfit,
      riskPerUnit: enriched.riskPerUnit,
      riskAmount: enriched.riskAmount ?? matchingTrade?.riskAmount ?? null,
      // Enrichment metadata
      origin: enriched.origin,
      managementStatus: enriched.managementStatus,
      riskSource: enriched.riskSource,
      exitCoverage: enriched.exitCoverage,
      metrics: matchingTrade?.metrics ?? null,
      close: matchingTrade?.metrics?.closePrice ?? matchingTrade?.metrics?.close ?? null,
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
    .filter((trade) => trade.status === 'pending' && !brokerPositions.find((p) => p.symbol === trade.symbol))
    .map((trade) => {
      const enriched = enrichPosition(trade, null);
      return {
        symbol: trade.symbol,
        qty: trade.quantity,
        side: trade.side,
        avgEntryPrice: trade.entryPrice,
        currentPrice: null,
        marketValue: null,
        unrealizedPnL: null,
        strategyName: trade.strategyName,
        openedAt: trade.openedAt,
        pendingAt: trade.pendingAt,
        status: trade.status,
        stopLoss: enriched.stopLoss,
        takeProfit: enriched.takeProfit,
        riskPerUnit: enriched.riskPerUnit,
        riskAmount: enriched.riskAmount ?? trade.riskAmount ?? null,
        origin: enriched.origin,
        managementStatus: enriched.managementStatus,
        riskSource: enriched.riskSource,
        exitCoverage: enriched.exitCoverage,
        metrics: trade.metrics,
        close: trade.metrics?.closePrice ?? trade.metrics?.close ?? null,
        breakoutLevel: trade.metrics?.breakoutLevel ?? null,
        atr: trade.metrics?.atr ?? null,
        volumeRatio: trade.metrics?.volumeRatio ?? null,
        distanceToBreakoutPct: trade.metrics?.distanceToBreakoutPct ?? null,
        orphaned: false,
        broker: null,
        journal: trade,
      };
    });

  return [...mergedBrokerPositions, ...pendingTrades];
}

export async function getOpenTradeById(tradeId) {
  const doc = await repoGetOpenTradeById(tradeId);
  return doc ? normalizeTradeForRead(doc) : null;
}

export async function addOpenTrade(trade) {
  await upsertOpenTrade({ ...trade, updatedAt: nowIso() });
  return trade;
}

export async function removeOpenTrade(tradeId) {
  await repoRemoveOpenTrade(tradeId);
}

export async function addClosedTrade(trade) {
  await upsertClosedTrade(normalizeTradeForWrite(trade));
  return trade;
}

export async function markTradeCanceled({ tradeId, reason = 'canceled' }) {
  const trade = await repoGetOpenTradeById(tradeId);
  if (!trade) return;
  await upsertOpenTrade({ ...trade, status: 'canceled', cancelReason: reason, updatedAt: nowIso() });
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
