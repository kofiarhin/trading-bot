import { describe, it, expect } from '@jest/globals';
import { buildSignalMetrics } from '../../src/strategies/buildSignalMetrics.js';

function makeBars(count = 30, { breakout = true } = {}) {
  const bars = [];
  for (let i = 0; i < count; i += 1) {
    const base = 100 + i * 0.05;
    bars.push({
      t: new Date(Date.now() + i * 60_000).toISOString(),
      o: base - 0.2,
      h: base + 0.4,
      l: base - 0.4,
      c: base,
      v: 1_000_000,
    });
  }

  if (breakout) {
    const priorHigh = Math.max(...bars.slice(-21, -1).map((b) => b.h));
    const last = bars[bars.length - 1];
    bars[bars.length - 1] = { ...last, c: priorHigh * 1.005, h: priorHigh * 1.006, v: 2_000_000 };
  }

  return bars;
}

describe('buildSignalMetrics', () => {
  it('returns shared strategy/prefilter metrics for valid bars', () => {
    const result = buildSignalMetrics(makeBars());
    expect(result.ok).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.metrics.closePrice).toBeGreaterThan(0);
    expect(result.metrics.breakoutLevel).toBeGreaterThan(0);
    expect(result.metrics.atr).toBeGreaterThan(0);
    expect(result.metrics.volumeRatio).toBeGreaterThan(0);
    expect(result.metrics.barsAvailable).toBe(30);
    expect(result.metrics.distanceToBreakoutPct).not.toBeNull();
    expect(result.metrics.rangeAtrMultiple).not.toBeNull();
  });

  it('returns insufficient_market_data when bars are missing', () => {
    const result = buildSignalMetrics([]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_market_data');
    expect(result.metrics.barsAvailable).toBe(0);
  });
});
