import { describe, it, expect } from "@jest/globals";
import { evaluateBreakout } from "../../src/strategies/breakoutStrategy.js";

// ─── Bar factories ────────────────────────────────────────────────────────────

/**
 * Builds a synthetic bar array for strategy testing.
 *
 * @param {object} opts
 * @param {number} opts.count       Total bar count (default 30)
 * @param {number} opts.baseClose   Starting close price (default 100)
 * @param {boolean} opts.breakout   If true, last bar closes just above breakout level (~0.8%)
 * @param {boolean} opts.lowVolume  If true, last bar has very low volume (triggers weak_volume)
 * @param {boolean} opts.overextended  If true, last bar is 3% above breakout (triggers breakout_too_extended)
 * @param {boolean} opts.tinyRange  If true, bars have 0.02 range → ATR ≈ 0.015 (triggers atr_too_low)
 */
function makeBars({
  count = 30,
  baseClose = 100,
  breakout = false,
  lowVolume = false,
  overextended = false,
  tinyRange = false,
} = {}) {
  const range = tinyRange ? 0.01 : 0.5;
  const bars = [];
  for (let i = 0; i < count; i++) {
    const c = baseClose + i * 0.05;
    bars.push({
      t: new Date(Date.now() - (count - i) * 900_000).toISOString(),
      o: c - 0.1,
      h: c + range,
      l: c - range,
      c,
      v: 1_500_000,
    });
  }

  if (breakout || overextended) {
    const lastHighestHigh = Math.max(...bars.slice(-21, -1).map((b) => b.h));
    // 0.8% above = safely inside the 1.0% max-distance limit (valid breakout).
    // 3% above = exceeds the limit (overextended breakout).
    const pct = overextended ? 1.03 : 1.008;
    const breakoutClose = lastHighestHigh * pct;
    bars[bars.length - 1] = {
      ...bars[bars.length - 1],
      h: breakoutClose + range,
      c: breakoutClose,
      v: lowVolume ? 100 : 2_500_000,
    };
  } else if (lowVolume) {
    bars[bars.length - 1] = { ...bars[bars.length - 1], v: 100 };
  }

  return bars;
}

// ─── Shared params ────────────────────────────────────────────────────────────

const BASE_PARAMS = {
  symbol: "AAPL",
  assetClass: "stock",
  accountEquity: 10_000,
  riskPercent: 0.005,
  timeframe: "15Min",
};

// ─── Approval tests ───────────────────────────────────────────────────────────

describe("evaluateBreakout — approved path", () => {
  it("approves a valid breakout with volume confirmation", () => {
    const bars = makeBars({ count: 30, breakout: true });
    const result = evaluateBreakout({ ...BASE_PARAMS, bars });
    expect(result.approved).toBe(true);
    expect(result.symbol).toBe("AAPL");
    expect(result.quantity).toBeGreaterThanOrEqual(1);
    expect(result.stopLoss).toBeLessThan(result.entryPrice);
    expect(result.takeProfit).toBeGreaterThan(result.entryPrice);
  });

  it("returns fully canonical structured output on approval", () => {
    const bars = makeBars({ count: 30, breakout: true });
    const result = evaluateBreakout({ ...BASE_PARAMS, bars });
    // Top-level canonical fields
    expect(result).toMatchObject({
      approved: true,
      symbol: "AAPL",
      normalizedSymbol: "AAPL",
      assetClass: "stock",
      strategyName: "momentum_breakout_atr_v1",
      timeframe: "15Min",
      side: "buy",
      reason: "breakout_confirmed",
      blockers: [],
      entryPrice: expect.any(Number),
      stopLoss: expect.any(Number),
      takeProfit: expect.any(Number),
      quantity: expect.any(Number),
      riskAmount: expect.any(Number),
      riskReward: expect.any(Number),
      timestamp: expect.any(String),
    });
    // Metrics sub-object
    expect(result.metrics).toMatchObject({
      closePrice: expect.any(Number),
      breakoutLevel: expect.any(Number),
      atr: expect.any(Number),
      volumeRatio: expect.any(Number),
      distanceToBreakoutPct: expect.any(Number),
    });
  });

  it("riskAmount equals total planned dollar risk (accountEquity × riskPercent), not per-share risk", () => {
    const bars = makeBars({ count: 30, breakout: true });
    const result = evaluateBreakout({ ...BASE_PARAMS, bars, accountEquity: 10_000, riskPercent: 0.005 });
    expect(result.approved).toBe(true);
    // Total planned risk should be close to 10_000 * 0.005 = 50
    expect(result.riskAmount).toBeCloseTo(50, 0);
    // It should NOT be a per-share value (which would be entryPrice - stopLoss)
    const riskPerShare = result.entryPrice - result.stopLoss;
    expect(result.riskAmount).not.toBeCloseTo(riskPerShare, 1);
  });

  it("distanceToBreakoutPct is positive when close is above breakout level", () => {
    const bars = makeBars({ count: 30, breakout: true });
    const result = evaluateBreakout({ ...BASE_PARAMS, bars });
    expect(result.approved).toBe(true);
    expect(result.metrics.distanceToBreakoutPct).toBeGreaterThan(0);
  });
});

// ─── Rejection tests ──────────────────────────────────────────────────────────

describe("evaluateBreakout — rejection paths", () => {
  it("rejects with insufficient_market_data when bar history is too short", () => {
    const bars = makeBars({ count: 10 });
    const result = evaluateBreakout({ ...BASE_PARAMS, bars });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe("insufficient_market_data");
    expect(result.blockers).toContain("insufficient_market_data");
  });

  it("rejects with no_breakout when close does not exceed the highest high", () => {
    const bars = makeBars({ count: 30, breakout: false });
    const result = evaluateBreakout({ ...BASE_PARAMS, bars });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe("no_breakout");
    expect(result.blockers).toContain("no_breakout");
    // Metrics are still populated for diagnostic purposes
    expect(result.metrics.closePrice).toEqual(expect.any(Number));
    expect(result.metrics.breakoutLevel).toEqual(expect.any(Number));
    expect(result.metrics.distanceToBreakoutPct).toBeLessThanOrEqual(0);
  });

  it("rejects with breakout_too_extended when close is far above the breakout level", () => {
    const bars = makeBars({ count: 30, overextended: true });
    const result = evaluateBreakout({ ...BASE_PARAMS, bars });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe("breakout_too_extended");
    expect(result.blockers).toContain("breakout_too_extended");
    expect(result.metrics.distanceToBreakoutPct).toBeGreaterThan(1.0);
  });

  it("rejects with weak_volume when volume ratio is below minVolRatio", () => {
    const bars = makeBars({ count: 30, breakout: true, lowVolume: true });
    const result = evaluateBreakout({ ...BASE_PARAMS, bars });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe("weak_volume");
    expect(result.blockers).toContain("weak_volume");
    // Partial metrics are available
    expect(result.metrics.closePrice).toEqual(expect.any(Number));
    expect(result.metrics.breakoutLevel).toEqual(expect.any(Number));
    expect(result.metrics.volumeRatio).toBeLessThan(1.2);
  });

  it("rejects with atr_too_low when bars have an insignificant true range", () => {
    // tinyRange bars have ATR ≈ 0.015 — well below the 0.25 default minAtr
    const bars = makeBars({ count: 30, breakout: true, tinyRange: true });
    const result = evaluateBreakout({ ...BASE_PARAMS, bars });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe("atr_too_low");
    expect(result.blockers).toContain("atr_too_low");
  });

  it("rejects with invalid_risk_reward when position size rounds to zero (tiny equity)", () => {
    const bars = makeBars({ count: 30, breakout: true });
    // accountEquity: 1 → riskAmount = 0.005 → quantity = floor(0.005 / ~0.9) = 0
    const result = evaluateBreakout({ ...BASE_PARAMS, bars, accountEquity: 1 });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe("invalid_risk_reward");
  });
});

// ─── Rejection metrics completeness ──────────────────────────────────────────

describe("evaluateBreakout — partial metrics on rejection", () => {
  it("includes computed metrics on no_breakout rejection for dashboard display", () => {
    const bars = makeBars({ count: 30, breakout: false });
    const result = evaluateBreakout({ ...BASE_PARAMS, bars });
    expect(result.metrics.closePrice).toEqual(expect.any(Number));
    expect(result.metrics.breakoutLevel).toEqual(expect.any(Number));
    expect(result.metrics.atr).toEqual(expect.any(Number));
    expect(result.metrics.volumeRatio).toEqual(expect.any(Number));
  });

  it("includes available metrics on weak_volume rejection", () => {
    const bars = makeBars({ count: 30, breakout: true, lowVolume: true });
    const result = evaluateBreakout({ ...BASE_PARAMS, bars });
    expect(result.metrics.closePrice).toEqual(expect.any(Number));
    expect(result.metrics.breakoutLevel).toEqual(expect.any(Number));
    expect(result.metrics.volumeRatio).toBeLessThan(1.2);
  });

  it("includes available metrics on atr_too_low rejection", () => {
    const bars = makeBars({ count: 30, breakout: true, tinyRange: true });
    const result = evaluateBreakout({ ...BASE_PARAMS, bars });
    expect(result.metrics.closePrice).toEqual(expect.any(Number));
    expect(result.metrics.atr).toEqual(expect.any(Number));
    expect(result.metrics.atr).toBeLessThan(0.25);
  });
});

// ─── Crypto asset class ───────────────────────────────────────────────────────

describe("evaluateBreakout — crypto asset class", () => {
  it("approves a valid crypto breakout and returns fractional quantity", () => {
    const bars = makeBars({ count: 30, breakout: true, baseClose: 90_000 });
    const result = evaluateBreakout({
      symbol: "BTC/USD",
      assetClass: "crypto",
      accountEquity: 100_000,
      riskPercent: 0.005,
      bars,
    });
    expect(result.approved).toBe(true);
    expect(result.normalizedSymbol).toBe("BTCUSD");
    expect(result.quantity).toBeGreaterThan(0);
    // Crypto quantity should be fractional
    expect(result.quantity).toBeLessThan(1);
  });
});
