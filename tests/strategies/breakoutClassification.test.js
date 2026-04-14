/**
 * Tests for near-breakout classification, updated rejection reasons,
 * and score-based gating added in the strategy quality fix.
 */
import { describe, it, expect } from "@jest/globals";
import { evaluateBreakout, mapRejectionClass, mapRejectionGroup } from "../../src/strategies/breakoutStrategy.js";

// ─── Bar factories ─────────────────────────────────────────────────────────────

function makeBars({
  count = 30,
  baseClose = 100,
  breakout = false,
  nearMiss = false,
  overextended = false,
  lowVolume = false,
  noVolume = false,
  tinyAtr = false,
} = {}) {
  const range = tinyAtr ? 0.01 : 0.5;
  const bars = [];
  for (let i = 0; i < count; i++) {
    const c = baseClose + i * 0.05;
    bars.push({ t: new Date().toISOString(), o: c - 0.1, h: c + range, l: c - range, c, v: 1_500_000 });
  }

  const lastHighestHigh = Math.max(...bars.slice(-21, -1).map((b) => b.h));

  if (breakout) {
    // 0.8% above breakout level — valid confirmed breakout
    const c = lastHighestHigh * 1.008;
    bars[bars.length - 1] = { ...bars[bars.length - 1], c, h: c + range, v: noVolume ? 0 : lowVolume ? 100 : 2_500_000 };
  } else if (nearMiss) {
    // 0.3% below breakout level — near_breakout (within default 0.5% near-miss window)
    const c = lastHighestHigh * 0.997;
    bars[bars.length - 1] = { ...bars[bars.length - 1], c, h: c + range, v: 2_500_000 };
  } else if (overextended) {
    // 3% above breakout level — overextended
    const c = lastHighestHigh * 1.03;
    bars[bars.length - 1] = { ...bars[bars.length - 1], c, h: c + range, v: 2_500_000 };
  }

  return bars;
}

const BASE = { symbol: "AAPL", assetClass: "stock", accountEquity: 10_000, riskPercent: 0.005 };

// ── breakoutClassification field ───────────────────────────────────────────────

describe("breakoutClassification", () => {
  it("sets confirmed_breakout for a valid breakout", () => {
    const result = evaluateBreakout({ ...BASE, bars: makeBars({ breakout: true }) });
    expect(result.approved).toBe(true);
    expect(result.breakoutClassification).toBe("confirmed_breakout");
    expect(result.metrics.breakoutClassification).toBe("confirmed_breakout");
  });

  it("sets near_breakout and rejects when price is just below breakout level", () => {
    const result = evaluateBreakout({ ...BASE, bars: makeBars({ nearMiss: true }) });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe("near_breakout");
    expect(result.breakoutClassification).toBe("near_breakout");
  });

  it("sets no_breakout and rejects when price is clearly below breakout level", () => {
    // Use a bar set where the last close is far below the breakout level (>0.5% near-miss window)
    // baseClose=100, bars go up slightly, but the highest high from the lookback window will be
    // well above the last close when we force the last bar to have a low close.
    const bars = makeBars({ count: 30 });
    // Force the last bar's close well below the highest high in the preceding bars
    const secondLastIdx = bars.length - 2;
    bars[secondLastIdx].h = 200; // artificially raise the highest high far above current price
    const result = evaluateBreakout({ ...BASE, bars });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe("no_breakout");
    expect(result.breakoutClassification).toBe("no_breakout");
  });

  it("rejects with overextended_breakout when price is too far above level", () => {
    const result = evaluateBreakout({ ...BASE, bars: makeBars({ overextended: true }) });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe("overextended_breakout");
  });
});

// ── Volume rejection reason granularity ───────────────────────────────────────

describe("volume rejection reasons", () => {
  it("rejects with weak_volume when volume ratio is below threshold", () => {
    const result = evaluateBreakout({ ...BASE, bars: makeBars({ breakout: true, lowVolume: true }) });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe("weak_volume");
  });

  it("rejects with missing_volume when average volume is zero", () => {
    // Force no-volume bars
    const bars = makeBars({ breakout: true, noVolume: true });
    // Zero out all bar volumes to make avgVolume=0
    const zeroed = bars.map((b) => ({ ...b, v: 0 }));
    const lastHighestHigh = Math.max(...zeroed.slice(-21, -1).map((b) => b.h));
    const c = lastHighestHigh * 1.008;
    zeroed[zeroed.length - 1] = { ...zeroed[zeroed.length - 1], c, h: c + 0.5 };
    const result = evaluateBreakout({ ...BASE, bars: zeroed });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe("missing_volume");
  });
});

// ── Score-based gating ────────────────────────────────────────────────────────

describe("score-based gating", () => {
  it("rejects with score_below_threshold when minSetupScore is very high", () => {
    const bars = makeBars({ breakout: true });
    const result = evaluateBreakout({
      ...BASE,
      bars,
      options: { minSetupScore: 999 }, // impossible threshold
    });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe("score_below_threshold");
  });

  it("approves when score meets threshold", () => {
    const bars = makeBars({ breakout: true });
    const result = evaluateBreakout({
      ...BASE,
      bars,
      options: { minSetupScore: 1 }, // very low threshold
    });
    expect(result.approved).toBe(true);
  });
});

// ── mapRejectionClass ─────────────────────────────────────────────────────────

describe("mapRejectionClass", () => {
  it("maps no_breakout to no_signal", () => {
    expect(mapRejectionClass("no_breakout")).toBe("no_signal");
  });
  it("maps near_breakout to no_signal", () => {
    expect(mapRejectionClass("near_breakout")).toBe("no_signal");
  });
  it("maps overextended_breakout to no_signal", () => {
    expect(mapRejectionClass("overextended_breakout")).toBe("no_signal");
  });
  it("maps weak_volume to weak_conditions", () => {
    expect(mapRejectionClass("weak_volume")).toBe("weak_conditions");
  });
  it("maps missing_volume to weak_conditions", () => {
    expect(mapRejectionClass("missing_volume")).toBe("weak_conditions");
  });
  it("maps insufficient_market_data to data_quality", () => {
    expect(mapRejectionClass("insufficient_market_data")).toBe("data_quality");
  });
  it("maps invalid_position_size to sizing_error", () => {
    expect(mapRejectionClass("invalid_position_size")).toBe("sizing_error");
  });
});

// ── mapRejectionGroup ─────────────────────────────────────────────────────────

describe("mapRejectionGroup", () => {
  it("maps no_breakout to signal_quality", () => {
    expect(mapRejectionGroup("no_breakout")).toBe("signal_quality");
  });
  it("maps insufficient_market_data to data_quality", () => {
    expect(mapRejectionGroup("insufficient_market_data")).toBe("data_quality");
  });
  it("maps invalid_position_size to execution_guard", () => {
    expect(mapRejectionGroup("invalid_position_size")).toBe("execution_guard");
  });
  it("maps daily_loss_guard to risk_guard", () => {
    expect(mapRejectionGroup("daily_loss_guard")).toBe("risk_guard");
  });
  it("maps unknown reason to signal_quality", () => {
    expect(mapRejectionGroup("some_unknown_reason")).toBe("signal_quality");
  });
});

// ── rejectionGroup field on rejected decisions ────────────────────────────────

describe("rejectionGroup field on decision objects", () => {
  it("populates rejectionGroup on no_breakout rejections", () => {
    const result = evaluateBreakout({ ...BASE, bars: makeBars() });
    expect(result.rejectionGroup).toBe("signal_quality");
  });

  it("populates rejectionGroup on insufficient_market_data rejections", () => {
    const result = evaluateBreakout({ ...BASE, bars: [] });
    expect(result.rejectionGroup).toBe("data_quality");
  });
});
