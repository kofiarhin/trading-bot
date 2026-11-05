import express from "express";
import { describe, expect, it, jest } from "@jest/globals";
import request from "supertest";

const getOpenTrades = jest.fn();
jest.unstable_mockModule("../../src/journal/tradeJournal.js", () => ({ getOpenTrades }));

const { default: safetyRoutes, collectSafetyAlerts } = await import("../../src/server/routes/safety.js");

const app = express();
app.use("/api/safety", safetyRoutes);

describe("collectSafetyAlerts", () => {
  it("flags unfilled stops, failing exits, pending exits and unverified entries", () => {
    const alerts = collectSafetyAlerts([
      { tradeId: "a", symbol: "ETH/USD", status: "open", protection: { status: "unfilled", owner: "bot", unfilledSince: "t0" } },
      { tradeId: "b", symbol: "AAPL", status: "open", protection: { status: "active" }, exitAttempts: 3, lastExitError: "boom" },
      { tradeId: "c", symbol: "MSFT", status: "closing", protection: { status: "active" }, closingAt: "t1" },
      { tradeId: "d", symbol: "SOLUSD", status: "open", entryPriceSource: "unverified", protection: { status: "active" } },
      { tradeId: "e", symbol: "NVDA", status: "pending" },
    ]);
    expect(alerts.map((a) => [a.tradeId, a.type, a.severity])).toEqual([
      ["a", "protection_unfilled", "critical"],
      ["b", "exit_failing", "critical"],
      ["c", "exit_pending", "warning"],
      ["d", "entry_unverified", "warning"],
    ]);
    expect(alerts[0].since).toBe("t0");
  });
});

describe("GET /api/safety", () => {
  it("is ok when every open trade is actively protected", async () => {
    getOpenTrades.mockResolvedValue([{ tradeId: "sol", symbol: "SOLUSD", status: "open", protection: { status: "active", owner: "external" } }]);
    const res = await request(app).get("/api/safety");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, alerts: [] });
  });

  it("is not ok when a critical alert exists", async () => {
    getOpenTrades.mockResolvedValue([{ tradeId: "x", symbol: "ETH/USD", status: "open", protection: { status: "missing" } }]);
    const res = await request(app).get("/api/safety");
    expect(res.body.ok).toBe(false);
    expect(res.body.alerts[0].type).toBe("protection_missing");
  });
});
