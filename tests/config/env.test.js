/**
 * Config / env.js alias resolution tests.
 *
 * Tests the alias resolution logic in isolation — without loading env.js directly
 * (which requires real Alpaca credentials at import time).
 *
 * The alias map logic is extracted inline and tested as pure functions.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";

// ─── Alias logic (mirrors src/config/env.js) ──────────────────────────────────

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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("env alias resolution", () => {
  it("SYMBOLS → AUTOPILOT_SYMBOLS when canonical is absent", () => {
    const env = { SYMBOLS: "BTC/USD,ETH/USD" };
    const resolved = applyAliases(env);
    expect(env.AUTOPILOT_SYMBOLS).toBe("BTC/USD,ETH/USD");
    expect(resolved.some((a) => a.from === "SYMBOLS" && a.to === "AUTOPILOT_SYMBOLS")).toBe(true);
  });

  it("WATCHLIST → AUTOPILOT_SYMBOLS when canonical is absent", () => {
    const env = { WATCHLIST: "AAPL,MSFT" };
    applyAliases(env);
    expect(env.AUTOPILOT_SYMBOLS).toBe("AAPL,MSFT");
  });

  it("RISK_PER_TRADE → RISK_PERCENT when canonical is absent", () => {
    const env = { RISK_PER_TRADE: "0.01" };
    const resolved = applyAliases(env);
    expect(env.RISK_PERCENT).toBe("0.01");
    expect(resolved.some((a) => a.from === "RISK_PER_TRADE" && a.to === "RISK_PERCENT")).toBe(true);
  });

  it("SCORE_THRESHOLD → MIN_SETUP_SCORE when canonical is absent", () => {
    const env = { SCORE_THRESHOLD: "60" };
    const resolved = applyAliases(env);
    expect(env.MIN_SETUP_SCORE).toBe("60");
    expect(resolved.some((a) => a.from === "SCORE_THRESHOLD" && a.to === "MIN_SETUP_SCORE")).toBe(true);
  });

  it("legacy alias does NOT override canonical if both are set", () => {
    const env = { SYMBOLS: "LEGACY", AUTOPILOT_SYMBOLS: "CANONICAL" };
    const resolved = applyAliases(env);
    expect(env.AUTOPILOT_SYMBOLS).toBe("CANONICAL");
    expect(resolved.some((a) => a.from === "SYMBOLS")).toBe(false);
  });

  it("resolvedAliases lists only applied aliases", () => {
    const env = { SYMBOLS: "BTC/USD", RISK_PER_TRADE: "0.005" };
    const resolved = applyAliases(env);
    expect(Array.isArray(resolved)).toBe(true);
    expect(resolved).toHaveLength(2);
    expect(resolved.map((a) => a.from)).toContain("SYMBOLS");
    expect(resolved.map((a) => a.from)).toContain("RISK_PER_TRADE");
  });

  it("returns empty array when no aliases are applicable", () => {
    const env = { AUTOPILOT_SYMBOLS: "AAPL", RISK_PERCENT: "0.005" };
    const resolved = applyAliases(env);
    expect(resolved).toHaveLength(0);
  });
});
