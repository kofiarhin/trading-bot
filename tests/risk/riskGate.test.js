import { describe, it, expect } from '@jest/globals';
import { evaluateRiskGate } from '../../src/risk/riskGate.js';

const limits = { maxDailyLossPct: 2, maxTotalRiskPct: 5, maxGrossExposurePct: 50 };
const account = { equity: '100000', last_equity: '100000' };

const reasonsOf = (result) => result.reasons.map((r) => r.reason);

describe('evaluateRiskGate', () => {
  it('allows entries inside every limit', () => {
    const result = evaluateRiskGate({
      account,
      brokerPositions: [{ symbol: 'AAPL', qty: 10, current_price: 200, market_value: 2000 }],
      openTrades: [{ symbol: 'AAPL', status: 'open', riskAmount: 400 }],
      riskState: { dailyRealizedLoss: 0 },
      limits,
    });
    expect(result.allowed).toBe(true);
    expect(result.metrics).toMatchObject({ openRiskPct: 0.4, grossExposurePct: 2 });
  });

  it.each([
    [{ equity: '0', last_equity: '100000' }],
    [{ equity: 'abc', last_equity: '100000' }],
    [{ equity: '100000' }],
    [null],
  ])('fails closed when account data is unusable (%j)', (badAccount) => {
    const result = evaluateRiskGate({ account: badAccount, limits });
    expect(result.allowed).toBe(false);
    expect(reasonsOf(result)).toEqual(['account_unavailable']);
  });

  it('blocks on the broker equity drop (includes unrealized losses)', () => {
    const result = evaluateRiskGate({ account: { equity: '97900', last_equity: '100000' }, limits });
    expect(reasonsOf(result)).toContain('daily_loss_limit');
  });

  it('blocks on recorded realized loss even if equity recovered', () => {
    const result = evaluateRiskGate({ account, riskState: { dailyRealizedLoss: 2500 }, limits });
    expect(reasonsOf(result)).toContain('daily_loss_limit');
  });

  it('does not count profits as loss', () => {
    const result = evaluateRiskGate({ account: { equity: '103000', last_equity: '100000' }, riskState: { dailyRealizedLoss: -500 }, limits });
    expect(result.allowed).toBe(true);
  });

  it('blocks when trading is halted', () => {
    expect(reasonsOf(evaluateRiskGate({ account, riskState: { halted: true }, limits }))).toContain('trading_halted');
  });

  it('blocks when open risk reaches the total cap', () => {
    const result = evaluateRiskGate({
      account,
      openTrades: [{ symbol: 'AAPL', status: 'open', riskAmount: 3000 }, { symbol: 'MSFT', status: 'closing', riskAmount: 2000 }],
      limits,
    });
    expect(reasonsOf(result)).toContain('total_risk_limit');
  });

  it('blocks when gross exposure reaches the cap', () => {
    const result = evaluateRiskGate({
      account,
      brokerPositions: [{ symbol: 'AAPL', qty: 300, current_price: 200, market_value: '60000' }],
      limits,
    });
    expect(reasonsOf(result)).toContain('gross_exposure_limit');
  });

  it('blocks on the live SOL state (98% exposure, 7.4% open risk)', () => {
    const result = evaluateRiskGate({
      account: { equity: '70407.97', last_equity: '69949.89' },
      brokerPositions: [{ symbol: 'SOLUSD', qty: 655.337420408, current_price: 105, market_value: 68810 }],
      openTrades: [{
        symbol: 'SOLUSD', status: 'open', riskAmount: 0,
        protection: { status: 'active', owner: 'external', stopPrice: 99, limitPrice: 97 },
      }],
      riskState: { dailyRealizedLoss: 0 },
      limits,
    });
    expect(result.allowed).toBe(false);
    expect(reasonsOf(result)).toEqual(['total_risk_limit', 'gross_exposure_limit']);
    expect(result.metrics.openRiskPct).toBeCloseTo(7.45, 1);
    expect(result.metrics.grossExposurePct).toBeCloseTo(97.73, 1);
  });
});
