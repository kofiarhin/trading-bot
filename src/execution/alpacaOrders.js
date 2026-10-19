// Alpaca order lookups and cancellation for protective stops.
// Kept separate from alpacaTrading.js so existing mocks of that module stay valid.
// Config is read lazily so this module can be imported in tests without credentials.
import { config } from "../config/env.js";

async function tradingFetch(path, options = {}) {
  const { key, secret, baseURL } = config.alpaca;
  const res = await fetch(`${baseURL}${path}`, {
    ...options,
    headers: {
      "APCA-API-KEY-ID": key,
      "APCA-API-SECRET-KEY": secret,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (res.status === 204) return null;

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }

  if (!res.ok) {
    const msg = body?.message ?? body?.error ?? body?.raw ?? "Unknown Alpaca error";
    const error = new Error(`Alpaca API ${res.status}: ${msg}`);
    error.status = res.status;
    throw error;
  }

  return body;
}

/**
 * Fetches a single order by broker id.
 * @param {string} orderId
 * @returns {Promise<object>}
 */
export async function getOrder(orderId) {
  return tradingFetch(`/v2/orders/${encodeURIComponent(orderId)}?nested=true`);
}

/**
 * Fetches a single order by client order id. Returns null when not found.
 * @param {string} clientOrderId
 * @returns {Promise<object|null>}
 */
export async function getOrderByClientId(clientOrderId) {
  try {
    return await tradingFetch(
      `/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`,
    );
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/**
 * Fetches recent orders (all statuses) for one symbol, newest first.
 * Used to resolve entry prices from fill history.
 * @param {string} symbol  e.g. "SOL/USD" or "AAPL"
 * @param {number} [limit]
 * @returns {Promise<object[]>}
 */
export async function getOrderHistory(symbol, limit = 100) {
  const params = new URLSearchParams({
    status: "all",
    symbols: symbol,
    limit: String(limit),
    direction: "desc",
    nested: "true",
  });
  return tradingFetch(`/v2/orders?${params.toString()}`);
}

/**
 * Cancels an order by broker id. Callers must verify ownership first —
 * use protectiveStops.cancelBotStop(), never this directly.
 * @param {string} orderId
 */
export async function cancelOrderById(orderId) {
  return tradingFetch(`/v2/orders/${encodeURIComponent(orderId)}`, { method: "DELETE" });
}

/**
 * Fetches all open orders (nested bracket legs included).
 * @returns {Promise<object[]>}
 */
export async function getOpenOrders() {
  return tradingFetch("/v2/orders?status=open&limit=500&nested=true");
}

/**
 * Fetches one open position, or null when none exists.
 * @param {string} symbol  e.g. "SOLUSD" or "AAPL"
 * @returns {Promise<object|null>}
 */
export async function getPositionForSymbol(symbol) {
  try {
    return await tradingFetch(`/v2/positions/${encodeURIComponent(symbol)}`);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}
