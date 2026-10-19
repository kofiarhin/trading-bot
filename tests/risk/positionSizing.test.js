import { describe, it, expect } from "@jest/globals";
import { validatePositionSize } from "../../src/risk/positionSizing.js";

describe("validatePositionSize", () => {
  it("passes with valid inputs", () => {
    expect(validatePositionSize({ riskPerUnit: 3, riskAmount: 50, quantity: 16 })).toEqual({ valid: true });
  });

  it("rejects when riskPerUnit is zero", () => {
    const r = validatePositionSize({ riskPerUnit: 0, riskAmount: 50, quantity: 16 });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/riskPerUnit/);
  });

  it("rejects when riskAmount is zero", () => {
    const r = validatePositionSize({ riskPerUnit: 3, riskAmount: 0, quantity: 16 });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/riskAmount/);
  });

  it("rejects when quantity is less than 1", () => {
    const r = validatePositionSize({ riskPerUnit: 3, riskAmount: 50, quantity: 0 });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/quantity/);
  });
});

describe("validatePositionSize — crypto", () => {
  it("accepts fractional crypto quantities", () => {
    expect(validatePositionSize({ riskPerUnit: 500, riskAmount: 50, quantity: 0.1, assetClass: "crypto" }))
      .toEqual({ valid: true });
  });

  it("still rejects zero crypto quantity", () => {
    expect(validatePositionSize({ riskPerUnit: 500, riskAmount: 50, quantity: 0, assetClass: "crypto" }).valid)
      .toBe(false);
  });

  it("enforces the asset's minimum order size when given", () => {
    const r = validatePositionSize({ riskPerUnit: 500, riskAmount: 50, quantity: 0.001, assetClass: "crypto", minQty: 0.01 });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/minimum order size/);
  });

  it("keeps whole-share rule for stocks", () => {
    expect(validatePositionSize({ riskPerUnit: 3, riskAmount: 50, quantity: 0.5 }).valid).toBe(false);
  });
});
