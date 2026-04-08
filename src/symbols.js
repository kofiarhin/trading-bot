// Maps company names and aliases to ticker symbols.
// All keys must be lowercase for case-insensitive matching.
const STOCK_SYMBOL_MAP = {
  apple: "AAPL",
  aapl: "AAPL",

  tesla: "TSLA",
  tsla: "TSLA",

  microsoft: "MSFT",
  msft: "MSFT",

  amazon: "AMZN",
  amzn: "AMZN",

  google: "GOOGL",
  alphabet: "GOOGL",
  googl: "GOOGL",
  goog: "GOOGL",

  meta: "META",
  facebook: "META",
  fb: "META",

  nvidia: "NVDA",
  nvda: "NVDA",
};

const CRYPTO_SYMBOL_MAP = {
  bitcoin: "BTC/USD",
  btc: "BTC/USD",
  "btc/usd": "BTC/USD",

  ethereum: "ETH/USD",
  eth: "ETH/USD",
  "eth/usd": "ETH/USD",

  solana: "SOL/USD",
  sol: "SOL/USD",
  "sol/usd": "SOL/USD",

  dogecoin: "DOGE/USD",
  doge: "DOGE/USD",
  "doge/usd": "DOGE/USD",
};

export const SUPPORTED_ASSET_MESSAGE =
  "Supported stocks: Apple, Tesla, Microsoft, Amazon, Google, Meta, Nvidia. " +
  "Supported crypto: BTC/USD, ETH/USD, SOL/USD, DOGE/USD.";

/**
 * Resolves a stock or crypto name/alias.
 * Returns null if the name cannot be resolved.
 * @param {string} name
 * @returns {{ symbol: string, assetClass: "stock"|"crypto" }|null}
 */
export function resolveAsset(name) {
  if (!name) return null;

  const key = name.trim().toLowerCase();
  if (!key) return null;

  if (key in STOCK_SYMBOL_MAP) {
    return { symbol: STOCK_SYMBOL_MAP[key], assetClass: "stock" };
  }

  if (key in CRYPTO_SYMBOL_MAP) {
    return { symbol: CRYPTO_SYMBOL_MAP[key], assetClass: "crypto" };
  }

  return null;
}

/**
 * Resolves a company name or ticker alias to an uppercase ticker symbol.
 * Returns null if the name cannot be resolved.
 * @param {string} name
 * @returns {string|null}
 */
export function resolveSymbol(name) {
  return resolveAsset(name)?.symbol ?? null;
}
