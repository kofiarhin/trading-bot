// Configured trading universe — stocks and optional crypto.
// Edit these lists to change what the autopilot scans.

export const STOCK_UNIVERSE = [
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "META",
  "TSLA",
  "AMD",
  "GOOGL",
];

export const CRYPTO_UNIVERSE = [
  "BTC/USD",
  "ETH/USD",
  "SOL/USD",
];

/**
 * Returns the active symbol universe based on config.
 * @param {{ enableStocks?: boolean, enableCrypto?: boolean }} tradingConfig
 * @returns {Array<{ symbol: string, assetClass: "stock"|"crypto" }>}
 */
export function getUniverse({ enableStocks = true, enableCrypto = true } = {}) {
  const seen = new Set();
  const symbols = [];

  function add(symbol, assetClass) {
    const trimmed = symbol.trim();
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      symbols.push({ symbol: trimmed, assetClass });
    }
  }

  if (enableStocks) {
    for (const s of STOCK_UNIVERSE) add(s, "stock");
  }

  if (enableCrypto) {
    for (const s of CRYPTO_UNIVERSE) add(s, "crypto");
  }

  return symbols;
}
