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

  bnb: "BNB/USD",
  binancecoin: "BNB/USD",
  "bnb/usd": "BNB/USD",

  xrp: "XRP/USD",
  ripple: "XRP/USD",
  "xrp/usd": "XRP/USD",

  avax: "AVAX/USD",
  avalanche: "AVAX/USD",
  "avax/usd": "AVAX/USD",

  ada: "ADA/USD",
  cardano: "ADA/USD",
  "ada/usd": "ADA/USD",

  link: "LINK/USD",
  chainlink: "LINK/USD",
  "link/usd": "LINK/USD",

  matic: "MATIC/USD",
  polygon: "MATIC/USD",
  "matic/usd": "MATIC/USD",

  dot: "DOT/USD",
  polkadot: "DOT/USD",
  "dot/usd": "DOT/USD",

  ltc: "LTC/USD",
  litecoin: "LTC/USD",
  "ltc/usd": "LTC/USD",

  dogecoin: "DOGE/USD",
  doge: "DOGE/USD",
  "doge/usd": "DOGE/USD",

  bch: "BCH/USD",
  bitcoincash: "BCH/USD",
  "bch/usd": "BCH/USD",

  uni: "UNI/USD",
  uniswap: "UNI/USD",
  "uni/usd": "UNI/USD",

  atom: "ATOM/USD",
  cosmos: "ATOM/USD",
  "atom/usd": "ATOM/USD",

  near: "NEAR/USD",
  "near/usd": "NEAR/USD",

  aave: "AAVE/USD",
  "aave/usd": "AAVE/USD",

  etc: "ETC/USD",
  ethereumclassic: "ETC/USD",
  "etc/usd": "ETC/USD",

  fil: "FIL/USD",
  filecoin: "FIL/USD",
  "fil/usd": "FIL/USD",

  algo: "ALGO/USD",
  algorand: "ALGO/USD",
  "algo/usd": "ALGO/USD",
};

export const SUPPORTED_ASSET_MESSAGE =
  "Supported stocks: Apple, Tesla, Microsoft, Amazon, Google, Meta, Nvidia. " +
  "Supported crypto: BTC/USD, ETH/USD, SOL/USD, BNB/USD, XRP/USD, AVAX/USD, ADA/USD, LINK/USD, " +
  "MATIC/USD, DOT/USD, LTC/USD, DOGE/USD, BCH/USD, UNI/USD, ATOM/USD, NEAR/USD, AAVE/USD, ETC/USD, FIL/USD, ALGO/USD.";

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
