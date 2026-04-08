// Alpaca market data fetcher — uses the Alpaca Data API (separate from trading API).
// Stocks: https://data.alpaca.markets/v2/stocks/{symbol}/bars
// Crypto: https://data.alpaca.markets/v2/crypto/us/bars
import { config } from "../config/env.js";

const DATA_URL = config.alpaca.dataURL;
const KEY = config.alpaca.key;
const SECRET = config.alpaca.secret;

async function dataFetch(path) {
  const url = `${DATA_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      "APCA-API-KEY-ID": KEY,
      "APCA-API-SECRET-KEY": SECRET,
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
    const msg = body?.message ?? body?.error ?? body?.raw ?? "Unknown error";
    throw new Error(`Alpaca data API ${res.status}: ${msg}`);
  }

  return body;
}

/**
 * Fetches recent 15-minute bars for a stock symbol.
 * Returns an array of bar objects sorted oldest → newest.
 * Each bar: { t, o, h, l, c, v }
 *
 * @param {string} symbol  e.g. "AAPL"
 * @param {number} [limit] number of bars to fetch (default 60)
 * @returns {Promise<Array<{ t: string, o: number, h: number, l: number, c: number, v: number }>>}
 */
export async function fetchStockBars(symbol, limit = 60) {
  const params = new URLSearchParams({
    timeframe: "15Min",
    limit: String(limit),
    adjustment: "raw",
    feed: "iex",
  });

  const data = await dataFetch(
    `/v2/stocks/${encodeURIComponent(symbol)}/bars?${params}`
  );

  const bars = data.bars ?? [];
  return bars.sort((a, b) => (a.t < b.t ? -1 : 1));
}

/**
 * Fetches recent 15-minute bars for a crypto pair.
 * Returns an array of bar objects sorted oldest → newest.
 * Each bar: { t, o, h, l, c, v }
 *
 * @param {string} symbol  e.g. "BTC/USD"
 * @param {number} [limit] number of bars to fetch (default 60)
 * @returns {Promise<Array<{ t: string, o: number, h: number, l: number, c: number, v: number }>>}
 */
export async function fetchCryptoBars(symbol, limit = 60) {
  const params = new URLSearchParams({
    symbols: symbol,
    timeframe: "15Min",
    limit: String(limit),
  });

  const data = await dataFetch(`/v2/crypto/us/bars?${params}`);
  const barsMap = data.bars ?? {};
  const bars = barsMap[symbol] ?? [];
  return bars.sort((a, b) => (a.t < b.t ? -1 : 1));
}

/**
 * Fetches bars for any asset class.
 * @param {string} symbol
 * @param {"stock"|"crypto"} assetClass
 * @param {number} [limit]
 * @returns {Promise<Array>}
 */
export async function fetchBars(symbol, assetClass, limit = 60) {
  if (assetClass === "crypto") return fetchCryptoBars(symbol, limit);
  return fetchStockBars(symbol, limit);
}

/**
 * Validates a bar array for strategy use.
 * Returns { valid: boolean, reason?: string }
 *
 * @param {Array} bars
 * @param {number} [minBars]
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateBars(bars, minBars = 25) {
  if (!Array.isArray(bars) || bars.length === 0) {
    return { valid: false, reason: "no bars returned" };
  }
  if (bars.length < minBars) {
    return { valid: false, reason: `insufficient history: ${bars.length} bars (need ${minBars})` };
  }
  // Timestamps must be ordered
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].t <= bars[i - 1].t) {
      return { valid: false, reason: "bars are not in ascending time order" };
    }
  }
  return { valid: true };
}
