import { randomUUID } from 'node:crypto';

import { normalizeSymbol } from '../utils/symbolNorm.js';
import { normalizeTradeForRead, normalizeTradeForWrite } from './normalizeTrade.js';
import { resolveSession } from '../utils/time.js';
import { enrichPosition } from './positionEnricher.js';
import { isValidPrice, resolveEntryPrice } from './entryPriceResolver.js';
import { isActiveTradeStatus } from './tradeStatus.js';
import {
  BOT_STOP_PREFIX,
  STOP_ORDER_TYPES,
  describeProtection,
  flattenOrders,
} from './protectionState.js';
import { logger } from '../utils/logger.js';
import { recordTradeOutcome } from '../risk/riskState.js';
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

function symbolKey(symbol) {
  return symbol ? normalizeSymbol(String(symbol)) : '';
}

function sameSymbol(a, b) {
  return Boolean(a) && Boolean(b) && symbolKey(a) === symbolKey(b);
}

function tradeSymbol(trade) {
  return trade?.normalizedSymbol ?? trade?.symbol;
}

/** First argument that is a valid (finite, > 0) price, else null. */
function firstValidPrice(...values) {
  for (const value of values) {
    if (isValidPrice(value)) return Number(value);
  }
  return null;
}

function assetClassFromBroker(brokerPosition = {}) {
  if (brokerPosition.asset_class === 'crypto') return 'crypto';
  if (brokerPosition.asset_class === 'us_equity') return 'stock';
  return null;
}

function roundPrice(value) {
  return Number(toNumber(value, 0).toFixed(2));
}

function normalizeStatus(status) {
  return ['pending', 'open', 'closing', 'closed', 'canceled'].includes(status) ? status : 'pending';
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
  const matchingOrders = flattenOrders(brokerOrders).filter((order) =>
    sameSymbol(order.symbol ?? order.asset_symbol, tradeSymbol(trade)),
  );

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

function isProtectiveOrder(order) {
  return (
    STOP_ORDER_TYPES.has(order.type ?? order.order_type) ||
    String(order.client_order_id ?? '').startsWith(BOT_STOP_PREFIX)
  );
}

/**
 * Finds the entry order for a trade. Matches by broker id first; the symbol
 * fallback only considers entry-side, non-stop orders so a protective stop is
 * never mistaken for an entry.
 */
function findMatchingOrder(trade, brokerOrders = []) {
  const orders = flattenOrders(brokerOrders);
  const byId = orders.find(
    (order) =>
      (trade.brokerOrderId && order.id === trade.brokerOrderId) ||
      (trade.brokerClientOrderId && order.client_order_id === trade.brokerClientOrderId),
  );
  if (byId) return byId;

  const entrySide = trade.side ?? 'buy';
  return orders.find(
    (order) =>
      sameSymbol(order.symbol ?? order.asset_symbol, tradeSymbol(trade)) &&
      (!order.side || order.side === entrySide) &&
      !isProtectiveOrder(order),
  );
}

/** The trade's tracked protective stop order, when it has filled. */
function findFilledProtectiveOrder(trade, brokerOrders = []) {
  const orderId = trade.protection?.orderId;
  if (!orderId) return null;
  const order = flattenOrders(brokerOrders).find((o) => o.id === orderId);
  return order?.status === 'filled' ? order : null;
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
    return sameSymbol(tradeSymbol(trade), decision?.symbol) && isActiveTradeStatus(trade.status);
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

export async function markTradeOpen({
  tradeId,
  symbol,
  order = {},
  brokerPosition = {},
  source = 'autopilot',
  entryPrice: resolvedEntryPrice = null,
  entryPriceSource = null,
}) {
  const openTrades = await getOpenTrades();
  const matchingTrade = openTrades.find((trade) => {
    if (tradeId && trade.tradeId === tradeId) return true;
    if (order?.id && trade.brokerOrderId === order.id) return true;
    return sameSymbol(tradeSymbol(trade), symbol ?? brokerPosition.symbol ?? order.symbol);
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
        assetClass: assetClassFromBroker(brokerPosition),
        // Never adopt a zero/negative broker average as an entry price.
        entryPrice: firstValidPrice(resolvedEntryPrice, brokerPosition.avg_entry_price, order.filled_avg_price),
        openedAt: nowIso(),
        strategyName: 'broker_sync',
      },
      source: 'broker_sync',
    });
    brokerBackedTrade.entryPriceSource =
      entryPriceSource ?? (brokerBackedTrade.entryPrice ? 'broker' : 'unverified');

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
    entryPrice: firstValidPrice(
      resolvedEntryPrice,
      brokerPosition.avg_entry_price,
      order.filled_avg_price,
      matchingTrade.entryPrice,
      matchingTrade.metrics?.closePrice ?? matchingTrade.metrics?.close,
    ),
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
    return sameSymbol(tradeSymbol(trade), symbol ?? brokerPosition.symbol ?? brokerOrder.symbol);
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

  // A pending entry that never filled is not a trade outcome.
  if (!String(reason).startsWith('order_')) {
    try {
      await recordTradeOutcome(canonicalClosed);
    } catch (err) {
      logger.error('Failed to record trade outcome (daily loss / cooldown)', {
        tradeId: canonicalClosed.tradeId,
        error: err.message,
      });
    }
  }

  return canonicalClosed;
}

async function resolveEntryForPosition(brokerPosition, brokerOrders, fillHistoryForSymbol) {
  let entry = resolveEntryPrice({ brokerPosition, fills: flattenOrders(brokerOrders) });
  if (entry.source !== 'unverified' || typeof fillHistoryForSymbol !== 'function') return entry;

  try {
    const history = await fillHistoryForSymbol(brokerPosition);
    entry = resolveEntryPrice({ brokerPosition, fills: flattenOrders(history ?? []) });
  } catch (err) {
    logger.warn('Fill history lookup failed; entry stays unverified', {
      symbol: brokerPosition.symbol,
      error: err.message,
    });
  }
  return entry;
}

const DEAD_ORDER_STATUSES = new Set(['canceled', 'expired', 'rejected']);

/**
 * Settles a trade whose exit order was accepted but not yet filled.
 * Closed only on a confirmed fill (or the position being gone); reverted to
 * open if the exit order died while the position still exists.
 */
async function reconcileClosingTrade(trade, brokerPosition, brokerOrders) {
  const exitOrder = trade.exitOrderId
    ? flattenOrders(brokerOrders).find((o) => o.id === trade.exitOrderId) ?? null
    : null;
  const exitStatus = exitOrder?.status ?? null;
  const reason = trade.closingReason ?? 'exit_filled';

  if (exitStatus === 'filled' || (!brokerPosition && !DEAD_ORDER_STATUSES.has(exitStatus))) {
    await markTradeClosed({ tradeId: trade.tradeId, brokerOrder: exitOrder ?? {}, reason });
    return;
  }

  // Open orders are always part of brokerOrders, so a missing exit order with
  // the position still there means the order is no longer working.
  const exitOrderDead = DEAD_ORDER_STATUSES.has(exitStatus) || (!exitOrder && Boolean(brokerPosition));

  if (exitOrderDead) {
    if (!brokerPosition) {
      await markTradeClosed({ tradeId: trade.tradeId, brokerOrder: {}, reason });
      return;
    }
    const reverted = {
      ...trade,
      status: 'open',
      exitOrderId: null,
      closingAt: null,
      closingReason: null,
      exitAttempts: toNumber(trade.exitAttempts, 0) + 1,
      lastExitError: `exit_order_${exitStatus ?? 'not_found'}`,
    };
    await upsertOpenTrade(reverted);
    await persistTradeEvent('exit_order_failed', reverted, { exitOrderId: trade.exitOrderId, exitStatus });
    logger.error('Exit order did not fill; trade reverted to open', {
      symbol: trade.symbol,
      tradeId: trade.tradeId,
      exitStatus,
    });
  }
  // Otherwise the exit order is still working — leave the trade closing.
}

const CRITICAL_PROTECTION_STATUSES = new Set(['unfilled', 'missing', 'partial', 'failed']);

/**
 * Refreshes entry price and broker-side protection on a position-backed trade.
 * Only the trade's own record is written; broker orders are never touched.
 */
async function refreshPositionState(trade, brokerPosition, brokerOrders, fillHistoryForSymbol) {
  const patch = {};

  if (!isValidPrice(trade.entryPrice) || trade.entryPriceSource === 'unverified') {
    const entry = await resolveEntryForPosition(brokerPosition, brokerOrders, fillHistoryForSymbol);
    if (entry.price && entry.price !== trade.entryPrice) patch.entryPrice = entry.price;
    if (entry.source !== trade.entryPriceSource) patch.entryPriceSource = entry.source;
  }

  let protection = describeProtection({ trade, brokerPosition, orders: brokerOrders });
  // Keep a failed bot placement visible until a stop actually exists.
  if (protection.status === 'missing' && trade.protection?.status === 'failed') {
    protection = { ...trade.protection, checkedAt: protection.checkedAt };
  }
  patch.protection = protection;

  const next = { ...trade, ...patch };
  await upsertOpenTrade(next);

  if (protection.status !== trade.protection?.status) {
    await persistTradeEvent('protection_status_changed', next, {
      from: trade.protection?.status ?? null,
      to: protection.status,
      owner: protection.owner ?? null,
      orderId: protection.orderId ?? null,
    });
  }
  if (CRITICAL_PROTECTION_STATUSES.has(protection.status)) {
    logger.error('Position lacks active broker-side protection', {
      symbol: trade.symbol,
      tradeId: trade.tradeId,
      status: protection.status,
      owner: protection.owner ?? null,
    });
  }

  return next;
}

/**
 * Reconciles the journal with broker positions and orders.
 *
 * @param {{
 *   brokerPositions?: object[],
 *   brokerOrders?: object[],
 *   fillHistoryForSymbol?: (brokerPosition: object) => Promise<object[]>,
 * }} params  fillHistoryForSymbol is used only when an entry price cannot be
 *            verified from brokerOrders (read-only lookup).
 */
export async function syncTradesWithBroker({ brokerPositions = [], brokerOrders = [], fillHistoryForSymbol = null }) {
  const openTrades = await getOpenTrades();
  const openKeys = new Set(openTrades.map((trade) => symbolKey(tradeSymbol(trade))));
  const findPosition = (trade) =>
    brokerPositions.find((p) => sameSymbol(p.symbol, tradeSymbol(trade)));

  for (const trade of openTrades) {
    const brokerPosition = findPosition(trade);
    const brokerOrder = findMatchingOrder(trade, brokerOrders);

    if (trade.status === 'closing') {
      await reconcileClosingTrade(trade, brokerPosition, brokerOrders);
      continue;
    }

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
      const stopFill = findFilledProtectiveOrder(trade, brokerOrders);
      if (stopFill) {
        await markTradeClosed({ tradeId: trade.tradeId, brokerOrder: stopFill, reason: 'stop_hit' });
        continue;
      }

      const isBrokerSyncTrade = trade.strategyName === 'broker_sync';
      const reason = isBrokerSyncTrade
        ? 'broker_sync_reconciled'
        : inferCloseReason(trade, brokerOrders);
      await markTradeClosed({ tradeId: trade.tradeId, brokerOrder, reason });
    }
  }

  for (const brokerPosition of brokerPositions) {
    if (openKeys.has(symbolKey(brokerPosition.symbol))) continue;
    const entry = await resolveEntryForPosition(brokerPosition, brokerOrders, fillHistoryForSymbol);
    await markTradeOpen({
      symbol: brokerPosition.symbol,
      brokerPosition,
      source: 'broker_sync',
      entryPrice: entry.price,
      entryPriceSource: entry.source,
    });
  }

  for (const trade of await getOpenTrades()) {
    if (!['open', 'closing'].includes(trade.status)) continue;
    const brokerPosition = findPosition(trade);
    if (!brokerPosition) continue;
    await refreshPositionState(trade, brokerPosition, brokerOrders, fillHistoryForSymbol);
  }

  return getOpenTrades();
}

export async function mergeBrokerPositionsWithJournal(brokerPositions = []) {
  const openTrades = await getOpenTrades();

  const mergedBrokerPositions = (brokerPositions ?? []).map((brokerPosition) => {
    const matchingTrade = openTrades.find((trade) => sameSymbol(tradeSymbol(trade), brokerPosition.symbol));
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
    .filter((trade) => trade.status === 'pending' && !brokerPositions.find((p) => sameSymbol(p.symbol, tradeSymbol(trade))))
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
