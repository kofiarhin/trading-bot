import { describe, it, expect } from "@jest/globals";
import { evaluateBreakout } from "../../src/strategies/breakoutStrategy.js";

// Build a synthetic bar array with a configurable breakout on the last bar.
// `trend` = small upward drift per bar.
function makeBars({ count = 30, baseClose = 100, breakout = false, lowVolume = false } = {}) {
  const bars = [];
  // History always has high volume so avg is well defined
  for (let i = 0; i < count; i++) {
    const c = baseClose + i * 0.05; // slow drift
    bars.push({
      t: new Date(Date.now() - (count - i) * 900000).toISOString(),
      o: c - 0.1,
      h: c + 0.5,
      l: c - 0.5,
      c,
      v: 1_500_000,
    });
  }

  if (breakout) {
    // Replace last bar: closes clearly above all previous highs
    const lastHighestHigh = Math.max(...bars.slice(-21, -1).map((b) => b.h));
    const breakoutClose = lastHighestHigh + 2.0;
    bars[bars.length - 1] = {
      ...bars[bars.length - 1],
      h: breakoutClose + 0.5,
      c: breakoutClose,
      // lowVolume: current bar volume far below avg → ratio ≈ 0.0001
      v: lowVolume ? 100 : 2_500_000,
    };
  } else if (lowVolume) {
    bars[bars.length - 1] = { ...bars[bars.length - 1], v: 100 };
  }

  return bars;
}

const BASE_PARAMS = {
  symbol: "AAPL",
  assetClass: "stock",
  accountEquity: 10_000,
  riskPercent: 0.005,
  timeframe: "15Min",
};

describe("evaluateBreakout", () => {
  it("approves a valid breakout with volume confirmation", () => {
    const bars = makeBars({ count: 30, breakout: true });
    const result = evaluateBreakout({ ...BASE_PARAMS, bars });
    expect(result.approved).toBe(true);
    expect(result.symbol).toBe("AAPL");
    expect(result.quantity).toBeGreaterThanOrEqual(1);
    expect(result.stopLoss).toBeLessThan(result.entryPrice);
    expect(result.takeProfit).toBeGreaterThan(result.entryPrice);
  });

  it("rejects when no breakout above highest high", () => {
    const bars = makeBars({ count: 30, breakout: false });
    const result = evaluateBreakout({ ...BASE_PARAMS, bars });
    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/no breakout/);
  });

  it("rejects when volume is too low", () => {
    const bars = makeBars({ count: 30, breakout: true, lowVolume: true });
    const result = evaluateBreakout({ ...BASE_PARAMS, bars });
    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/volume/);
  });

  it("rejects when bar history is insufficient", () => {
    const bars = makeBars({ count: 10 });
    const result = evaluateBreakout({ ...BASE_PARAMS, bars });
    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/insufficient/);
  });

  it("rejects when position size rounds to zero", () => {
    const bars = makeBars({ count: 30, breakout: true });
    // Tiny equity → quantity = 0
    const result = evaluateBreakout({ ...BASE_PARAMS, bars, accountEquity: 1 });
    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/zero/);
  });

  it("returns structured output on approval", () => {
    const bars = makeBars({ count: 30, breakout: true });
    const result = evaluateBreakout({ ...BASE_PARAMS, bars });
    expect(result).toMatchObject({
      approved: true,
      symbol: "AAPL",
      timeframe: "15Min",
      entryPrice: expect.any(Number),
      stopLoss: expect.any(Number),
      takeProfit: expect.any(Number),
      atr: expect.any(Number),
      quantity: expect.any(Number),
      timestamp: expect.any(String),
    });
  });
});
