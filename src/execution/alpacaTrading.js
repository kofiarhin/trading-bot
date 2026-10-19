// Alpaca paper-trading execution wrapper.
// Extends the base alpaca.js with account info fetching.
import { config } from "../config/env.js";

const { key, secret, baseURL } = config.alpaca;

async function tradingFetch(path, options = {}) {
  const url = `${baseURL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "APCA-API-KEY-ID": key,
      "APCA-API-SECRET-KEY": secret,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  if (!res.ok) {
    const msg = body?.message ?? body?.error ?? body?.raw ?? "Unknown Alpaca error";
    throw new Error(`Alpaca API ${res.status}: ${msg}`);
  }

  return body;
}

/**
 * Fetches the paper trading account.
 * Returns { equity, cash, portfolio_value, status, ... }
 * @returns {Promise<object>}
 */
export async function getAccount() {
  return tradingFetch("/v2/account");
}

/**
 * Fetches all open positions.
 * @returns {Promise<Array>}
 */
export async function getOpenPositions() {
  return tradingFetch("/v2/positions");
}

/**
 * Fetches a single open position by symbol.
 * Returns null if no position exists.
 * @param {string} symbol
 * @returns {Promise<object|null>}
 */
export async function getPosition(symbol) {
  try {
    return await tradingFetch(`/v2/positions/${encodeURIComponent(symbol)}`);
  } catch (err) {
    if (err.message.includes("404")) return null;
    throw err;
  }
}

/**
 * Submits an order to Alpaca paper trading. Defaults to a market order.
 *
 * Crypto supports market, limit and stop_limit only (no stop/bracket/OCO).
 * Stocks additionally support plain stop orders.
 *
 * @param {{
 *   symbol: string,
 *   qty: number|string,
 *   side: "buy"|"sell",
 *   assetClass?: "stock"|"crypto",
 *   type?: "market"|"stop"|"stop_limit",
 *   stopPrice?: number,
 *   limitPrice?: number,
 *   timeInForce?: "day"|"gtc"|"ioc",
 *   clientOrderId?: string,
 * }} params
 * @returns {Promise<object>}
 */
export async function submitOrder({
  symbol,
  qty,
  side,
  assetClass = "stock",
  type = "market",
  stopPrice,
  limitPrice,
  timeInForce,
  clientOrderId,
}) {
  const body = {
    symbol,
    qty: String(qty),
    side,
    type,
    time_in_force: timeInForce ?? (assetClass === "crypto" ? "gtc" : "day"),
  };
  if (stopPrice != null) body.stop_price = String(stopPrice);
  if (limitPrice != null) body.limit_price = String(limitPrice);
  if (clientOrderId) body.client_order_id = clientOrderId;
  if (assetClass === "crypto" && type === "stop") {
    throw new Error("plain stop orders are not supported for crypto; use stop_limit");
  }
  return tradingFetch("/v2/orders", { method: "POST", body: JSON.stringify(body) });
}

/**
 * Closes an entire position by symbol via Alpaca's close-position endpoint.
 * Returns the resulting order object.
 * @param {string} symbol  — normalized symbol (e.g. "AAPL", "BTCUSD")
 * @returns {Promise<object>}
 */
export async function closePosition(symbol) {
  return tradingFetch(`/v2/positions/${encodeURIComponent(symbol)}`, { method: "DELETE" });
}
