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
  MAX_OPEN_POSITIONS: "MAX_POSITIONS",
  LOSS_LIMIT_PCT: "DAILY_LOSS_LIMIT_PCT",
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

  it("canonical max positions overrides legacy MAX_OPEN_POSITIONS", async () => {
    const { config } = await loadConfig({ MAX_OPEN_POSITIONS: "2", MAX_POSITIONS: "7" });
    expect(config.trading.maxOpenPositions).toBe(7);
  });

  it("reads MAX_CANDIDATES_PER_CYCLE as canonical runtime value", async () => {
    const { config } = await loadConfig({ MAX_CANDIDATES_PER_CYCLE: "9" });
    expect(config.trading.maxCandidatesPerCycle).toBe(9);
  });
});
