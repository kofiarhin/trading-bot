import { describe, it, expect } from '@jest/globals';
import { checkPortfolioRisk } from '../../src/risk/portfolioRisk.js';

describe('portfolioRisk canonical config usage', () => {
  const base = {
    candidates: [
      { symbol: 'AAPL', assetClass: 'stock', riskAmount: 1500 },
      { symbol: 'MSFT', assetClass: 'stock', riskAmount: 1500 },
      { symbol: 'BTC/USD', assetClass: 'crypto', riskAmount: 1500 },
    ],
    openTrades: [],
    brokerPositions: [],
    accountEquity: 100000,
    riskState: { dailyRealizedLoss: 0 },
  };

  it('uses canonical risk defaults when riskConfig is omitted', () => {
    const result = checkPortfolioRisk(base);
    expect(result.allowed).toHaveLength(3);
    expect(result.blocked).toHaveLength(0);
  });

  it('honors canonical daily loss limit and throttle settings from override config', () => {
    const result = checkPortfolioRisk({
      ...base,
      maxCandidatesOverride: 4,
      riskState: { dailyRealizedLoss: 1200 },
      riskConfig: {
        drawdownThrottlePct: 1,
        dailyLossLimitPct: 2,
        maxTotalRiskPct: 10,
        maxCorrelatedPositions: 5,
      },
    });

    expect(result.throttleActive).toBe(true);
    expect(result.allowed).toHaveLength(2);
    expect(result.blocked[0]?.reason).toBe('drawdown_throttle');
  });
});
