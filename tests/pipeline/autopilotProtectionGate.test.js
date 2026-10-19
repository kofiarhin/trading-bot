/**
 * Autopilot protection gate — a full mocked cycle where a broker position has
 * no protective stop. An approved candidate must not be placed, and the cycle
 * must record entries_blocked_protection.
 *
 * In-memory MongoDB; every Alpaca call is a mock.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import CycleRun from "../../src/models/CycleRun.js";

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri();
  process.env.ALPACA_API_KEY = "test";
  process.env.ALPACA_API_SECRET = "test";
  process.env.ALPACA_BASE_URL = "https://paper-api.alpaca.markets";
  process.env.AUTOPILOT_SYMBOLS = "AAPL";
  process.env.ENABLE_STOCKS = "true";
  process.env.ENABLE_CRYPTO = "false";
  process.env.SKIP_MARKET_HOURS = "true";
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

function makeBreakoutBars(count = 30, baseClose = 100) {
  const bars = [];
  for (let i = 0; i < count; i++) {
    const c = baseClose + i * 0.05;
    bars.push({ t: new Date().toISOString(), o: c - 0.1, h: c + 0.5, l: c - 0.5, c, v: 2_000_000 });
  }
  const prevHigh = Math.max(...bars.slice(-21, -1).map((b) => b.h));
  const lastClose = prevHigh * 1.008;
  bars[bars.length - 1] = { ...bars[bars.length - 1], c: lastClose, h: lastClose + 0.1, l: lastClose - 0.1, v: 3_000_000 };
  return bars;
}

describe("runAutopilotCycle — protection gate", () => {
  it("places no entries while a position lacks a protective stop", async () => {
    const unprotectedPosition = {
      symbol: "SOLUSD", asset_class: "crypto", qty: 10, qty_available: "10", avg_entry_price: 100, current_price: 101,
    };
    const placeOrder = jest.fn().mockResolvedValue({ placed: true, orderId: "should-not-happen" });

    jest.unstable_mockModule("../../src/lib/alpaca.js", () => ({
      getAccount: jest.fn().mockResolvedValue({ equity: 100000, buying_power: 100000 }),
      getBarsForSymbols: jest.fn().mockResolvedValue({ AAPL: makeBreakoutBars() }),
      getOrders: jest.fn().mockResolvedValue([]),
      getPositions: jest.fn().mockResolvedValue([unprotectedPosition]),
      isDryRunEnabled: jest.fn().mockReturnValue(false),
    }));
    jest.unstable_mockModule("../../src/journal/tradeJournal.js", () => ({
      getOpenTrades: jest.fn().mockResolvedValue([
        { tradeId: "sol", symbol: "SOLUSD", normalizedSymbol: "SOLUSD", strategyName: "broker_sync", status: "open", protection: { status: "missing" } },
      ]),
      syncTradesWithBroker: jest.fn().mockResolvedValue(undefined),
      addOpenTrade: jest.fn().mockResolvedValue(undefined),
      getClosedTrades: jest.fn().mockResolvedValue([]),
    }));
    jest.unstable_mockModule("../../src/positions/positionMonitor.js", () => ({
      checkOpenTradesForExit: jest.fn().mockResolvedValue([]),
    }));
    jest.unstable_mockModule("../../src/risk/riskState.js", () => ({
      loadRiskState: jest.fn().mockResolvedValue({ dailyRealizedLoss: 0, halted: false }),
    }));
    jest.unstable_mockModule("../../src/execution/orderManager.js", () => ({
      placeOrder,
      closeTrade: jest.fn().mockResolvedValue(undefined),
    }));
    // Force the candidate through every other guard so only the gate can stop it.
    jest.unstable_mockModule("../../src/risk/portfolioRisk.js", () => ({
      checkPortfolioRisk: jest.fn(({ candidates }) => ({ allowed: candidates, blocked: [] })),
    }));

    const { runAutopilotCycle } = await import("../../src/autopilot.js");
    const result = await runAutopilotCycle({ dryRun: false });

    expect(result.status).toBe("completed");
    expect(placeOrder).not.toHaveBeenCalled();

    const blocked = await CycleRun.find({ type: "entries_blocked_protection", cycleId: result.cycleId }).lean();
    expect(blocked).toHaveLength(1);
    expect(blocked[0].reasons).toContainEqual({ symbol: "SOLUSD", reason: "protection_missing" });
  });
});
