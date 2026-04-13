// Exit engine integration tests — uses Jest ESM unstable_mockModule pattern
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// With ESM + --experimental-vm-modules, mocks must be declared before dynamic imports

jest.unstable_mockModule("../../src/config/env.js", () => ({
  config: { trading: { runMode: "paper", trailingAtrMultiplier: 1.5, maxHoldBars: 48 } },
}));

jest.unstable_mockModule("../../src/repositories/tradeJournalRepo.mongo.js", () => ({
  upsertOpenTrade: jest.fn().mockResolvedValue({}),
  appendTradeEvent: jest.fn().mockResolvedValue({}),
}));

jest.unstable_mockModule("../../src/execution/alpacaTrading.js", () => ({
  getOpenPositions: jest.fn(),
  closePosition: jest.fn(),
  submitOrder: jest.fn(),
}));

jest.unstable_mockModule("../../src/journal/tradeJournal.js", () => ({
  getOpenTrades: jest.fn(),
  getOpenTradeById: jest.fn(),
  addOpenTrade: jest.fn(),
  removeOpenTrade: jest.fn(),
  addClosedTrade: jest.fn(),
  markTradeCanceled: jest.fn(),
  createPendingTrade: jest.fn(),
  markTradeOpen: jest.fn(),
  syncTradesWithBroker: jest.fn(),
  getClosedTrades: jest.fn(),
  default: {},
}));

// Dynamic imports AFTER mocks are registered
const { getOpenPositions, closePosition } = await import("../../src/execution/alpacaTrading.js");
const { getOpenTradeById, removeOpenTrade, addClosedTrade } = await import("../../src/journal/tradeJournal.js");
const { upsertOpenTrade: mockUpsertOpenTrade, appendTradeEvent: mockAppendTradeEvent } = await import("../../src/repositories/tradeJournalRepo.mongo.js");
const { checkOpenTradesForExit } = await import("../../src/positions/positionMonitor.js");
const { closeTrade } = await import("../../src/execution/orderManager.js");

const makeTrade = (overrides = {}) => ({
  tradeId: "trade-123",
  symbol: "AAPL",
  normalizedSymbol: "AAPL",
  status: "open",
  entryPrice: 200,
  quantity: 10,
  stopLoss: 190,
  takeProfit: 220,
  ...overrides,
});

describe("positionMonitor.checkOpenTradesForExit", () => {
  it("returns stop_loss exit when current price is at or below stop", async () => {
    getOpenPositions.mockResolvedValue([
      { symbol: "AAPL", qty: "10", avg_entry_price: "200", current_price: "185", unrealized_pl: "-150", market_value: "1850" },
    ]);

    const exits = await checkOpenTradesForExit([makeTrade()]);

    expect(exits).toHaveLength(1);
    expect(exits[0].shouldExit).toBe(true);
    expect(exits[0].reason).toBe("stop_loss");
    expect(exits[0].tradeId).toBe("trade-123");
    expect(exits[0].currentPrice).toBe(185);
  });

  it("returns take_profit exit when current price is at or above target", async () => {
    getOpenPositions.mockResolvedValue([
      { symbol: "AAPL", qty: "10", avg_entry_price: "200", current_price: "225", unrealized_pl: "250", market_value: "2250" },
    ]);

    const exits = await checkOpenTradesForExit([makeTrade()]);

    expect(exits).toHaveLength(1);
    expect(exits[0].shouldExit).toBe(true);
    expect(exits[0].reason).toBe("take_profit");
  });

  it("returns no exits when price is between stop and target", async () => {
    // Price 205 is above stop (190) and below target (220) but below the breakeven
    // trigger level (entry 200 + riskPerUnit 10 = 210), so no state mutation occurs.
    getOpenPositions.mockResolvedValue([
      { symbol: "AAPL", qty: "10", avg_entry_price: "200", current_price: "205", unrealized_pl: "50", market_value: "2050" },
    ]);

    const exits = await checkOpenTradesForExit([makeTrade()]);

    expect(exits).toHaveLength(0);
  });

  it("skips pending and canceled trades", async () => {
    getOpenPositions.mockResolvedValue([
      { symbol: "AAPL", qty: "10", avg_entry_price: "200", current_price: "185", unrealized_pl: "-150", market_value: "1850" },
    ]);

    const exits = await checkOpenTradesForExit([
      makeTrade({ status: "pending" }),
      makeTrade({ status: "canceled" }),
    ]);

    expect(exits).toHaveLength(0);
  });

  it("skips trades with no matching broker position", async () => {
    getOpenPositions.mockResolvedValue([]);

    const exits = await checkOpenTradesForExit([makeTrade()]);

    expect(exits).toHaveLength(0);
  });

  it("does NOT exit when takeProfit is 0", async () => {
    // Price 205 is above stop but below the breakeven trigger (entry 200 + risk 10 = 210).
    // isValid(0) is false so takeProfit:0 never fires regardless of price.
    getOpenPositions.mockResolvedValue([
      { symbol: "AAPL", qty: "10", avg_entry_price: "200", current_price: "205", unrealized_pl: "50", market_value: "2050" },
    ]);

    const exits = await checkOpenTradesForExit([makeTrade({ takeProfit: 0 })]);

    expect(exits).toHaveLength(0);
  });

  it("does NOT exit when stopLoss is 0", async () => {
    getOpenPositions.mockResolvedValue([
      { symbol: "AAPL", qty: "10", avg_entry_price: "200", current_price: "185", unrealized_pl: "-150", market_value: "1850" },
    ]);

    const exits = await checkOpenTradesForExit([makeTrade({ stopLoss: 0 })]);

    expect(exits).toHaveLength(0);
  });

  it("does NOT exit when stop and target are both 0 (broker_sync orphan)", async () => {
    getOpenPositions.mockResolvedValue([
      { symbol: "AAPL", qty: "10", avg_entry_price: "200", current_price: "185", unrealized_pl: "-150", market_value: "1850" },
    ]);

    const exits = await checkOpenTradesForExit([makeTrade({ stopLoss: undefined, stop: 0, takeProfit: undefined, target: 0 })]);

    expect(exits).toHaveLength(0);
  });

  it("uses legacy stop/target fields when stopLoss/takeProfit are absent", async () => {
    getOpenPositions.mockResolvedValue([
      { symbol: "AAPL", qty: "10", avg_entry_price: "200", current_price: "185", unrealized_pl: "-150", market_value: "1850" },
    ]);

    const exits = await checkOpenTradesForExit([
      makeTrade({ stopLoss: undefined, takeProfit: undefined, stop: 190, target: 220 }),
    ]);

    expect(exits).toHaveLength(1);
    expect(exits[0].reason).toBe("stop_loss");
  });
});

describe("trailing stop behavior", () => {
  beforeEach(() => {
    mockUpsertOpenTrade.mockReset();
    mockAppendTradeEvent.mockReset();
    mockUpsertOpenTrade.mockResolvedValue({});
    mockAppendTradeEvent.mockResolvedValue({});
  });

  it("triggers breakeven when price reaches entry + riskPerUnit", async () => {
    // entry=200, stop=190 → riskPerUnit=10 → breakeven at price >= 210
    getOpenPositions.mockResolvedValue([
      { symbol: "AAPL", qty: "10", avg_entry_price: "200", current_price: "215", unrealized_pl: "150", market_value: "2150" },
    ]);

    const exits = await checkOpenTradesForExit([makeTrade({ metrics: { atr: 5 } })]);

    expect(exits).toHaveLength(1);
    expect(exits[0].shouldExit).toBe(false);
    expect(exits[0].reason).toBe("breakeven_stop");
    expect(exits[0].updatedTrade.breakevenTriggered).toBe(true);
    // trailingStopPrice = 215 - 1.5 * 5 = 207.5
    expect(exits[0].updatedTrade.trailingStopPrice).toBeCloseTo(207.5);
  });

  it("trails stop upward when price advances beyond the current trailing level", async () => {
    // After breakeven: trailingStop=205, price=215, atr=5 → newStop=207.5 > 205
    getOpenPositions.mockResolvedValue([
      { symbol: "AAPL", qty: "10", avg_entry_price: "200", current_price: "215", unrealized_pl: "150", market_value: "2150" },
    ]);

    const exits = await checkOpenTradesForExit([
      makeTrade({ breakevenTriggered: true, trailingStopPrice: 205, takeProfit: 230, metrics: { atr: 5 } }),
    ]);

    expect(exits).toHaveLength(1);
    expect(exits[0].shouldExit).toBe(false);
    expect(exits[0].reason).toBe("trailing_stop");
    // newTrailingStop = 215 - 1.5 * 5 = 207.5
    expect(exits[0].updatedTrade.trailingStopPrice).toBeCloseTo(207.5);
  });

  it("does not move trailing stop backward when price retreats", async () => {
    // trailingStop=205, price=208, atr=5 → newStop=200.5 < 205 → no update, no exit
    getOpenPositions.mockResolvedValue([
      { symbol: "AAPL", qty: "10", avg_entry_price: "200", current_price: "208", unrealized_pl: "80", market_value: "2080" },
    ]);

    const exits = await checkOpenTradesForExit([
      makeTrade({ breakevenTriggered: true, trailingStopPrice: 205, takeProfit: 230, metrics: { atr: 5 } }),
    ]);

    expect(exits).toHaveLength(0);
    expect(mockAppendTradeEvent).not.toHaveBeenCalled();
  });

  it("does not trail stop when ATR is unavailable", async () => {
    // breakevenTriggered=true but no atr → atr=0 → trailing update branch skipped
    getOpenPositions.mockResolvedValue([
      { symbol: "AAPL", qty: "10", avg_entry_price: "200", current_price: "215", unrealized_pl: "150", market_value: "2150" },
    ]);

    const exits = await checkOpenTradesForExit([
      makeTrade({ breakevenTriggered: true, trailingStopPrice: 205, takeProfit: 230, metrics: {} }),
    ]);

    expect(exits).toHaveLength(0);
    expect(mockAppendTradeEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ reason: "stop_trailed" }),
    );
  });

  it("exits with trailing_stop reason when price falls below trailing stop", async () => {
    // trailingStop=210, price=208 → 208 <= 210 → exit
    getOpenPositions.mockResolvedValue([
      { symbol: "AAPL", qty: "10", avg_entry_price: "200", current_price: "208", unrealized_pl: "80", market_value: "2080" },
    ]);

    const exits = await checkOpenTradesForExit([
      makeTrade({ breakevenTriggered: true, trailingStopPrice: 210, takeProfit: 230, metrics: { atr: 5 } }),
    ]);

    expect(exits).toHaveLength(1);
    expect(exits[0].shouldExit).toBe(true);
    expect(exits[0].reason).toBe("trailing_stop");
    expect(exits[0].currentPrice).toBe(208);
  });

  it("records stop_trailed trade event when trailing stop is ratcheted up", async () => {
    // Verify appendTradeEvent is called with the correct payload when stop trails
    getOpenPositions.mockResolvedValue([
      { symbol: "AAPL", qty: "10", avg_entry_price: "200", current_price: "215", unrealized_pl: "150", market_value: "2150" },
    ]);

    await checkOpenTradesForExit([
      makeTrade({ breakevenTriggered: true, trailingStopPrice: 205, takeProfit: 230, metrics: { atr: 5 } }),
    ]);

    expect(mockAppendTradeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "trade_stop_updated",
        reason: "stop_trailed",
        tradeId: "trade-123",
        symbol: "AAPL",
      }),
    );
  });

  it("preserves existing stop-loss and take-profit behavior with breakeven active", async () => {
    // Even with breakevenTriggered, hard stop still fires if price falls to original stop
    getOpenPositions.mockResolvedValue([
      { symbol: "AAPL", qty: "10", avg_entry_price: "200", current_price: "185", unrealized_pl: "-150", market_value: "1850" },
    ]);

    const exits = await checkOpenTradesForExit([
      makeTrade({ breakevenTriggered: true, trailingStopPrice: 195, metrics: { atr: 5 } }),
    ]);

    expect(exits).toHaveLength(1);
    expect(exits[0].shouldExit).toBe(true);
    expect(exits[0].reason).toBe("stop_loss");
  });
});

describe("orderManager.closeTrade", () => {
  beforeEach(() => {
    delete process.env.DRY_RUN;
    closePosition.mockReset();
    getOpenTradeById.mockReset();
    removeOpenTrade.mockReset();
    addClosedTrade.mockReset();
  });

  it("returns dryRun result without calling broker when DRY_RUN=true", async () => {
    process.env.DRY_RUN = "true";

    const result = await closeTrade({
      tradeId: "trade-123",
      symbol: "AAPL",
      exitPrice: 185,
      reason: "stop_loss",
    });

    expect(result.closed).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(closePosition).not.toHaveBeenCalled();
  });

  it("does not call broker or mutate journal when dryRun param is true", async () => {
    const result = await closeTrade({
      tradeId: "trade-123",
      symbol: "AAPL",
      exitPrice: 185,
      reason: "stop_loss",
      dryRun: true,
    });

    expect(result.closed).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(closePosition).not.toHaveBeenCalled();
    expect(removeOpenTrade).not.toHaveBeenCalled();
    expect(addClosedTrade).not.toHaveBeenCalled();
  });

  it("closes at broker, calculates PnL, removes from open and archives as closed", async () => {
    closePosition.mockResolvedValue({ id: "order-999", status: "filled", filled_avg_price: "188" });
    getOpenTradeById.mockResolvedValue(makeTrade());
    removeOpenTrade.mockResolvedValue();
    addClosedTrade.mockResolvedValue();

    const result = await closeTrade({
      tradeId: "trade-123",
      symbol: "AAPL",
      exitPrice: 185,
      reason: "stop_loss",
    });

    expect(result.closed).toBe(true);
    expect(result.exitPrice).toBe(188); // uses broker fill price
    expect(result.exitReason).toBe("stop_loss");
    expect(removeOpenTrade).toHaveBeenCalledWith("trade-123");
    expect(addClosedTrade).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "closed",
        exitReason: "stop_loss",
        exitPrice: 188,
        pnl: expect.any(Number),
      }),
    );
  });
});
