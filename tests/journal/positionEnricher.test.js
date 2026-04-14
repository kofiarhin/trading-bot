/**
 * Tests for positionEnricher.js — broker-sync enrichment and management status.
 * Uses Jest ESM unstable_mockModule pattern.
 */
import { jest, describe, it, expect } from "@jest/globals";

// Mocks must be declared before dynamic imports in ESM mode
// positionEnricher reads config from process.env directly (no env.js import),
// so we set the relevant env vars here instead.
process.env.BROKER_SYNC_ENABLE_DERIVED_RISK = 'true';
process.env.BROKER_SYNC_STOP_PCT = '0.02';
process.env.BROKER_SYNC_TARGET_R_MULTIPLE = '2';
process.env.TRAILING_ATR_MULTIPLIER = '1.5';

jest.unstable_mockModule("../../src/utils/logger.js", () => ({
  logger: { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

jest.unstable_mockModule("../../src/repositories/tradeJournalRepo.mongo.js", () => ({
  appendTradeEvent: jest.fn().mockResolvedValue(undefined),
  upsertOpenTrade: jest.fn().mockResolvedValue({}),
  getOpenTrades: jest.fn().mockResolvedValue([]),
  getOpenTradeById: jest.fn().mockResolvedValue(null),
  removeOpenTrade: jest.fn().mockResolvedValue(undefined),
  getClosedTrades: jest.fn().mockResolvedValue([]),
  upsertClosedTrade: jest.fn().mockResolvedValue({}),
  getTradeEvents: jest.fn().mockResolvedValue([]),
  getTradeEventsForDate: jest.fn().mockResolvedValue([]),
  getClosedTradesForDate: jest.fn().mockResolvedValue([]),
}));

const { enrichPosition } = await import("../../src/journal/positionEnricher.js");

// ── Strategy-originated trades ───────────────────────────────────────────────

describe("strategy origin", () => {
  it("returns managed when stop and target are present", () => {
    const trade = {
      tradeId: "t1",
      strategyName: "momentum_breakout_atr_v1",
      entryPrice: 100,
      stopLoss: 97,
      takeProfit: 106,
    };
    const result = enrichPosition(trade, null);
    expect(result.origin).toBe("strategy");
    expect(result.managementStatus).toBe("managed");
    expect(result.riskSource).toBe("journal");
    expect(result.exitCoverage).toBe("full");
    expect(result.stopLoss).toBe(97);
    expect(result.takeProfit).toBe(106);
    expect(result.riskPerUnit).toBe(3);
  });

  it("returns partial coverage when only stop is present", () => {
    const trade = {
      tradeId: "t2",
      strategyName: "momentum_breakout_atr_v1",
      entryPrice: 100,
      stopLoss: 97,
      takeProfit: null,
    };
    const result = enrichPosition(trade, null);
    expect(result.exitCoverage).toBe("partial");
    expect(result.managementStatus).toBe("managed");
  });

  it("returns none coverage when neither stop nor target is present", () => {
    const trade = {
      tradeId: "t3",
      strategyName: "momentum_breakout_atr_v1",
      entryPrice: 100,
      stopLoss: null,
      takeProfit: null,
    };
    const result = enrichPosition(trade, null);
    expect(result.origin).toBe("strategy");
    expect(result.exitCoverage).toBe("none");
  });
});

// ── Broker-sync: journal stop/target present ──────────────────────────────────

describe("broker_sync with journal stop/target", () => {
  it("returns managed when journal has stop and target", () => {
    const trade = {
      tradeId: "bs1",
      strategyName: "broker_sync",
      entryPrice: 200,
      stopLoss: 192,
      takeProfit: 216,
    };
    const result = enrichPosition(trade, { avg_entry_price: "200" });
    expect(result.origin).toBe("broker_sync");
    expect(result.managementStatus).toBe("managed");
    expect(result.riskSource).toBe("journal");
    expect(result.exitCoverage).toBe("full");
    expect(result.stopLoss).toBe(192);
    expect(result.takeProfit).toBe(216);
  });
});

// ── Broker-sync: ATR-derived ───────────────────────────────────────────────────

describe("broker_sync with ATR available", () => {
  it("derives stop/target from ATR when no journal risk", () => {
    const trade = {
      tradeId: "bs2",
      strategyName: "broker_sync",
      entryPrice: 100,
      stopLoss: null,
      takeProfit: null,
      metrics: { atr: 2 },
    };
    const result = enrichPosition(trade, { avg_entry_price: "100" });
    expect(result.origin).toBe("broker_sync");
    expect(result.managementStatus).toBe("derived");
    expect(result.riskSource).toBe("derived");
    expect(result.exitCoverage).toBe("full");
    // stop = 100 - 1.5 * 2 = 97
    expect(result.stopLoss).toBe(97);
    // riskPerUnit = 3; target = 100 + 2*3 = 106
    expect(result.takeProfit).toBe(106);
    expect(result.riskPerUnit).toBe(3);
  });
});

// ── Broker-sync: fixed-pct fallback ──────────────────────────────────────────

describe("broker_sync with no ATR — fixed % fallback", () => {
  it("derives stop from fixed % when ATR unavailable", () => {
    const trade = {
      tradeId: "bs3",
      strategyName: "broker_sync",
      entryPrice: 100,
      stopLoss: null,
      takeProfit: null,
      metrics: {},
    };
    const result = enrichPosition(trade, { avg_entry_price: "100" });
    expect(result.managementStatus).toBe("derived");
    // stop = 100 * (1 - 0.02) = 98
    expect(result.stopLoss).toBe(98);
    // riskPerUnit = 2; target = 100 + 2*2 = 104
    expect(result.takeProfit).toBe(104);
    expect(result.riskPerUnit).toBe(2);
  });
});

// ── Broker-sync: orphaned / no entry price ────────────────────────────────────

describe("broker_sync with no journal and no entry price", () => {
  it("returns unmanaged when no entry price is available", () => {
    const result = enrichPosition(null, { avg_entry_price: null });
    expect(result.origin).toBe("broker_sync");
    expect(result.managementStatus).toBe("unmanaged");
    expect(result.riskSource).toBe("none");
    expect(result.exitCoverage).toBe("none");
    expect(result.stopLoss).toBeNull();
    expect(result.takeProfit).toBeNull();
  });
});

// ── Entry price fallback from broker position ─────────────────────────────────

describe("entry price fallback from broker position", () => {
  it("uses broker avg_entry_price when trade has no entryPrice and has ATR", () => {
    const trade = {
      tradeId: "bs4",
      strategyName: "broker_sync",
      entryPrice: null,
      stopLoss: null,
      takeProfit: null,
      metrics: { atr: 1 },
    };
    const result = enrichPosition(trade, { avg_entry_price: "50" });
    expect(result.managementStatus).toBe("derived");
    // stop = 50 - 1.5*1 = 48.5
    expect(result.stopLoss).toBe(48.5);
  });
});
