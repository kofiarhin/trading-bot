// Forced first-trade override — paper trading debug only.
// Returns a fake approved decision to validate the full pipeline end-to-end.
// Never runs in live mode (env guard is applied in autopilot before reaching here,
// but this function also checks FORCE_FIRST_TRADE itself as a second line of defence).

export function maybeForceTrade({ symbol, assetClass, latestPrice }) {
  if (process.env.FORCE_FIRST_TRADE !== 'true') return null;

  const forcedSymbol = process.env.FORCE_FIRST_TRADE_SYMBOL;
  if (!forcedSymbol || symbol !== forcedSymbol) return null;

  return {
    approved: true,
    reason: 'forced first paper trade',
    metrics: {
      closePrice: latestPrice,
      breakoutLevel: latestPrice,
      atr: 0,
      volumeRatio: 1,
      distanceToBreakoutPct: 0,
    },
    strategyName: 'forced-debug-entry',
    isForced: true,
  };
}
