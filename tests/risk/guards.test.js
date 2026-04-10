import { describe, it, expect, beforeEach, jest } from "@jest/globals";

// Mock riskState so guards tests don't need a real MongoDB connection
let mockDailyLoss = 0;
let mockCooldowns = {};

jest.unstable_mockModule("../../src/risk/riskState.js", () => ({
  getDailyLoss: jest.fn(async () => mockDailyLoss),
  isInCooldown: jest.fn(async (symbol) => {
    const expiry = mockCooldowns[symbol];
    if (!expiry) return false;
    return new Date(expiry) > new Date();
  }),
  loadRiskState: jest.fn(async () => ({ date: "2026-04-10", dailyRealizedLoss: mockDailyLoss, cooldowns: mockCooldowns })),
  saveRiskState: jest.fn(async (state) => {
    mockDailyLoss = state.dailyRealizedLoss ?? 0;
    mockCooldowns = state.cooldowns ?? {};
  }),
}));

const { runRiskGuards } = await import("../../src/risk/guards.js");

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
  beforeEach(() => {
    mockDailyLoss = 0;
    mockCooldowns = {};
  });

  it("passes when all conditions are met", async () => {
    const result = await runRiskGuards(BASE_PARAMS);
    expect(result.pass).toBe(true);
  });

  it("rejects when daily loss limit is exceeded", async () => {
    mockDailyLoss = 250; // exceeds 2% of 10000
    const result = await runRiskGuards(BASE_PARAMS);
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/daily loss/i);
  });

  it("rejects duplicate open symbol", async () => {
    const result = await runRiskGuards({ ...BASE_PARAMS, openPositions: ["AAPL"] });
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/open position/i);
  });

  it("rejects when max open positions is reached", async () => {
    const result = await runRiskGuards({
      ...BASE_PARAMS,
      openPositions: ["MSFT", "NVDA", "AMZN"],
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/max open positions/i);
  });

  it("rejects when quantity is zero", async () => {
    const result = await runRiskGuards({
      ...BASE_PARAMS,
      decision: { ...VALID_DECISION, quantity: 0 },
    });
    expect(result.pass).toBe(false);
    // quantity: 0 is falsy — hits the missing-required-fields guard first
    expect(result.reason).toBeTruthy();
  });

  it("rejects when required fields are missing", async () => {
    const result = await runRiskGuards({
      ...BASE_PARAMS,
      decision: { symbol: "AAPL" }, // missing entryPrice etc.
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/missing/i);
  });
});
