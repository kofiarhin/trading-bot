import { beforeAll, afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

import {
  validateTradeRecord,
  createPendingTrade,
  markTradeOpen,
  markTradeClosed,
  markTradeCanceled,
  syncBrokerPositionsToJournal,
} from "../../src/journal/journalUtils.js";
import {
  getOpenTrades,
  findOpenTradeByTradeId,
  findOpenTradeBySymbol,
} from "../../src/journal/openTradesStore.js";
import { getClosedTrades } from "../../src/journal/closedTradesStore.js";
import { getTradeEvents } from "../../src/journal/tradeEventsStore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRADES_DIR = resolve(__dirname, "../../storage/trades");
const openPath = resolve(TRADES_DIR, "open.json");
const closedPath = resolve(TRADES_DIR, "closed.json");
const eventsPath = resolve(TRADES_DIR, "events.json");

function resetFile(path) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "[]", "utf-8");
}

function readFile(path) {
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf-8"));
}

// Save original file contents and restore after tests
let origOpen, origClosed, origEvents;
let openExisted, closedExisted, eventsExisted;

const validTradeInput = {
  symbol: "BTC/USD",
  assetClass: "crypto",
  side: "long",
  strategyName: "momentum_breakout_atr_v1",
  entryPrice: 72000,
  stopLoss: 71500,
  takeProfit: 73000,
  quantity: 0.05,
  riskAmount: 25,
  riskPerUnit: 500,
  timeframe: "15m",
  decisionTimestamp: "2026-04-09T22:00:00.000Z",
  entryReason: "breakout confirmed",
  metrics: { atr: 233.67, volumeRatio: 1.67 },
};

describe("journalUtils", () => {
  beforeAll(() => {
    openExisted = existsSync(openPath);
    closedExisted = existsSync(closedPath);
    eventsExisted = existsSync(eventsPath);
    origOpen = openExisted ? readFileSync(openPath, "utf-8") : null;
    origClosed = closedExisted ? readFileSync(closedPath, "utf-8") : null;
    origEvents = eventsExisted ? readFileSync(eventsPath, "utf-8") : null;
  });

  beforeEach(() => {
    resetFile(openPath);
    resetFile(closedPath);
    resetFile(eventsPath);
  });

  afterAll(() => {
    if (openExisted) writeFileSync(openPath, origOpen, "utf-8");
    else if (existsSync(openPath)) unlinkSync(openPath);

    if (closedExisted) writeFileSync(closedPath, origClosed, "utf-8");
    else if (existsSync(closedPath)) unlinkSync(closedPath);

    if (eventsExisted) writeFileSync(eventsPath, origEvents, "utf-8");
    else if (existsSync(eventsPath)) unlinkSync(eventsPath);
  });

  // ---------------------------------------------------------------------------
  // validateTradeRecord
  // ---------------------------------------------------------------------------

  describe("validateTradeRecord", () => {
    it("passes for a valid long trade record", () => {
      const { valid, errors } = validateTradeRecord({
        tradeId: "test-uuid",
        symbol: "BTC/USD",
        assetClass: "crypto",
        side: "long",
        strategyName: "momentum_breakout_atr_v1",
        entryPrice: 72000,
        stopLoss: 71500,
        takeProfit: 73000,
        quantity: 0.05,
        plannedRiskAmount: 25,
        decisionTimestamp: "2026-04-09T22:00:00.000Z",
      });
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
    });

    it("fails when required fields are missing", () => {
      const { valid, errors } = validateTradeRecord({
        symbol: "BTC/USD",
        // missing tradeId, assetClass, strategyName, entryPrice, etc.
      });
      expect(valid).toBe(false);
      expect(errors.length).toBeGreaterThan(0);
    });

    it("fails when stop is not below entry for long", () => {
      const { valid, errors } = validateTradeRecord({
        tradeId: "test-uuid",
        symbol: "BTC/USD",
        assetClass: "crypto",
        side: "long",
        strategyName: "test",
        entryPrice: 72000,
        stopLoss: 73000, // wrong — above entry
        takeProfit: 74000,
        quantity: 0.05,
        plannedRiskAmount: 25,
        decisionTimestamp: "2026-04-09T22:00:00.000Z",
      });
      expect(valid).toBe(false);
      expect(errors.some((e) => e.includes("stop"))).toBe(true);
    });

    it("fails when target is not above entry for long", () => {
      const { valid, errors } = validateTradeRecord({
        tradeId: "test-uuid",
        symbol: "BTC/USD",
        assetClass: "crypto",
        side: "long",
        strategyName: "test",
        entryPrice: 72000,
        stopLoss: 71000,
        takeProfit: 71500, // wrong — below entry
        quantity: 0.05,
        plannedRiskAmount: 25,
        decisionTimestamp: "2026-04-09T22:00:00.000Z",
      });
      expect(valid).toBe(false);
      expect(errors.some((e) => e.includes("target"))).toBe(true);
    });

    it("fails when qty is zero or negative", () => {
      const { valid, errors } = validateTradeRecord({
        tradeId: "test-uuid",
        symbol: "BTC/USD",
        assetClass: "crypto",
        side: "long",
        strategyName: "test",
        entryPrice: 72000,
        stopLoss: 71500,
        takeProfit: 73000,
        quantity: 0, // invalid
        plannedRiskAmount: 25,
        decisionTimestamp: "2026-04-09T22:00:00.000Z",
      });
      expect(valid).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // createPendingTrade
  // ---------------------------------------------------------------------------

  describe("createPendingTrade", () => {
    it("creates a pending trade with a UUID and saves to open store", () => {
      const trade = createPendingTrade(validTradeInput);

      expect(trade.tradeId).toBeTruthy();
      expect(trade.status).toBe("pending");
      expect(trade.symbol).toBe("BTC/USD");
      expect(trade.strategyName).toBe("momentum_breakout_atr_v1");
      expect(trade.openedAt).toBeNull();

      const stored = findOpenTradeByTradeId(trade.tradeId);
      expect(stored).not.toBeNull();
      expect(stored.tradeId).toBe(trade.tradeId);
    });

    it("persists required fields", () => {
      const trade = createPendingTrade(validTradeInput);
      expect(trade.entryPrice).toBe(72000);
      expect(trade.stopLoss).toBe(71500);
      expect(trade.takeProfit).toBe(73000);
      expect(trade.quantity).toBe(0.05);
      expect(trade.entryReason).toBe("breakout confirmed");
      expect(trade.metrics).toEqual({ atr: 233.67, volumeRatio: 1.67 });
    });

    it("appends a decision_approved event", () => {
      const trade = createPendingTrade(validTradeInput);
      const events = getTradeEvents();
      const evt = events.find((e) => e.tradeId === trade.tradeId && e.type === "decision_approved");
      expect(evt).toBeTruthy();
    });

    it("throws when required fields are missing", () => {
      expect(() =>
        createPendingTrade({ symbol: "BTC/USD" }) // missing most fields
      ).toThrow();
    });

    it("initializes missing files as empty arrays", () => {
      // Files are reset in beforeEach — this verifies they are created on first write
      createPendingTrade(validTradeInput);
      expect(existsSync(openPath)).toBe(true);
      const stored = readFile(openPath);
      expect(Array.isArray(stored)).toBe(true);
      expect(stored.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // markTradeOpen
  // ---------------------------------------------------------------------------

  describe("markTradeOpen", () => {
    it("transitions pending to open with fill data", () => {
      const trade = createPendingTrade(validTradeInput);
      const opened = markTradeOpen(trade.tradeId, {
        entryPrice: 72100,
        brokerOrderId: "alpaca-order-abc",
      });

      expect(opened.status).toBe("open");
      expect(opened.entryPrice).toBe(72100);
      expect(opened.brokerOrderId).toBe("alpaca-order-abc");
      expect(opened.openedAt).toBeTruthy();
    });

    it("appends a trade_opened event", () => {
      const trade = createPendingTrade(validTradeInput);
      markTradeOpen(trade.tradeId, { brokerOrderId: "order-1" });

      const events = getTradeEvents();
      const evt = events.find((e) => e.tradeId === trade.tradeId && e.type === "trade_opened");
      expect(evt).toBeTruthy();
    });

    it("throws when tradeId is not found", () => {
      expect(() => markTradeOpen("nonexistent-uuid", {})).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // markTradeClosed
  // ---------------------------------------------------------------------------

  describe("markTradeClosed", () => {
    it("moves trade from open to closed store", () => {
      const trade = createPendingTrade(validTradeInput);
      markTradeOpen(trade.tradeId, { brokerOrderId: "order-1" });

      markTradeClosed(trade.tradeId, {
        exitReason: "target_hit",
        exitPrice: 73000,
      });

      expect(findOpenTradeByTradeId(trade.tradeId)).toBeNull();
      const closed = getClosedTrades();
      const closedRecord = closed.find((t) => t.tradeId === trade.tradeId);
      expect(closedRecord).toBeTruthy();
      expect(closedRecord.status).toBe("closed");
      expect(closedRecord.exitReason).toBe("target_hit");
    });

    it("calculates realizedPnl when not provided", () => {
      const trade = createPendingTrade(validTradeInput);
      markTradeOpen(trade.tradeId, {});

      const result = markTradeClosed(trade.tradeId, {
        exitReason: "target_hit",
        exitPrice: 73000,
      });

      // (73000 - 72000) * 0.05 = 50
      expect(result.realizedPnl).toBeCloseTo(50, 4);
    });

    it("appends a trade_closed event", () => {
      const trade = createPendingTrade(validTradeInput);
      markTradeOpen(trade.tradeId, {});
      markTradeClosed(trade.tradeId, { exitReason: "stop_hit", exitPrice: 71500 });

      const events = getTradeEvents();
      const evt = events.find((e) => e.tradeId === trade.tradeId && e.type === "trade_closed");
      expect(evt).toBeTruthy();
    });

    it("normalizes unknown exit reasons to 'unknown'", () => {
      const trade = createPendingTrade(validTradeInput);
      markTradeOpen(trade.tradeId, {});
      const result = markTradeClosed(trade.tradeId, {
        exitReason: "something_weird",
        exitPrice: 72000,
      });

      expect(result.exitReason).toBe("unknown");
    });

    it("throws when tradeId is not found in open store", () => {
      expect(() =>
        markTradeClosed("nonexistent-uuid", { exitReason: "stop_hit", exitPrice: 71500 })
      ).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // markTradeCanceled
  // ---------------------------------------------------------------------------

  describe("markTradeCanceled", () => {
    it("marks a pending trade as canceled", () => {
      const trade = createPendingTrade(validTradeInput);
      markTradeCanceled(trade.tradeId, "order submission failed");

      const stored = findOpenTradeByTradeId(trade.tradeId);
      expect(stored?.status).toBe("canceled");
    });

    it("does not throw when tradeId is not found", () => {
      expect(() => markTradeCanceled("unknown-id")).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // syncBrokerPositionsToJournal
  // ---------------------------------------------------------------------------

  describe("syncBrokerPositionsToJournal", () => {
    it("closes journal open trades that have no matching broker position", () => {
      const trade = createPendingTrade(validTradeInput);
      markTradeOpen(trade.tradeId, { brokerOrderId: "order-1" });

      // No broker positions — should sync-close the journal trade
      const { synced } = syncBrokerPositionsToJournal([]);

      expect(synced.length).toBeGreaterThan(0);
      expect(synced[0].action).toBe("broker_sync_close");
      expect(findOpenTradeByTradeId(trade.tradeId)).toBeNull();

      const closed = getClosedTrades();
      const closedRecord = closed.find((t) => t.tradeId === trade.tradeId);
      expect(closedRecord).toBeTruthy();
      expect(closedRecord.exitReason).toBe("broker_sync_close");
    });

    it("does not close trades whose symbol matches a broker position", () => {
      const trade = createPendingTrade(validTradeInput);
      markTradeOpen(trade.tradeId, { brokerOrderId: "order-1" });

      syncBrokerPositionsToJournal([{ symbol: "BTCUSD" }]);

      expect(findOpenTradeByTradeId(trade.tradeId)).not.toBeNull();
    });

    it("skips pending and canceled trades during sync", () => {
      const trade = createPendingTrade(validTradeInput);
      // Leave as pending — should not be sync-closed

      const { synced } = syncBrokerPositionsToJournal([]);
      expect(synced.length).toBe(0);
      expect(findOpenTradeByTradeId(trade.tradeId)).not.toBeNull();
    });
  });
});
