import { describe, it, expect } from '@jest/globals';
import { checkPortfolioRisk, openRiskForTrade } from '../../src/risk/portfolioRisk.js';

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

describe('portfolioRisk — broker-protected open risk', () => {
  const solPosition = { symbol: 'SOLUSD', asset_class: 'crypto', qty: 655.337420408, current_price: 105 };
  const solTrade = {
    symbol: 'SOLUSD',
    status: 'open',
    riskAmount: 0,
    protection: { status: 'active', owner: 'external', stopPrice: 99, limitPrice: 97 },
  };

  it('counts (current − limit) × qty for a protected position', () => {
    expect(openRiskForTrade(solTrade, solPosition)).toBeCloseTo(8 * 655.337420408, 4);
  });

  it('falls back to riskAmount without active protection', () => {
    expect(openRiskForTrade({ ...solTrade, riskAmount: 42, protection: { status: 'missing' } }, solPosition)).toBe(42);
  });

  it('never reports negative risk when price is below the limit', () => {
    expect(openRiskForTrade(solTrade, { ...solPosition, current_price: 90 })).toBe(0);
  });

  it('blocks candidates when protected open risk exceeds the total cap', () => {
    const result = checkPortfolioRisk({
      candidates: [{ symbol: 'ETH/USD', assetClass: 'crypto', riskAmount: 50 }],
      openTrades: [solTrade],
      brokerPositions: [solPosition],
      accountEquity: 70_000,
      riskState: { dailyRealizedLoss: 0 },
      riskConfig: { maxTotalRiskPct: 5, maxCorrelatedPositions: 3 },
    });
    expect(result.blocked[0]?.reason).toBe('total_risk_cap');
  });

  it('counts SOLUSD and SOL/USD as one crypto position', () => {
    const result = checkPortfolioRisk({
      candidates: [{ symbol: 'ETH/USD', assetClass: 'crypto', riskAmount: 1 }],
      openTrades: [{ symbol: 'SOL/USD', normalizedSymbol: 'SOLUSD', status: 'open', riskAmount: 1 }],
      brokerPositions: [{ symbol: 'SOLUSD', asset_class: 'crypto', qty: 1, current_price: 100 }],
      accountEquity: 100_000,
      riskState: { dailyRealizedLoss: 0 },
      riskConfig: { maxTotalRiskPct: 50, maxCorrelatedPositions: 2 },
    });
    expect(result.allowed).toHaveLength(1);
  });
});

