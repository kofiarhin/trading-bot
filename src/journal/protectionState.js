// Broker-side protection state — pure functions, no broker or database calls.
//
// Rules:
//   - Any open sell stop / stop_limit / trailing_stop order on a symbol counts as
//     protection, whoever placed it.
//   - Orders whose client_order_id starts with BOT_ORDER_PREFIX are bot-owned.
//     Everything else (e.g. a manually placed stop) is external.
//   - New entries are blocked while any position lacks active protection.
import { normalizeSymbol } from '../utils/symbolNorm.js';
import { isActiveTradeStatus } from './tradeStatus.js';

export const BOT_ORDER_PREFIX = 'tb-';
export const BOT_STOP_PREFIX = 'tb-stop-';
export const DEFAULT_STOP_LIMIT_BUFFER_PCT = 0.02;

export const OPEN_ORDER_STATUSES = new Set([
  'new',
  'accepted',
  'pending_new',
  'accepted_for_bidding',
  'partially_filled',
  'held',
  'pending_replace',
  'calculated',
]);
export const STOP_ORDER_TYPES = new Set(['stop', 'stop_limit', 'trailing_stop']);
export const QTY_TOLERANCE = 0.999;

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function symbolKey(symbol) {
  return normalizeSymbol(String(symbol ?? ''));
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Rounds a price to an increment Alpaca accepts: 2 decimals at or above $1,
 * 4 decimals below $1.
 */
export function roundOrderPrice(price) {
  const n = toNumber(price, 0);
  return n >= 1 ? Math.round(n * 100) / 100 : Math.round(n * 10000) / 10000;
}

export function botStopClientOrderId(tradeId) {
  return `${BOT_STOP_PREFIX}${tradeId}`;
}

/**
 * Flattens nested bracket orders so stop legs are visible as orders.
 * Legs inherit the parent's client_order_id as parent_client_order_id.
 */
export function flattenOrders(orders = []) {
  const flat = [];
  for (const order of orders ?? []) {
    if (!order) continue;
    flat.push(order);
    for (const leg of order.legs ?? []) {
      flat.push({ ...leg, parent_client_order_id: order.client_order_id ?? null });
    }
  }
  return flat;
}

export function isBotOwned(order) {
  const own = String(order?.client_order_id ?? '');
  const parent = String(order?.parent_client_order_id ?? '');
  return own.startsWith(BOT_ORDER_PREFIX) || parent.startsWith(BOT_ORDER_PREFIX);
}

export function isProtectiveStopOrder(order) {
  return (
    order?.side === 'sell' &&
    STOP_ORDER_TYPES.has(order?.type ?? order?.order_type) &&
    OPEN_ORDER_STATUSES.has(order?.status)
  );
}

/** Open sell stop-type orders for a symbol (any owner). */
export function findProtectiveOrders(orders, symbol) {
  const key = symbolKey(symbol);
  return flattenOrders(orders).filter(
    (order) => symbolKey(order.symbol) === key && isProtectiveStopOrder(order),
  );
}

/**
 * Describes the broker-side protection of one position.
 *
 * status:
 *   active   — open stop order(s) cover the position and price is above the stop
 *   partial  — open stop order(s) cover less than the full position
 *   unfilled — price is at/below the stop but the order is still open
 *   filled   — the previously tracked stop order has filled
 *   missing  — no open stop order
 *
 * @param {{ trade?: object, brokerPosition?: object, orders: object[] }} params
 */
export function describeProtection({ trade = null, brokerPosition = null, orders = [] }) {
  const symbol = brokerPosition?.symbol ?? trade?.normalizedSymbol ?? trade?.symbol;
  const positionQty = Math.abs(toNumber(brokerPosition?.qty, toNumber(trade?.quantity, 0)));
  const currentPrice = toNumber(brokerPosition?.current_price, 0);
  const stops = findProtectiveOrders(orders, symbol);
  const checkedAt = nowIso();

  if (stops.length) {
    // The highest stop is the one that triggers first.
    const primary = [...stops].sort((a, b) => toNumber(b.stop_price) - toNumber(a.stop_price))[0];
    const coveredQty = stops.reduce((sum, o) => sum + toNumber(o.qty, 0) - toNumber(o.filled_qty, 0), 0);
    const stopPrice = toNumber(primary.stop_price, 0) || null;
    const limitPrice = toNumber(primary.limit_price, 0) || null;

    let status = 'active';
    if (positionQty > 0 && coveredQty < positionQty * QTY_TOLERANCE) status = 'partial';
    if (stopPrice && currentPrice > 0 && currentPrice <= stopPrice) status = 'unfilled';

    const previous = trade?.protection;
    const unfilledSince = status === 'unfilled'
      ? (previous?.status === 'unfilled' && previous.unfilledSince ? previous.unfilledSince : checkedAt)
      : null;

    return {
      status,
      unfilledSince,
      owner: isBotOwned(primary) ? 'bot' : 'external',
      orderId: primary.id ?? null,
      clientOrderId: primary.client_order_id ?? null,
      type: primary.type ?? primary.order_type ?? null,
      stopPrice,
      limitPrice,
      coveredQty,
      orderCount: stops.length,
      checkedAt,
    };
  }

  const previous = trade?.protection ?? null;
  if (previous?.orderId) {
    const tracked = flattenOrders(orders).find((o) => o.id === previous.orderId);
    if (tracked?.status === 'filled') {
      return { ...previous, status: 'filled', lastOrderStatus: 'filled', checkedAt };
    }
    return {
      ...previous,
      status: 'missing',
      lastOrderStatus: tracked?.status ?? previous.lastOrderStatus ?? 'unknown',
      checkedAt,
    };
  }

  return { status: 'missing', owner: null, orderId: null, checkedAt };
}

/**
 * Decides whether new entries may be placed this cycle.
 * Fails closed: any doubt about protection blocks all new entries.
 *
 * @param {{ openTrades: object[], brokerPositions: object[], brokerStateOk?: boolean }} params
 * @returns {{ allowed: boolean, reasons: Array<{ symbol: string|null, reason: string }> }}
 */
export function evaluateProtectionGate({ openTrades = [], brokerPositions = [], brokerStateOk = true }) {
  const reasons = [];

  if (!brokerStateOk) {
    reasons.push({ symbol: null, reason: 'broker_state_unavailable' });
    return { allowed: false, reasons };
  }

  const activeTrades = (openTrades ?? []).filter((t) => isActiveTradeStatus(t.status));

  for (const position of brokerPositions ?? []) {
    if (Math.abs(toNumber(position.qty, 0)) <= 0) continue;
    const key = symbolKey(position.symbol);
    const trade = activeTrades.find((t) => symbolKey(t.normalizedSymbol ?? t.symbol) === key);

    if (!trade) {
      reasons.push({ symbol: position.symbol, reason: 'untracked_position' });
      continue;
    }
    if (trade.entryPriceSource === 'unverified') {
      reasons.push({ symbol: position.symbol, reason: 'entry_unverified' });
    }
    const status = trade.protection?.status ?? 'missing';
    if (status !== 'active') {
      reasons.push({ symbol: position.symbol, reason: `protection_${status}` });
    }
  }

  // Pending crypto entries have no stop until they fill.
  for (const trade of activeTrades) {
    if (trade.status !== 'pending') continue;
    if ((trade.assetClass ?? '') !== 'crypto') continue;
    const key = symbolKey(trade.normalizedSymbol ?? trade.symbol);
    const filled = (brokerPositions ?? []).some((p) => symbolKey(p.symbol) === key);
    if (!filled) reasons.push({ symbol: trade.symbol, reason: 'entry_pending_unprotected' });
  }

  return { allowed: reasons.length === 0, reasons };
}
