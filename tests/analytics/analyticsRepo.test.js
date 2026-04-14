import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import Decision from "../../src/models/Decision.js";
import {
  getRejectionStats,
  getShortlistConversionStats,
  getScoreDistribution,
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
