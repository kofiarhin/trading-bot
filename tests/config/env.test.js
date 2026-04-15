import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

const BASE_ENV = {
  ALPACA_API_KEY: "test",
  ALPACA_API_SECRET: "test",
  ALPACA_BASE_URL: "https://paper-api.alpaca.markets",
  MONGO_URI: "mongodb://localhost:27017/test",
};

const ALIAS_MAP = {
  SYMBOLS: "AUTOPILOT_SYMBOLS",
  WATCHLIST: "AUTOPILOT_SYMBOLS",
  TICKERS: "AUTOPILOT_SYMBOLS",
  RISK_PER_TRADE: "RISK_PERCENT",
  MAX_POSITIONS: "MAX_OPEN_POSITIONS",
  LOSS_LIMIT_PCT: "MAX_DAILY_LOSS_PERCENT",
  DAILY_LOSS_LIMIT_PCT: "MAX_DAILY_LOSS_PERCENT",
  SCORE_THRESHOLD: "MIN_SETUP_SCORE",
};

function applyAliases(env) {
  const resolved = [];
  for (const [legacy, canonical] of Object.entries(ALIAS_MAP)) {
    if (env[legacy] !== undefined && env[canonical] === undefined) {
      env[canonical] = env[legacy];
      resolved.push({ from: legacy, to: canonical });
    }
  }
  return resolved;
}

async function loadConfig(extra = {}) {
  jest.resetModules();
  process.env = { ...BASE_ENV, ...extra };
  return import("../../src/config/env.js");
}

describe("env alias resolution", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  it("legacy alias does NOT override canonical if both are set", () => {
    const env = { SYMBOLS: "LEGACY", AUTOPILOT_SYMBOLS: "CANONICAL" };
    const resolved = applyAliases(env);
    expect(env.AUTOPILOT_SYMBOLS).toBe("CANONICAL");
    expect(resolved.some((a) => a.from === "SYMBOLS")).toBe(false);
  });

  it("loads canonical symbols from AUTOPILOT_SYMBOLS", async () => {
    const { config } = await loadConfig({ AUTOPILOT_SYMBOLS: "AAPL,MSFT" });
    expect(config.trading.symbols).toEqual(["AAPL", "MSFT"]);
  });

  it("maps SYMBOLS alias to canonical AUTOPILOT_SYMBOLS when canonical missing", async () => {
    const { config, resolvedAliases } = await loadConfig({ SYMBOLS: "BTC/USD,ETH/USD" });
    expect(config.trading.symbols).toEqual(["BTC/USD", "ETH/USD"]);
    expect(resolvedAliases).toContainEqual({ from: "SYMBOLS", to: "AUTOPILOT_SYMBOLS" });
  });

  it("canonical max positions overrides legacy MAX_POSITIONS", async () => {
    const { config } = await loadConfig({ MAX_POSITIONS: "2", MAX_OPEN_POSITIONS: "7" });
    expect(config.trading.maxOpenPositions).toBe(7);
  });

  it("legacy MAX_POSITIONS maps to canonical MAX_OPEN_POSITIONS when canonical is missing", async () => {
    const { config, resolvedAliases } = await loadConfig({ MAX_POSITIONS: "6" });
    expect(config.trading.maxOpenPositions).toBe(6);
    expect(resolvedAliases).toContainEqual({ from: "MAX_POSITIONS", to: "MAX_OPEN_POSITIONS" });
  });

  it("canonical MAX_DAILY_LOSS_PERCENT overrides DAILY_LOSS_LIMIT_PCT alias", async () => {
    const { config } = await loadConfig({ DAILY_LOSS_LIMIT_PCT: "1", MAX_DAILY_LOSS_PERCENT: "3" });
    expect(config.trading.dailyLossLimitPct).toBe(3);
    expect(config.trading.maxDailyLossPercent).toBe(0.03);
  });

  it("reads MAX_CANDIDATES_PER_CYCLE as canonical runtime value", async () => {
    const { config } = await loadConfig({ MAX_CANDIDATES_PER_CYCLE: "9" });
    expect(config.trading.maxCandidatesPerCycle).toBe(9);
  });

  it("loads canonical prefilter/strategy/risk config fields", async () => {
    const { config } = await loadConfig({
      PREFILTER_MIN_BARS: "30",
      PREFILTER_MIN_VOL_RATIO: "1.4",
      PREFILTER_MIN_RANGE_ATR_MULTIPLE: "1.8",
      PREFILTER_MAX_DISTANCE_TO_BREAKOUT_PCT: "0.9",
      BREAKOUT_CONFIRMATION_PCT: "0.2",
      MAX_TOTAL_RISK_PCT: "4",
      MAX_CORRELATED_POSITIONS: "2",
      DRAWDOWN_THROTTLE_PCT: "0.8",
    });
    expect(config.prefilter).toEqual({
      minBars: 30,
      minVolRatio: 1.4,
      minRangeAtrMultiple: 1.8,
      maxDistanceToBreakoutPct: 0.9,
    });
    expect(config.strategy.breakoutConfirmationPct).toBe(0.2);
    expect(config.risk).toEqual({
      maxTotalRiskPct: 4,
      maxCorrelatedPositions: 2,
      drawdownThrottlePct: 0.8,
    });
  });
});
