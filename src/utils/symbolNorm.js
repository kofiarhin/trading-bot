/**
 * Normalises a trading symbol for safe equality comparisons.
 * Strips slashes and upper-cases so "BTC/USD", "btc/usd", and "BTCUSD" all
 * collapse to the same key.
 *
 * @param {string} sym
 * @returns {string}
 */
export function normalizeSymbol(sym) {
  return sym.replace(/\//g, "").toUpperCase();
}
