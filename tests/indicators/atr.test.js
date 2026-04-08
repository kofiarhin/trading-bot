import { describe, it, expect } from "@jest/globals";
import { calcATR } from "../../src/indicators/atr.js";

function makeBars(closes) {
  // Synthetic bars: each bar has h = close+1, l = close-1
  return closes.map((c) => ({ o: c, h: c + 1, l: c - 1, c, v: 1000 }));
}

describe("calcATR", () => {
  it("returns null when insufficient bars", () => {
    expect(calcATR(makeBars([100, 101]), 14)).toBeNull();
  });

  it("returns a positive number for valid bar set", () => {
    const bars = makeBars(Array.from({ length: 20 }, (_, i) => 100 + i));
    const atr = calcATR(bars, 14);
    expect(atr).not.toBeNull();
    expect(atr).toBeGreaterThan(0);
  });

  it("returns 2 for constant price bars with h-l spread of 2", () => {
    // h = c + 1, l = c - 1 → TR = max(2, ~0, ~0) = 2 when price is constant
    const bars = makeBars(Array.from({ length: 20 }, () => 100));
    const atr = calcATR(bars, 14);
    expect(atr).toBeCloseTo(2, 5);
  });
});
