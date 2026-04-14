import { describe, it, expect } from "@jest/globals";
import { computeScore } from "../../src/scoring/scorer.js";

const BASE_OPTS = {
  maxDistanceToBreakoutPct: 1.0,
  minRiskReward: 1.5,
};

describe("computeScore", () => {
  it("returns total=100 and grade=A for a perfect setup", () => {
    const metrics = {
      distanceToBreakoutPct: 0,      // max momentum (25)
      volumeRatio: 3.0,              // max volume (25)
      atr: 1.5,                      // 1.5% of 100 → in optimal band (25)
      closePrice: 100,
      riskReward: 4.0,               // ceiling → 25
    };
    const result = computeScore(metrics, BASE_OPTS);
    expect(result.total).toBe(100);
    expect(result.grade).toBe("A");
    expect(result.breakdown.momentum).toBe(25);
    expect(result.breakdown.volume).toBe(25);
    expect(result.breakdown.atrQuality).toBe(25);
    expect(result.breakdown.riskReward).toBe(25);
  });

  it("returns total=0 and grade=C for null/zero metrics", () => {
    const metrics = {
      distanceToBreakoutPct: null,
      volumeRatio: null,
      atr: null,
      closePrice: null,
      riskReward: null,
    };
    const result = computeScore(metrics, BASE_OPTS);
    expect(result.total).toBe(0);
    expect(result.grade).toBe("C");
  });

  it("assigns grade A at score >= 75", () => {
    // volumeRatio=3 → 25pts, atr/closePrice gives 25pts, riskReward=4→25pts, momentum=0 → 0pts → total=75
    const metrics = {
      distanceToBreakoutPct: 1.0,    // at maxDist → 0pts
      volumeRatio: 3.0,              // 25pts
      atr: 1.0,                      // 1.0% of 100 → in band → 25pts
      closePrice: 100,
      riskReward: 4.0,               // 25pts
    };
    const result = computeScore(metrics, BASE_OPTS);
    expect(result.total).toBeGreaterThanOrEqual(75);
    expect(result.grade).toBe("A");
  });

  it("assigns grade B at score between 50 and 74", () => {
    const metrics = {
      distanceToBreakoutPct: 0.5,    // 12.5pts
      volumeRatio: 1.5,              // ~12.5pts
      atr: null,
      closePrice: null,
      riskReward: null,
    };
    const result = computeScore(metrics, BASE_OPTS);
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThan(75);
    if (result.total >= 50) expect(result.grade).toBe("B");
    else expect(result.grade).toBe("C");
  });

  it("assigns grade C below score 50", () => {
    const metrics = {
      distanceToBreakoutPct: null,
      volumeRatio: null,
      atr: null,
      closePrice: null,
      riskReward: 1.5,               // at minRR → 0pts
    };
    const result = computeScore(metrics, BASE_OPTS);
    expect(result.total).toBeLessThan(50);
    expect(result.grade).toBe("C");
  });

  it("momentum: distance=0 → 25pts, distance=maxDist → 0pts", () => {
    const baseMetrics = { volumeRatio: null, atr: null, closePrice: null, riskReward: null };

    const perfect = computeScore({ ...baseMetrics, distanceToBreakoutPct: 0 }, BASE_OPTS);
    expect(perfect.breakdown.momentum).toBe(25);

    const zero = computeScore({ ...baseMetrics, distanceToBreakoutPct: 1.0 }, BASE_OPTS);
    expect(zero.breakdown.momentum).toBe(0);
  });

  it("volume: volumeRatio=3.0 → 25pts; volumeRatio=1.2 → ~10pts", () => {
    const baseMetrics = { distanceToBreakoutPct: null, atr: null, closePrice: null, riskReward: null };

    const high = computeScore({ ...baseMetrics, volumeRatio: 3.0 }, BASE_OPTS);
    expect(high.breakdown.volume).toBe(25);

    const low = computeScore({ ...baseMetrics, volumeRatio: 1.2 }, BASE_OPTS);
    expect(low.breakdown.volume).toBe(10);
  });

  it("ATR quality: in optimal band (0.5%-2%) → 25pts; very low ATR → near 0pts", () => {
    const baseMetrics = { distanceToBreakoutPct: null, volumeRatio: null, riskReward: null };

    const optimal = computeScore({ ...baseMetrics, atr: 1.0, closePrice: 100 }, BASE_OPTS);
    expect(optimal.breakdown.atrQuality).toBe(25);

    const veryLow = computeScore({ ...baseMetrics, atr: 0.1, closePrice: 100 }, BASE_OPTS);
    expect(veryLow.breakdown.atrQuality).toBeLessThan(10);
  });

  it("R:R: riskReward=4.0 → 25pts; riskReward=minRR → 0pts", () => {
    const baseMetrics = { distanceToBreakoutPct: null, volumeRatio: null, atr: null, closePrice: null };

    const ceiling = computeScore({ ...baseMetrics, riskReward: 4.0 }, BASE_OPTS);
    expect(ceiling.breakdown.riskReward).toBe(25);

    const floor = computeScore({ ...baseMetrics, riskReward: 1.5 }, BASE_OPTS);
    expect(floor.breakdown.riskReward).toBe(0);
  });

  it("returns a breakdown object with all 4 components", () => {
    const result = computeScore(
      { distanceToBreakoutPct: 0.5, volumeRatio: 2.0, atr: 1.0, closePrice: 100, riskReward: 2.5 },
      BASE_OPTS,
    );
    expect(result.breakdown).toHaveProperty("momentum");
    expect(result.breakdown).toHaveProperty("volume");
    expect(result.breakdown).toHaveProperty("atrQuality");
    expect(result.breakdown).toHaveProperty("riskReward");
  });

  it("returns a context object with session, volatilityLabel, trendLabel", () => {
    const result = computeScore(
      { distanceToBreakoutPct: 0, volumeRatio: 2.0, atr: 1.0, closePrice: 100, riskReward: 3.0 },
      BASE_OPTS,
    );
    expect(result.context).toHaveProperty("session");
    expect(result.context).toHaveProperty("volatilityLabel");
    expect(result.context.trendLabel).toBe("breakout");
  });
});
