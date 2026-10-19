// Protective stop management — places and cancels broker-side stop orders.
//
// The bot never places a second stop on a symbol that already has one, and
// never cancels, replaces or modifies an order it does not own (see
// protectionState.js for ownership and status rules).
import { submitOrder } from './alpacaTrading.js';
import {
  getOrder,
  getOrderByClientId,
  cancelOrderById,
  getOpenOrders,
  getPositionForSymbol,
} from './alpacaOrders.js';
import { logger } from '../utils/logger.js';
import {
  OPEN_ORDER_STATUSES,
  QTY_TOLERANCE,
  DEFAULT_STOP_LIMIT_BUFFER_PCT,
  botStopClientOrderId,
  findProtectiveOrders,
  isBotOwned,
  isProtectiveStopOrder,
  roundOrderPrice,
} from '../journal/protectionState.js';

export * from '../journal/protectionState.js';

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Builds the protective stop order for a bot-managed position.
 * Crypto: stop_limit GTC (limit = stop × (1 − buffer)). Stocks: stop GTC.
 */
export function buildProtectiveStopOrder({ trade, brokerPosition, bufferPct = DEFAULT_STOP_LIMIT_BUFFER_PCT }) {
  const stopPrice = roundOrderPrice(trade.stopLoss);
  const isCrypto = (trade.assetClass ?? '') === 'crypto' || String(trade.symbol ?? '').includes('/');
  const order = {
    symbol: brokerPosition?.symbol ?? trade.normalizedSymbol ?? trade.symbol,
    qty: String(brokerPosition?.qty ?? trade.quantity),
    side: 'sell',
    assetClass: isCrypto ? 'crypto' : 'stock',
    timeInForce: 'gtc',
    clientOrderId: botStopClientOrderId(trade.tradeId),
    stopPrice,
  };
  if (isCrypto) {
    order.type = 'stop_limit';
    order.limitPrice = roundOrderPrice(stopPrice * (1 - bufferPct));
  } else {
    order.type = 'stop';
  }
  return order;
}

/**
 * Places a bot-owned protective stop for a bot-managed position if — and only
 * if — no stop order of any owner exists for that symbol.
 *
 * Never acts on broker_sync (adopted) trades: those are flagged by the
 * protection gate instead.
 *
 * @returns {Promise<{ action: string, protection?: object, error?: string }>}
 */
export async function ensureProtectiveStop({
  trade,
  brokerPosition,
  orders = [],
  bufferPct = DEFAULT_STOP_LIMIT_BUFFER_PCT,
  dryRun = false,
}) {
  if (!trade || !brokerPosition) return { action: 'skipped_no_position' };
  if ((trade.strategyName ?? '') === 'broker_sync') return { action: 'skipped_external_trade' };

  const existing = findProtectiveOrders(orders, brokerPosition.symbol);
  if (existing.length) return { action: 'already_protected' };

  if (!(toNumber(trade.stopLoss, 0) > 0)) return { action: 'skipped_no_stop_level', error: 'trade has no stopLoss' };

  const qty = toNumber(brokerPosition.qty, 0);
  const qtyAvailable = toNumber(brokerPosition.qty_available ?? brokerPosition.qty, 0);
  if (qtyAvailable < qty * QTY_TOLERANCE) {
    return { action: 'skipped_reserved', error: 'position quantity is reserved by another order' };
  }

  const currentPrice = toNumber(brokerPosition.current_price, 0);
  if (currentPrice > 0 && currentPrice <= toNumber(trade.stopLoss, 0)) {
    return { action: 'skipped_price_below_stop', error: 'price already at or below stop level' };
  }

  const orderPayload = buildProtectiveStopOrder({ trade, brokerPosition, bufferPct });
  if (dryRun) return { action: 'dry_run', order: orderPayload };

  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await submitOrder(orderPayload);
      logger.info('Protective stop placed', { symbol: orderPayload.symbol, tradeId: trade.tradeId, orderId: response?.id });
      return { action: 'placed', protection: protectionFromOrder(response, orderPayload) };
    } catch (err) {
      lastError = err;
      // A reused client_order_id means a previous attempt already landed.
      const existingOrder = await getOrderByClientId(orderPayload.clientOrderId).catch(() => null);
      if (existingOrder && OPEN_ORDER_STATUSES.has(existingOrder.status)) {
        return { action: 'placed', protection: protectionFromOrder(existingOrder, orderPayload) };
      }
      logger.error('Protective stop placement failed', {
        symbol: orderPayload.symbol,
        tradeId: trade.tradeId,
        attempt,
        error: err.message,
      });
    }
  }

  return {
    action: 'failed',
    error: lastError?.message ?? 'unknown error',
    protection: {
      status: 'failed',
      owner: 'bot',
      orderId: null,
      clientOrderId: orderPayload.clientOrderId,
      lastError: lastError?.message ?? 'unknown error',
      checkedAt: nowIso(),
    },
  };
}

function protectionFromOrder(order, payload) {
  return {
    status: 'active',
    owner: 'bot',
    orderId: order?.id ?? null,
    clientOrderId: order?.client_order_id ?? payload.clientOrderId,
    type: order?.type ?? payload.type,
    stopPrice: toNumber(order?.stop_price, payload.stopPrice) || null,
    limitPrice: toNumber(order?.limit_price, payload.limitPrice ?? 0) || null,
    coveredQty: toNumber(order?.qty, toNumber(payload.qty, 0)),
    orderCount: 1,
    checkedAt: nowIso(),
  };
}

/**
 * Cancels a bot-owned protective stop and confirms the cancellation.
 * Ownership is verified against the broker's copy of the order — an external
 * order (e.g. a manually placed stop) is never cancelled.
 *
 * @param {{ orderId: string }} params
 * @returns {Promise<{ canceled: boolean, reason?: string }>}
 */
export async function cancelBotStop({ orderId }) {
  if (!orderId) return { canceled: false, reason: 'no_order_id' };

  const order = await getOrder(orderId);
  if (!isBotOwned(order)) {
    throw new Error(`refusing to cancel order ${orderId}: not bot-owned`);
  }
  if (!isProtectiveStopOrder(order)) {
    return { canceled: order?.status === 'canceled', reason: `order_status_${order?.status}` };
  }

  await cancelOrderById(orderId);
  const confirmed = await getOrder(orderId);
  const canceled = ['canceled', 'pending_cancel'].includes(confirmed?.status);
  return { canceled, reason: canceled ? undefined : `order_status_${confirmed?.status}` };
}

/**
 * Re-places a bot-owned stop right after an exit failed following the
 * cancellation of that stop. Reads live position and open orders first, so it
 * never duplicates a stop and never acts on a position that is already gone.
 *
 * @param {{ trade: object, symbol: string, bufferPct?: number }} params
 * @returns {Promise<{ action: string, protection?: object, error?: string }>}
 */
export async function restoreProtectiveStop({ trade, symbol, bufferPct = DEFAULT_STOP_LIMIT_BUFFER_PCT }) {
  try {
    const brokerPosition = await getPositionForSymbol(symbol);
    if (!brokerPosition) return { action: 'skipped_no_position' };
    const orders = await getOpenOrders();
    return await ensureProtectiveStop({ trade, brokerPosition, orders, bufferPct });
  } catch (err) {
    logger.error('Protective stop restore failed', { symbol, tradeId: trade?.tradeId, error: err.message });
    return {
      action: 'failed',
      error: err.message,
      protection: {
        status: 'failed',
        owner: 'bot',
        orderId: null,
        clientOrderId: botStopClientOrderId(trade?.tradeId),
        lastError: err.message,
        checkedAt: nowIso(),
      },
    };
  }
}

