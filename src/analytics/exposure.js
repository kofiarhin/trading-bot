/**
 * Portfolio exposure analytics.
 * Computes open risk, unrealized P&L, and breakdowns by asset class.
 */

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function inferAssetClass(symbol) {
  return typeof symbol === 'string' && symbol.includes('/') ? 'crypto' : 'stock';
}

/**
 * Computes current portfolio exposure.
 *
 * @param {{
 *   openTrades: object[],
 *   brokerPositions: object[],
 *   accountEquity: number,
 * }} params
 * @returns {{
 *   totalOpenRisk: number,
 *   totalOpenRiskPct: number,
 *   openPositionCount: number,
 *   unrealizedPnl: number,
 *   byAssetClass: { stock: object, crypto: object },
 * }}
 */
export function computeExposure({ openTrades, brokerPositions, accountEquity }) {
  const equity = toNumber(accountEquity, 0);

  let totalOpenRisk = 0;
  let unrealizedPnl = 0;
  let openPositionCount = 0;

  const byAssetClass = {
    stock: { openRisk: 0, unrealizedPnl: 0, count: 0 },
    crypto: { openRisk: 0, unrealizedPnl: 0, count: 0 },
  };

  // Collect risk amounts from open journal trades
  const activeSymbols = new Set();
  for (const trade of (openTrades ?? [])) {
    if (!['pending', 'open'].includes(trade.status)) continue;
    activeSymbols.add(trade.symbol);
    const risk = toNumber(trade.riskAmount, 0);
    totalOpenRisk += risk;
    const cls = trade.assetClass ?? inferAssetClass(trade.symbol);
    const bucket = byAssetClass[cls] ?? byAssetClass.stock;
    bucket.openRisk += risk;
  }

  // Collect unrealized P&L and count from broker positions
  for (const pos of (brokerPositions ?? [])) {
    openPositionCount++;
    const uPnl = toNumber(pos.unrealized_pl ?? pos.unrealizedPnl ?? pos.unrealizedPnL, 0);
    unrealizedPnl += uPnl;
    const cls = inferAssetClass(pos.symbol);
    const bucket = byAssetClass[cls] ?? byAssetClass.stock;
    bucket.unrealizedPnl += uPnl;
    bucket.count++;
  }

  const totalOpenRiskPct = equity > 0 ? totalOpenRisk / equity : 0;

  return {
    totalOpenRisk: round(totalOpenRisk, 2),
    totalOpenRiskPct: round(totalOpenRiskPct, 4),
    openPositionCount,
    unrealizedPnl: round(unrealizedPnl, 2),
    byAssetClass: {
      stock: {
        openRisk: round(byAssetClass.stock.openRisk, 2),
        unrealizedPnl: round(byAssetClass.stock.unrealizedPnl, 2),
        count: byAssetClass.stock.count,
      },
      crypto: {
        openRisk: round(byAssetClass.crypto.openRisk, 2),
        unrealizedPnl: round(byAssetClass.crypto.unrealizedPnl, 2),
        count: byAssetClass.crypto.count,
      },
    },
  };
}

function round(value, decimals) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(decimals));
}
