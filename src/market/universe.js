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
 * @param {{ enableCrypto: boolean }} tradingConfig
 * @returns {Array<{ symbol: string, assetClass: "stock"|"crypto" }>}
 */
export function getUniverse(tradingConfig) {
  const symbols = STOCK_UNIVERSE.map((symbol) => ({ symbol, assetClass: "stock" }));

  if (tradingConfig.enableCrypto) {
    for (const symbol of CRYPTO_UNIVERSE) {
      symbols.push({ symbol, assetClass: "crypto" });
    }
  }

  return symbols;
}
