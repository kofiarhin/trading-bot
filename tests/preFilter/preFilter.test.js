import { describe, it, expect } from "@jest/globals";
import { preFilter } from "../../src/preFilter.js";

// ─── Bar factory ──────────────────────────────────────────────────────────────

// Default volumes: lookback bars at 1_000_000, last bar at 1_500_000.
// volumeRatio = 1_500_000 / 1_000_000 = 1.5 → passes the 1.2 minimum.
// lowVolume: last bar at 300_000 → ratio 0.3 → fails.
function makeBars({
  count = 30,
  baseClose = 100,
  breakout = false,
  overextended = false,
  lowVolume = false,
  tinyRange = false,
  missingVolume = false,
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
      v: missingVolume ? undefined : 1_000_000,
    });
  }

  if (breakout || overextended) {
    const prevHigh = Math.max(...bars.slice(-21, -1).map((b) => b.h));
    const mult = overextended ? 1.03 : 1.008;
    const lastClose = prevHigh * mult;
    bars[bars.length - 1] = {
      ...bars[bars.length - 1],
      c: lastClose,
      h: lastClose + 0.1,
      l: lastClose - 0.1,
      v: lowVolume ? 300_000 : missingVolume ? 1_500_000 : 1_500_000,
    };
  } else {
    // Non-breakout: last bar has higher volume so volume ratio passes
    // and we reach the breakout check
    bars[bars.length - 1] = {
      ...bars[bars.length - 1],
      v: lowVolume ? 300_000 : missingVolume ? undefined : 1_500_000,
    };
  }

  return bars;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("preFilter", () => {
  it("passes a healthy breakout symbol and returns full metrics", () => {
    const bars = makeBars({ count: 30, breakout: true });
    const result = preFilter("AAPL", "stock", bars);
    expect(result.passed).toBe(true);
    expect(result.rejectReason).toBeNull();
    expect(result.rejectStage).toBeNull();
    expect(result.metrics).not.toBeNull();
    expect(typeof result.metrics.closePrice).toBe("number");
    expect(typeof result.metrics.highestHigh).toBe("number");
    expect(typeof result.metrics.atr).toBe("number");
    expect(typeof result.metrics.volumeRatio).toBe("number");
    expect(typeof result.metrics.distanceToBreakoutPct).toBe("number");
    expect(typeof result.metrics.barCount).toBe("number");
  });

  it("rejects with insufficient_market_data when bar count is too low", () => {
    const bars = makeBars({ count: 10 });
    const result = preFilter("AAPL", "stock", bars);
    expect(result.passed).toBe(false);
    expect(result.rejectReason).toBe("insufficient_market_data");
    expect(result.rejectStage).toBe("pre_filter");
    expect(result.metrics).toBeNull();
  });

  it("rejects with insufficient_market_data when bars is empty array", () => {
    const result = preFilter("AAPL", "stock", []);
    expect(result.passed).toBe(false);
    expect(result.rejectReason).toBe("insufficient_market_data");
  });

  it("rejects with atr_too_low when ATR is below minimum (tiny range bars)", () => {
    const bars = makeBars({ count: 30, breakout: true, tinyRange: true });
    const result = preFilter("AAPL", "stock", bars);
    expect(result.passed).toBe(false);
    expect(result.rejectReason).toBe("atr_too_low");
    expect(result.rejectStage).toBe("pre_filter");
  });

  it("rejects with missing_volume when bars have no volume", () => {
    const bars = makeBars({ count: 30, breakout: true, missingVolume: true });
    const result = preFilter("AAPL", "stock", bars);
    expect(result.passed).toBe(false);
    expect(result.rejectReason).toBe("missing_volume");
    expect(result.rejectStage).toBe("pre_filter");
  });

  it("rejects with weak_volume when volume ratio is below minimum", () => {
    const bars = makeBars({ count: 30, breakout: true, lowVolume: true });
    const result = preFilter("AAPL", "stock", bars);
    expect(result.passed).toBe(false);
    expect(result.rejectReason).toBe("weak_volume");
    expect(result.rejectStage).toBe("pre_filter");
  });

  it("rejects with no_breakout when close is below highest high", () => {
    const bars = makeBars({ count: 30 }); // no breakout flag
    const result = preFilter("AAPL", "stock", bars);
    expect(result.passed).toBe(false);
    expect(result.rejectReason).toBe("no_breakout");
    expect(result.rejectStage).toBe("pre_filter");
  });

  it("rejects with overextended_breakout when price is too far above level", () => {
    const bars = makeBars({ count: 30, overextended: true });
    const result = preFilter("AAPL", "stock", bars, { maxDistanceToBreakoutPct: 1.0 });
    expect(result.passed).toBe(false);
    expect(result.rejectReason).toBe("overextended_breakout");
    expect(result.rejectStage).toBe("pre_filter");
  });

  it("returns metrics as null when data check fails (no bars)", () => {
    const result = preFilter("BTC/USD", "crypto", null);
    expect(result.passed).toBe(false);
    expect(result.metrics).toBeNull();
  });
});
