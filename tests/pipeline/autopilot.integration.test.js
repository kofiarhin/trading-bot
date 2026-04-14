/**
 * Autopilot pipeline integration test.
 *
 * Uses mongodb-memory-server for in-process MongoDB.
 * Mocks Alpaca API calls so no real network requests are made.
 * Validates the tiered pre-filter → score → shortlist → strategy pipeline.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import Decision from "../../src/models/Decision.js";
import CycleRuntime from "../../src/models/CycleRuntime.js";

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri();
  process.env.ALPACA_API_KEY = "test";
  process.env.ALPACA_API_SECRET = "test";
  process.env.ALPACA_BASE_URL = "https://paper-api.alpaca.markets";
  process.env.AUTOPILOT_SYMBOLS = "AAPL,MSFT";
  process.env.MAX_CANDIDATES_PER_CYCLE = "1";
  process.env.ENABLE_STOCKS = "true";
  process.env.ENABLE_CRYPTO = "false";
  process.env.SKIP_MARKET_HOURS = "true";
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Decision.deleteMany({});
  await CycleRuntime.deleteMany({});
});

// Build a bar array where the last bar breaks out above the highest high of the lookback window.
function makeBreakoutBars(count = 30, baseClose = 100) {
  const range = 0.5;
  const bars = [];
  for (let i = 0; i < count; i++) {
    const c = baseClose + i * 0.05;
    bars.push({ t: new Date().toISOString(), o: c - 0.1, h: c + range, l: c - range, c, v: 2_000_000 });
  }
  const prevHigh = Math.max(...bars.slice(-21, -1).map((b) => b.h));
  const lastClose = prevHigh * 1.008;
  bars[bars.length - 1] = { ...bars[bars.length - 1], c: lastClose, h: lastClose + 0.1, l: lastClose - 0.1, v: 3_000_000 };
  return bars;
}

function makeFlatBars(count = 30, baseClose = 100) {
  // Flat bars — price stays below highest high → no_breakout
  return Array.from({ length: count }, (_, i) => ({
    t: new Date().toISOString(),
    o: baseClose - 0.05,
    h: baseClose + 0.05,
    l: baseClose - 0.05,
    c: baseClose - 0.1, // below the high
    v: 500_000,
  }));
}

describe("runAutopilotCycle (mocked Alpaca)", () => {
  it("records pre-filter rejections and shortlisted decisions with cycleId", async () => {
    // Mock all external dependencies
    jest.unstable_mockModule("../../src/lib/alpaca.js", () => ({
      getAccount: jest.fn().mockResolvedValue({ equity: 100000 }),
      getBarsForSymbols: jest.fn().mockResolvedValue({
        AAPL: makeBreakoutBars(), // should pass pre-filter
        MSFT: makeFlatBars(),     // should fail pre-filter (no_breakout)
      }),
      getOrders: jest.fn().mockResolvedValue([]),
      getPositions: jest.fn().mockResolvedValue([]),
      isDryRunEnabled: jest.fn().mockReturnValue(true),
    }));

    jest.unstable_mockModule("../../src/journal/tradeJournal.js", () => ({
      getOpenTrades: jest.fn().mockResolvedValue([]),
      syncTradesWithBroker: jest.fn().mockResolvedValue(undefined),
      getClosedTrades: jest.fn().mockResolvedValue([]),
    }));

    jest.unstable_mockModule("../../src/positions/positionMonitor.js", () => ({
      checkOpenTradesForExit: jest.fn().mockResolvedValue([]),
    }));

    jest.unstable_mockModule("../../src/risk/riskState.js", () => ({
      loadRiskState: jest.fn().mockResolvedValue({ dailyRealizedLoss: 0, halted: false }),
    }));

    jest.unstable_mockModule("../../src/execution/orderManager.js", () => ({
      placeOrder: jest.fn().mockResolvedValue({ placed: false, message: "dry-run", dryRun: true }),
      closeTrade: jest.fn().mockResolvedValue(undefined),
    }));

    jest.unstable_mockModule("../../src/risk/portfolioRisk.js", () => ({
      checkPortfolioRisk: jest.fn().mockReturnValue({ allowed: [], blocked: [] }),
    }));

    const { runAutopilotCycle } = await import("../../src/autopilot.js");
    const result = await runAutopilotCycle({ dryRun: true });

    expect(result.status).toBe("completed");
    expect(result.cycleId).toBeTruthy();

    const decisions = await Decision.find({}).lean();
    expect(decisions.length).toBeGreaterThan(0);

    // Every decision must have a cycleId
    for (const d of decisions) {
      expect(d.cycleId).toBe(result.cycleId);
    }

    // MSFT should be pre-filtered (flat bars → no_breakout)
    const msftDecision = decisions.find((d) => d.symbol === "MSFT");
    expect(msftDecision).toBeTruthy();
    expect(msftDecision.rejectStage).toBe("pre_filter");
    expect(msftDecision.approved).toBe(false);
    expect(msftDecision.shortlisted).toBe(false);

    // AAPL should be shortlisted
    const aaplDecision = decisions.find((d) => d.symbol === "AAPL");
    expect(aaplDecision).toBeTruthy();
    expect(aaplDecision.shortlisted).toBe(true);
  });
});
