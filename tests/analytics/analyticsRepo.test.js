import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import Decision from "../../src/models/Decision.js";
import {
  getRejectionStats,
  getShortlistConversionStats,
  getScoreDistribution,
  getCandidatesForCycle,
  buildCycleFunnel,
} from "../../src/repositories/analyticsRepo.mongo.js";

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Decision.deleteMany({});
});

function iso(daysAgo = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString();
}

function makeDecision(overrides = {}) {
  return {
    timestamp: iso(0),
    date: new Date().toISOString().slice(0, 10),
    symbol: "TEST",
    approved: false,
    ...overrides,
  };
}

describe("getRejectionStats byStage", () => {
  it("correctly counts pre_filter, strategy, ranked_out, risk_guard rejections", async () => {
    await Decision.insertMany([
      makeDecision({ rejectStage: "pre_filter", reason: "atr_too_low" }),
      makeDecision({ rejectStage: "pre_filter", reason: "no_breakout" }),
      makeDecision({ rejectStage: "strategy", reason: "weak_risk_reward" }),
      makeDecision({ reason: "ranked_out", rejectStage: "ranked_out" }),
      makeDecision({ reason: "duplicate_position_guard" }),
    ]);

    const stats = await getRejectionStats(7);
    expect(stats.byStage.pre_filter).toBe(2);
    expect(stats.byStage.strategy).toBe(1);
    expect(stats.byStage.ranked_out).toBe(1);
    expect(stats.byStage.risk_guard).toBe(1);
  });
});

describe("getShortlistConversionStats", () => {
  it("calculates rates correctly from seeded data", async () => {
    await Decision.insertMany([
      // Pre-filtered (3)
      makeDecision({ rejectStage: "pre_filter", reason: "atr_too_low" }),
      makeDecision({ rejectStage: "pre_filter", reason: "no_breakout" }),
      makeDecision({ rejectStage: "pre_filter", reason: "weak_volume" }),
      // Ranked out (2)
      makeDecision({ rejectStage: "ranked_out", reason: "ranked_out", shortlisted: false }),
      makeDecision({ rejectStage: "ranked_out", reason: "ranked_out", shortlisted: false }),
      // Shortlisted, strategy approved, no blockers (1)
      makeDecision({ approved: true, shortlisted: true, blockers: [], setupScore: 80 }),
      // Shortlisted, strategy rejected (1)
      makeDecision({ approved: false, shortlisted: true, rejectStage: "strategy", reason: "weak_risk_reward" }),
    ]);

    const stats = await getShortlistConversionStats(7);
    expect(stats.totalScanned).toBe(7);
    expect(stats.preFilterPassed).toBe(4); // 7 - 3 pre-filtered
    expect(stats.placed).toBe(1);
    expect(stats.preFilterRate).toBeCloseTo(4 / 7, 2);
  });
});

describe("getCandidatesForCycle", () => {
  const CYCLE_A = "cycle-aaa-111";
  const CYCLE_B = "cycle-bbb-222";

  function makeFullDecision(overrides = {}) {
    return {
      timestamp: iso(0),
      date: new Date().toISOString().slice(0, 10),
      symbol: overrides.symbol ?? "TEST",
      approved: false,
      cycleId: CYCLE_A,
      ...overrides,
    };
  }

  it("returns all pipeline stages for the given cycleId", async () => {
    await Decision.insertMany([
      // pre_filter rejection
      makeFullDecision({ symbol: "AAPL", rejectStage: "pre_filter", stage: "pre_filter", shortlisted: false, approved: false }),
      // ranked_out
      makeFullDecision({ symbol: "MSFT", rejectStage: "ranked_out", reason: "ranked_out", shortlisted: false, approved: false, setupScore: 60, rank: 2 }),
      // strategy rejected (shortlisted but not approved)
      makeFullDecision({ symbol: "TSLA", rejectStage: "strategy", stage: "strategy", shortlisted: true, approved: false, setupScore: 70, rank: 1 }),
      // approved (shortlisted and approved)
      makeFullDecision({ symbol: "NVDA", stage: "strategy", shortlisted: true, approved: true, setupScore: 85, rank: 1 }),
      // different cycle — must NOT appear
      makeFullDecision({ symbol: "AMD", cycleId: CYCLE_B, approved: true }),
    ]);

    const results = await getCandidatesForCycle(CYCLE_A);
    const symbols = results.map((r) => r.symbol);

    // All four CYCLE_A decisions returned, AMD excluded
    expect(symbols).toContain("AAPL");
    expect(symbols).toContain("MSFT");
    expect(symbols).toContain("TSLA");
    expect(symbols).toContain("NVDA");
    expect(symbols).not.toContain("AMD");
    expect(results).toHaveLength(4);
  });

  it("does not filter by approved — includes rejected decisions", async () => {
    await Decision.insertMany([
      makeFullDecision({ symbol: "AAPL", approved: false, rejectStage: "pre_filter" }),
      makeFullDecision({ symbol: "MSFT", approved: true, shortlisted: true }),
    ]);

    const results = await getCandidatesForCycle(CYCLE_A);
    expect(results).toHaveLength(2);
    expect(results.some((r) => r.symbol === "AAPL" && r.approved === false)).toBe(true);
    expect(results.some((r) => r.symbol === "MSFT" && r.approved === true)).toBe(true);
  });

  it("uses persisted rank for sort order", async () => {
    await Decision.insertMany([
      makeFullDecision({ symbol: "C", rank: 3, setupScore: 90 }),
      makeFullDecision({ symbol: "A", rank: 1, setupScore: 50 }),
      makeFullDecision({ symbol: "B", rank: 2, setupScore: 70 }),
    ]);

    const results = await getCandidatesForCycle(CYCLE_A);
    expect(results[0].symbol).toBe("A");
    expect(results[1].symbol).toBe("B");
    expect(results[2].symbol).toBe("C");
  });

  it("falls back to the most recent cycle when no cycleId is given", async () => {
    const older = new Date();
    older.setUTCMinutes(older.getUTCMinutes() - 30);
    const newer = new Date();

    await Decision.insertMany([
      makeFullDecision({ symbol: "OLD", cycleId: CYCLE_A, timestamp: older.toISOString() }),
      makeFullDecision({ symbol: "NEW", cycleId: CYCLE_B, timestamp: newer.toISOString() }),
    ]);

    const results = await getCandidatesForCycle();
    expect(results).toHaveLength(1);
    expect(results[0].symbol).toBe("NEW");
  });

  it("does not fall back to latest/date when explicit cycleId is provided", async () => {
    const older = new Date();
    older.setUTCMinutes(older.getUTCMinutes() - 60);
    const newer = new Date();

    await Decision.insertMany([
      makeFullDecision({ symbol: "TARGET", cycleId: CYCLE_A, timestamp: older.toISOString() }),
      makeFullDecision({ symbol: "LATEST", cycleId: CYCLE_B, timestamp: newer.toISOString() }),
    ]);

    const results = await getCandidatesForCycle(CYCLE_A);
    expect(results.map((r) => r.symbol)).toEqual(["TARGET"]);
  });

  it("returns empty array when no decisions exist", async () => {
    const results = await getCandidatesForCycle(CYCLE_A);
    expect(results).toEqual([]);
  });
});

describe("getScoreDistribution", () => {
  it("correctly buckets scores and computes mean/median", async () => {
    await Decision.insertMany([
      makeDecision({ setupScore: 10 }),  // 0-24
      makeDecision({ setupScore: 20 }),  // 0-24
      makeDecision({ setupScore: 40 }),  // 25-49
      makeDecision({ setupScore: 60 }),  // 50-74
      makeDecision({ setupScore: 80 }),  // 75-100
      makeDecision({ setupScore: 90 }),  // 75-100
    ]);

    const dist = await getScoreDistribution(7);
    expect(dist.buckets[0].count).toBe(2);  // 0-24
    expect(dist.buckets[1].count).toBe(1);  // 25-49
    expect(dist.buckets[2].count).toBe(1);  // 50-74
    expect(dist.buckets[3].count).toBe(2);  // 75-100
    expect(dist.mean).toBeCloseTo((10 + 20 + 40 + 60 + 80 + 90) / 6, 1);
    expect(dist.median).toBeCloseTo(50, 0); // median of sorted [10,20,40,60,80,90]
  });

  it("returns zero stats when no decisions with scores exist", async () => {
    const dist = await getScoreDistribution(7);
    expect(dist.mean).toBe(0);
    expect(dist.median).toBe(0);
    expect(dist.buckets.every((b) => b.count === 0)).toBe(true);
  });
});


describe("buildCycleFunnel", () => {
  it("builds truthful stage totals for one cycle", () => {
    const totals = buildCycleFunnel([
      { symbol: 'A', stage: 'pre_filter', rejectStage: 'pre_filter', approved: false, shortlisted: false },
      { symbol: 'B', stage: 'scored', rankedOut: true, approved: false, shortlisted: false },
      { symbol: 'C', stage: 'strategy', rejectStage: 'strategy', approved: false, shortlisted: true },
      { symbol: 'D', stage: 'strategy', approved: true, shortlisted: true, blockers: ['max_positions_guard'] },
      { symbol: 'E', stage: 'strategy', approved: true, shortlisted: true, blockers: [] },
    ]);

    expect(totals).toEqual({
      scanned: 5,
      prefilterRejected: 1,
      scored: 4,
      shortlisted: 3,
      rankedOut: 1,
      strategyRejected: 1,
      riskBlocked: 1,
      approved: 2,
      placed: 1,
    });
  });
});
