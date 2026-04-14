import express from "express";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import request from "supertest";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeDecision({ symbol = "AAPL", approved = true, assetClass = "us_equity", timestamp = "2026-04-13T10:00:00.000Z" } = {}) {
  return {
    timestamp,
    symbol,
    assetClass,
    approved,
    reason: approved ? "breakout confirmed" : "volume too low",
    strategyName: "breakout",
    blockers: [],
    metrics: { closePrice: 180, breakoutLevel: 178, atr: 1.5, volumeRatio: 1.2, distanceToBreakoutPct: 0.5 },
    entryPrice: 178,
    stopLoss: 174,
    takeProfit: 186,
    quantity: 5,
    riskAmount: 20,
    riskReward: 2,
  };
}

function makeActivity({ type = "cycle_complete", label = "Cycle complete — scanned 20", timestamp = "2026-04-13T10:00:00.000Z" } = {}) {
  return { type, label, timestamp };
}

// ─── App builder ──────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

async function buildApp({ decisions = [], activityEvents = [] } = {}) {
  const londonDate = "2026-04-13";

  jest.unstable_mockModule("../../src/journal/decisionLogger.js", () => ({
    loadDecisionLog: jest.fn(async () => ({
      records: decisions,
      date: londonDate,
      requestedDate: londonDate,
      isFallback: false,
    })),
  }));

  jest.unstable_mockModule("../../src/utils/time.js", () => ({
    londonDateString: jest.fn(() => londonDate),
    resolveSession: jest.fn(() => ({ session: "us", allowCrypto: true, allowStocks: true })),
  }));

  jest.unstable_mockModule("../../src/repositories/cycleRepo.mongo.js", () => ({
    getCyclesForDate: jest.fn(async () => []),
  }));

  jest.unstable_mockModule("../../src/repositories/cycleRuntimeRepo.mongo.js", () => ({
    getCycleRuntime: jest.fn(async () => ({ status: "idle", stage: null, progressPct: 0, metrics: {} })),
  }));

  jest.unstable_mockModule("../../src/repositories/tradeJournalRepo.mongo.js", () => ({
    getTradeEventsForDate: jest.fn(async () => []),
    getClosedTradesForDate: jest.fn(async () => []),
    appendTradeEvent: jest.fn(async () => undefined),
  }));

  jest.unstable_mockModule("../../src/journal/tradeJournal.js", () => ({
    getOpenTrades: jest.fn(async () => []),
    getClosedTrades: jest.fn(async () => []),
  }));

  jest.unstable_mockModule("../../src/risk/riskState.js", () => ({
    loadRiskState: jest.fn(async () => ({ dailyRealizedLoss: 0 })),
  }));

  jest.unstable_mockModule("../../src/execution/alpacaTrading.js", () => ({
    getAccount: jest.fn(async () => ({ equity: "10000", portfolio_value: "10000" })),
    getOpenPositions: jest.fn(async () => []),
  }));

  jest.unstable_mockModule("../../src/config/env.js", () => ({
    config: {
      trading: { runMode: "paper", dryRun: false, trailingAtrMultiplier: 1.5 },
      brokerSync: { enableDerivedRisk: false, stopPct: 0.02, targetRMultiple: 2 },
    },
  }));

  jest.unstable_mockModule("../../src/utils/logger.js", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  }));

  jest.unstable_mockModule("../../src/utils/symbolNorm.js", () => ({
    normalizeSymbol: jest.fn((s) => s),
  }));

  // Override buildActivityEvents indirectly by providing empty source data.
  // The activity events themselves come from the mocked data sources above.
  // For activity tests we pre-seed decisions as activityEvents via the decisions mock.
  // Since buildActivityEvents builds from cycles/journal/etc., we mock those to return
  // data that produces the desired events. For simplicity we test with empty sources
  // and rely on the decisions mock for decision-type events.
  _ = activityEvents; // suppress unused warning — see note above

  const { default: dashboardRoutes } = await import("../../src/server/routes/dashboard.js");
  const app = express();
  app.use("/api/dashboard", dashboardRoutes);
  return app;
}

// ─── /api/dashboard/decisions ─────────────────────────────────────────────────

describe("GET /api/dashboard/decisions — pagination", () => {
  it("returns paginated shape with defaults when no decisions exist", async () => {
    const app = await buildApp({ decisions: [] });
    const res = await request(app).get("/api/dashboard/decisions");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      items: [],
      pagination: { page: 1, limit: 25, total: 0, pages: 0, hasPrevPage: false, hasNextPage: false },
      summary: { approved: 0, rejected: 0 },
    });
  });

  it("paginates correctly with page and limit params", async () => {
    const decisions = Array.from({ length: 10 }, (_, i) =>
      makeDecision({ symbol: `SYM${i}`, approved: i % 2 === 0 })
    );
    const app = await buildApp({ decisions });
    const res = await request(app).get("/api/dashboard/decisions?page=2&limit=3");

    expect(res.status).toBe(200);
    expect(res.body.pagination.page).toBe(2);
    expect(res.body.pagination.limit).toBe(3);
    expect(res.body.pagination.total).toBe(10);
    expect(res.body.pagination.pages).toBe(4);
    expect(res.body.items).toHaveLength(3);
    expect(res.body.pagination.hasPrevPage).toBe(true);
    expect(res.body.pagination.hasNextPage).toBe(true);
  });

  it("clamps limit to max 100", async () => {
    const app = await buildApp({ decisions: [] });
    const res = await request(app).get("/api/dashboard/decisions?limit=999");

    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(100);
  });

  it("returns hasPrevPage=false on first page", async () => {
    const app = await buildApp({ decisions: [makeDecision()] });
    const res = await request(app).get("/api/dashboard/decisions?page=1&limit=25");

    expect(res.body.pagination.hasPrevPage).toBe(false);
  });

  it("returns hasNextPage=false on last page", async () => {
    const decisions = Array.from({ length: 3 }, () => makeDecision());
    const app = await buildApp({ decisions });
    const res = await request(app).get("/api/dashboard/decisions?page=1&limit=10");

    expect(res.body.pagination.hasNextPage).toBe(false);
  });

  it("returns newest-first ordering", async () => {
    const decisions = [
      makeDecision({ symbol: "AAPL", timestamp: "2026-04-13T09:00:00.000Z" }),
      makeDecision({ symbol: "MSFT", timestamp: "2026-04-13T11:00:00.000Z" }),
      makeDecision({ symbol: "NVDA", timestamp: "2026-04-13T10:00:00.000Z" }),
    ];
    const app = await buildApp({ decisions });
    const res = await request(app).get("/api/dashboard/decisions?limit=3");

    expect(res.status).toBe(200);
    expect(res.body.items[0].symbol).toBe("MSFT"); // 11:00 is newest
    expect(res.body.items[1].symbol).toBe("NVDA");
    expect(res.body.items[2].symbol).toBe("AAPL");
  });
});

describe("GET /api/dashboard/decisions — filters", () => {
  const decisions = [
    makeDecision({ symbol: "AAPL", approved: true, assetClass: "us_equity" }),
    makeDecision({ symbol: "BTCUSD", approved: false, assetClass: "crypto" }),
    makeDecision({ symbol: "MSFT", approved: true, assetClass: "us_equity" }),
    makeDecision({ symbol: "ETHUSD", approved: false, assetClass: "crypto" }),
  ];

  it("filters by decision=approved", async () => {
    const app = await buildApp({ decisions });
    const res = await request(app).get("/api/dashboard/decisions?decision=approved");

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items.every((d) => d.decision === "Approved")).toBe(true);
    expect(res.body.summary.approved).toBe(2);
    expect(res.body.summary.rejected).toBe(0);
    expect(res.body.filters.decision).toBe("approved");
  });

  it("filters by decision=rejected", async () => {
    const app = await buildApp({ decisions });
    const res = await request(app).get("/api/dashboard/decisions?decision=rejected");

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items.every((d) => d.decision === "Rejected")).toBe(true);
    expect(res.body.summary.rejected).toBe(2);
    expect(res.body.summary.approved).toBe(0);
  });

  it("filters by symbol substring", async () => {
    const app = await buildApp({ decisions });
    const res = await request(app).get("/api/dashboard/decisions?symbol=AAPL");

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].symbol).toBe("AAPL");
  });

  it("filters by assetClass=crypto", async () => {
    const app = await buildApp({ decisions });
    const res = await request(app).get("/api/dashboard/decisions?assetClass=crypto");

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items.every((d) => d.assetClass === "Crypto")).toBe(true);
  });

  it("returns empty filters object when no filters are set", async () => {
    const app = await buildApp({ decisions: [makeDecision()] });
    const res = await request(app).get("/api/dashboard/decisions");

    expect(res.body.filters).toEqual({});
  });

  it("includes only active filters in filters object", async () => {
    const app = await buildApp({ decisions });
    const res = await request(app).get("/api/dashboard/decisions?decision=approved&assetClass=stock");

    expect(res.body.filters).toMatchObject({ decision: "approved", assetClass: "stock" });
    expect(res.body.filters.symbol).toBeUndefined();
  });

  it("normalizes decision field to Approved/Rejected in items", async () => {
    const app = await buildApp({ decisions: [makeDecision({ approved: true })] });
    const res = await request(app).get("/api/dashboard/decisions");

    expect(res.body.items[0].decision).toBe("Approved");
  });
});

// ─── /api/dashboard/activity ──────────────────────────────────────────────────

describe("GET /api/dashboard/activity — pagination", () => {
  it("returns paginated shape with empty items when no activity exists", async () => {
    const app = await buildApp({ decisions: [] });
    const res = await request(app).get("/api/dashboard/activity");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      items: expect.any(Array),
      pagination: expect.objectContaining({
        page: 1,
        limit: 25,
        hasPrevPage: false,
      }),
    });
  });

  it("clamps limit to max 100", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/dashboard/activity?limit=500");

    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(100);
  });

  it("returns empty filters object when no filters set", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/dashboard/activity");

    expect(res.body.filters).toEqual({});
  });

  it("echoes type filter in filters when set", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/dashboard/activity?type=approved");

    expect(res.body.filters.type).toBe("approved");
  });

  it("echoes search filter in filters when set", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/dashboard/activity?search=BTC");

    expect(res.body.filters.search).toBe("BTC");
  });
});
