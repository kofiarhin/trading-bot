import { describe, it, expect, beforeEach } from "@jest/globals";
import { runRiskGuards } from "../../src/risk/guards.js";

// Reset daily loss state before each test by writing a fresh file
import { saveRiskState } from "../../src/risk/riskState.js";
import { etDateString } from "../../src/utils/time.js";

function freshState() {
  saveRiskState({ date: etDateString(), dailyRealizedLoss: 0, cooldowns: {} });
}

const VALID_DECISION = {
  symbol: "AAPL",
  entryPrice: 180,
  stopLoss: 177,
  takeProfit: 186,
  riskPerUnit: 3,
  riskAmount: 50,
  quantity: 16,
};

const BASE_PARAMS = {
  decision: VALID_DECISION,
  openPositions: [],
  accountEquity: 10_000,
  maxDailyLossPercent: 0.02,
  maxOpenPositions: 3,
};

describe("runRiskGuards", () => {
  beforeEach(() => freshState());

  it("passes when all conditions are met", () => {
    const result = runRiskGuards(BASE_PARAMS);
    expect(result.pass).toBe(true);
  });

  it("rejects when daily loss limit is exceeded", () => {
    saveRiskState({
      date: etDateString(),
      dailyRealizedLoss: 250, // exceeds 2% of 10000
      cooldowns: {},
    });
    const result = runRiskGuards(BASE_PARAMS);
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/daily loss/i);
  });

  it("rejects duplicate open symbol", () => {
    const result = runRiskGuards({ ...BASE_PARAMS, openPositions: ["AAPL"] });
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/open position/i);
  });

  it("rejects when max open positions is reached", () => {
    const result = runRiskGuards({
      ...BASE_PARAMS,
      openPositions: ["MSFT", "NVDA", "AMZN"],
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/max open positions/i);
  });

  it("rejects when quantity is zero", () => {
    const result = runRiskGuards({
      ...BASE_PARAMS,
      decision: { ...VALID_DECISION, quantity: 0 },
    });
    expect(result.pass).toBe(false);
    // quantity: 0 is falsy — hits the missing-required-fields guard first
    expect(result.reason).toBeTruthy();
  });

  it("rejects when required fields are missing", () => {
    const result = runRiskGuards({
      ...BASE_PARAMS,
      decision: { symbol: "AAPL" }, // missing entryPrice etc.
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/missing/i);
  });
});
