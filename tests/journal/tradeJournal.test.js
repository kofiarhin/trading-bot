// Regression tests for the Mongo-backed tradeJournal.js facade.
// Covers the full trade lifecycle: pending → open → closed, plus event
// persistence, getTradeEvents, and syncTradesWithBroker.
import { beforeAll, afterAll, beforeEach, describe, expect, it } from '@jest/globals';

import { clearMongoHarness, startMongoHarness, stopMongoHarness } from '../helpers/mongoHarness.js';

let createPendingTrade;
let markTradeOpen;
let markTradeClosed;
let markTradeCanceled;
let syncTradesWithBroker;
let getOpenTrades;
let getOpenTradeById;
let getClosedTrades;
let getTradeEvents;

beforeAll(async () => {
  await startMongoHarness('trade-journal-test');
  ({
    createPendingTrade,
    markTradeOpen,
    markTradeClosed,
    markTradeCanceled,
    syncTradesWithBroker,
    getOpenTrades,
    getOpenTradeById,
    getClosedTrades,
    getTradeEvents,
  } = await import('../../src/journal/tradeJournal.js'));
});

beforeEach(async () => {
  await clearMongoHarness();
});

afterAll(async () => {
  await stopMongoHarness();
});

const baseDecision = {
  symbol: 'AAPL',
  normalizedSymbol: 'AAPL',
  assetClass: 'stock',
  strategyName: 'breakout',
  entryPrice: 150,
  stopLoss: 145,
  takeProfit: 162,
  quantity: 5,
  riskAmount: 25,
};

// ─── open-trade persistence ───────────────────────────────────────────────────

describe('createPendingTrade', () => {
  it('returns a canonical pending trade record', async () => {
    const trade = await createPendingTrade({ decision: baseDecision });

    expect(trade.tradeId).toBeDefined();
    expect(trade.status).toBe('pending');
    expect(trade.symbol).toBe('AAPL');
    expect(trade.stopLoss).toBe(145);
    expect(trade.takeProfit).toBe(162);
    expect(trade.quantity).toBe(5);
  });

  it('persists the trade so getOpenTrades returns it', async () => {
    await createPendingTrade({ decision: baseDecision });

    const open = await getOpenTrades();
    expect(open).toHaveLength(1);
    expect(open[0].status).toBe('pending');
    expect(open[0].symbol).toBe('AAPL');
  });

  it('does not create a duplicate when the same symbol is already pending', async () => {
    await createPendingTrade({ decision: baseDecision });
    await createPendingTrade({ decision: baseDecision });

    const open = await getOpenTrades();
    expect(open).toHaveLength(1);
  });
});

// ─── markTradeOpen ────────────────────────────────────────────────────────────

describe('markTradeOpen', () => {
  it('transitions a pending trade to open and records entry price', async () => {
    const pending = await createPendingTrade({ decision: baseDecision });
    const brokerPosition = { symbol: 'AAPL', qty: '5', avg_entry_price: '150.25' };

    await markTradeOpen({ tradeId: pending.tradeId, brokerPosition });

    const open = await getOpenTrades();
    expect(open[0].status).toBe('open');
    expect(open[0].entryPrice).toBe(150.25);
  });

  it('creates a broker-sync trade when no matching pending record exists', async () => {
    const brokerPosition = { symbol: 'MSFT', qty: '3', avg_entry_price: '420' };

    await markTradeOpen({ symbol: 'MSFT', brokerPosition, source: 'broker_sync' });

    const open = await getOpenTrades();
    expect(open).toHaveLength(1);
    expect(open[0].symbol).toBe('MSFT');
    expect(open[0].strategyName).toBe('broker_sync');
  });
});

// ─── markTradeClosed ──────────────────────────────────────────────────────────

describe('markTradeClosed', () => {
  it('removes from open trades and adds to closed trades with pnl', async () => {
    const pending = await createPendingTrade({ decision: baseDecision });
    await markTradeOpen({
      tradeId: pending.tradeId,
      brokerPosition: { symbol: 'AAPL', qty: '5', avg_entry_price: '150' },
    });

    const brokerOrder = {
      filled_avg_price: '162',
      filled_at: new Date().toISOString(),
    };

    await markTradeClosed({ tradeId: pending.tradeId, reason: 'target_hit', brokerOrder });

    const open = await getOpenTrades();
    const closed = await getClosedTrades();

    expect(open).toHaveLength(0);
    expect(closed).toHaveLength(1);
    expect(closed[0].status).toBe('closed');
    expect(closed[0].exitReason).toBe('target_hit');
    expect(closed[0].exitPrice).toBe(162);
    expect(typeof closed[0].pnl).toBe('number');
  });

  it('returns null when the tradeId is not in open trades', async () => {
    const result = await markTradeClosed({ tradeId: 'nonexistent', reason: 'stop_hit' });
    expect(result).toBeNull();
  });
});

// ─── markTradeCanceled ────────────────────────────────────────────────────────

describe('markTradeCanceled', () => {
  it('marks a pending trade as canceled', async () => {
    const pending = await createPendingTrade({ decision: baseDecision });
    await markTradeCanceled({ tradeId: pending.tradeId, reason: 'order_rejected' });

    const open = await getOpenTrades();
    expect(open[0].status).toBe('canceled');
  });
});

// ─── getOpenTradeById ─────────────────────────────────────────────────────────

describe('getOpenTradeById', () => {
  it('returns null when trade does not exist', async () => {
    const result = await getOpenTradeById('missing-id');
    expect(result).toBeNull();
  });

  it('returns the trade when it exists', async () => {
    const trade = await createPendingTrade({ decision: baseDecision });
    const found = await getOpenTradeById(trade.tradeId);
    expect(found?.tradeId).toBe(trade.tradeId);
  });
});

// ─── trade events ─────────────────────────────────────────────────────────────

describe('getTradeEvents', () => {
  it('records a trade_pending event when createPendingTrade is called', async () => {
    await createPendingTrade({ decision: baseDecision });

    const events = await getTradeEvents();
    expect(events.length).toBeGreaterThan(0);
    const pending = events.find((e) => e.type === 'trade_pending');
    expect(pending).toBeDefined();
    expect(pending.symbol).toBe('AAPL');
  });

  it('records trade_pending → trade_open → trade_closed events across lifecycle', async () => {
    const trade = await createPendingTrade({ decision: baseDecision });
    await markTradeOpen({
      tradeId: trade.tradeId,
      brokerPosition: { symbol: 'AAPL', qty: '5', avg_entry_price: '150' },
    });
    await markTradeClosed({
      tradeId: trade.tradeId,
      reason: 'stop_hit',
      brokerOrder: { filled_avg_price: '145', filled_at: new Date().toISOString() },
    });

    const events = await getTradeEvents();
    const types = events.map((e) => e.type);
    expect(types).toContain('trade_pending');
    expect(types).toContain('trade_open');
    expect(types).toContain('trade_closed');
  });
});

// ─── syncTradesWithBroker ─────────────────────────────────────────────────────

describe('syncTradesWithBroker', () => {
  it('transitions pending → open when broker position exists', async () => {
    const trade = await createPendingTrade({ decision: baseDecision });

    await syncTradesWithBroker({
      brokerPositions: [{ symbol: 'AAPL', qty: '5', avg_entry_price: '150' }],
      brokerOrders: [],
    });

    const open = await getOpenTrades();
    const synced = open.find((t) => t.tradeId === trade.tradeId);
    expect(synced?.status).toBe('open');
  });

  it('closes a pending trade when broker order is canceled', async () => {
    const trade = await createPendingTrade({ decision: baseDecision });

    await syncTradesWithBroker({
      brokerPositions: [],
      brokerOrders: [
        {
          id: trade.brokerOrderId ?? 'broker-1',
          symbol: 'AAPL',
          status: 'canceled',
        },
      ],
    });

    const open = await getOpenTrades();
    const closed = await getClosedTrades();
    expect(open.find((t) => t.tradeId === trade.tradeId)).toBeUndefined();
    expect(closed.some((t) => t.symbol === 'AAPL')).toBe(true);
  });
});

// ─── protective stops and symbol formats ─────────────────────────────────────

describe('syncTradesWithBroker – protective stops', () => {
  const cryptoDecision = {
    ...baseDecision,
    symbol: 'SOL/USD',
    normalizedSymbol: 'SOLUSD',
    assetClass: 'crypto',
    entryPrice: 100,
    stopLoss: 95,
    takeProfit: 110,
    quantity: 2,
  };

  it('does not mistake a protective stop order for the pending entry order', async () => {
    const trade = await createPendingTrade({ decision: cryptoDecision });

    await syncTradesWithBroker({
      brokerPositions: [],
      brokerOrders: [
        { id: 'stop-x', symbol: 'SOL/USD', side: 'sell', type: 'stop_limit', status: 'canceled', client_order_id: 'manual' },
      ],
    });

    const open = await getOpenTrades();
    expect(open.find((t) => t.tradeId === trade.tradeId)?.status).toBe('pending');
  });

  it('matches a SOLUSD position to a SOL/USD trade without creating a duplicate', async () => {
    const trade = await createPendingTrade({ decision: cryptoDecision });

    await syncTradesWithBroker({
      brokerPositions: [{ symbol: 'SOLUSD', asset_class: 'crypto', qty: 2, qty_available: '2', avg_entry_price: 100, current_price: 101 }],
      brokerOrders: [],
    });

    const open = await getOpenTrades();
    expect(open).toHaveLength(1);
    expect(open[0].tradeId).toBe(trade.tradeId);
    expect(open[0].status).toBe('open');
    expect(open[0].protection.status).toBe('missing');
  });

  it('closes a trade as stop_hit at the stop fill price when its tracked stop fills', async () => {
    const trade = await createPendingTrade({ decision: cryptoDecision });
    const position = { symbol: 'SOLUSD', asset_class: 'crypto', qty: 2, qty_available: '0', avg_entry_price: 100, current_price: 101 };
    const stop = {
      id: 'stop-1', client_order_id: `tb-stop-${trade.tradeId}`, symbol: 'SOL/USD', side: 'sell',
      type: 'stop_limit', qty: '2', filled_qty: '0', stop_price: '95', limit_price: '93.1', status: 'new',
    };

    await syncTradesWithBroker({ brokerPositions: [position], brokerOrders: [stop] });
    expect((await getOpenTrades())[0].protection).toMatchObject({ status: 'active', owner: 'bot', orderId: 'stop-1' });

    await syncTradesWithBroker({
      brokerPositions: [],
      brokerOrders: [{ ...stop, status: 'filled', filled_qty: '2', filled_avg_price: '94.5', filled_at: '2026-10-20T00:00:00Z' }],
    });

    expect(await getOpenTrades()).toHaveLength(0);
    const closed = (await getClosedTrades()).find((t) => t.tradeId === trade.tradeId);
    expect(closed.exitReason).toBe('stop_hit');
    expect(closed.exitPrice).toBe(94.5);
  });

  it('adopts a position with a negative broker average as unverified, never as a negative entry', async () => {
    await syncTradesWithBroker({
      brokerPositions: [{ symbol: 'SOLUSD', asset_class: 'crypto', qty: 5, avg_entry_price: -2.38, current_price: 105 }],
      brokerOrders: [],
    });

    const [adopted] = await getOpenTrades();
    expect(adopted.strategyName).toBe('broker_sync');
    expect(adopted.assetClass).toBe('crypto');
    expect(adopted.entryPrice ?? null).toBeNull();
    expect(adopted.entryPriceSource).toBe('unverified');
  });
});

// ─── closing (exit accepted, not yet filled) ──────────────────────────────────

describe('syncTradesWithBroker – closing trades', () => {
  const position = { symbol: 'SOLUSD', asset_class: 'crypto', qty: 2, qty_available: '0', avg_entry_price: 100, current_price: 90 };

  async function closingTrade() {
    const trade = await createPendingTrade({
      decision: { ...baseDecision, symbol: 'SOL/USD', normalizedSymbol: 'SOLUSD', assetClass: 'crypto', entryPrice: 100, stopLoss: 95, takeProfit: 110, quantity: 2 },
    });
    await syncTradesWithBroker({ brokerPositions: [position], brokerOrders: [] });
    const { upsertOpenTrade } = await import('../../src/repositories/tradeJournalRepo.mongo.js');
    const [open] = await getOpenTrades();
    await upsertOpenTrade({ ...open, status: 'closing', exitOrderId: 'exit-1', closingReason: 'time_exit' });
    return trade;
  }

  it('closes only when the exit order fills, at the fill price, and records loss + cooldown', async () => {
    const trade = await closingTrade();

    await syncTradesWithBroker({ brokerPositions: [position], brokerOrders: [{ id: 'exit-1', symbol: 'SOL/USD', side: 'sell', type: 'market', status: 'new' }] });
    expect((await getOpenTrades())[0].status).toBe('closing');

    await syncTradesWithBroker({
      brokerPositions: [],
      brokerOrders: [{ id: 'exit-1', symbol: 'SOL/USD', side: 'sell', type: 'market', status: 'filled', filled_qty: '2', filled_avg_price: '90', filled_at: '2026-10-20T00:00:00Z' }],
    });

    expect(await getOpenTrades()).toHaveLength(0);
    const closed = (await getClosedTrades()).find((t) => t.tradeId === trade.tradeId);
    expect(closed).toMatchObject({ exitReason: 'time_exit', exitPrice: 90, pnl: -20 });

    const { loadRiskState } = await import('../../src/risk/riskState.js');
    const risk = await loadRiskState();
    expect(risk.dailyRealizedLoss).toBe(20);
    expect(new Date(risk.cooldowns.SOLUSD) > new Date()).toBe(true);
  });

  it('reverts to open (and counts the failure) when the exit order dies while the position remains', async () => {
    await closingTrade();

    await syncTradesWithBroker({ brokerPositions: [position], brokerOrders: [{ id: 'exit-1', symbol: 'SOL/USD', side: 'sell', type: 'market', status: 'canceled' }] });

    const [trade] = await getOpenTrades();
    expect(trade).toMatchObject({ status: 'open', exitAttempts: 1, lastExitError: 'exit_order_canceled' });
    expect(trade.exitOrderId ?? null).toBeNull();
    const events = (await getTradeEvents()).filter((e) => e.type === 'exit_order_failed');
    expect(events).toHaveLength(1);
  });

  it('reverts to open when the exit order is gone but the position remains', async () => {
    await closingTrade();
    await syncTradesWithBroker({ brokerPositions: [position], brokerOrders: [] });
    const [trade] = await getOpenTrades();
    expect(trade).toMatchObject({ status: 'open', lastExitError: 'exit_order_not_found', exitAttempts: 1 });
  });

  it('does not record a trade outcome for a pending entry that never filled', async () => {
    const trade = await createPendingTrade({ decision: baseDecision });
    await syncTradesWithBroker({
      brokerPositions: [],
      brokerOrders: [{ id: trade.brokerOrderId ?? 'b-1', symbol: 'AAPL', side: 'buy', type: 'market', status: 'canceled' }],
    });
    const { loadRiskState } = await import('../../src/risk/riskState.js');
    const risk = await loadRiskState();
    expect(risk.cooldowns?.AAPL).toBeUndefined();
  });
});

// ─── broker_sync reconciliation ───────────────────────────────────────────────

describe('syncTradesWithBroker – broker_sync reconciliation', () => {
  it('keeps broker_sync open trade when broker still has the position', async () => {
    await markTradeOpen({
      symbol: 'AAPL',
      brokerPosition: { symbol: 'AAPL', qty: '5', avg_entry_price: '150' },
      source: 'broker_sync',
    });

    await syncTradesWithBroker({
      brokerPositions: [{ symbol: 'AAPL', qty: '5', avg_entry_price: '150' }],
      brokerOrders: [],
    });

    const open = await getOpenTrades();
    const closed = await getClosedTrades();
    expect(open.find((t) => t.symbol === 'AAPL')).toBeDefined();
    expect(closed.find((t) => t.symbol === 'AAPL')).toBeUndefined();
  });

  it('reconciles a broker_sync open trade when broker position disappears', async () => {
    await markTradeOpen({
      symbol: 'AAPL',
      brokerPosition: { symbol: 'AAPL', qty: '5', avg_entry_price: '150' },
      source: 'broker_sync',
    });

    await syncTradesWithBroker({ brokerPositions: [], brokerOrders: [] });

    const open = await getOpenTrades();
    const closed = await getClosedTrades();
    expect(open.find((t) => t.symbol === 'AAPL')).toBeUndefined();
    const reconciledTrade = closed.find((t) => t.symbol === 'AAPL');
    expect(reconciledTrade).toBeDefined();
    expect(reconciledTrade.exitReason).toBe('broker_sync_reconciled');
    expect(reconciledTrade.status).toBe('closed');
  });

  it('does not create duplicate closed records when sync is rerun with no broker position', async () => {
    await markTradeOpen({
      symbol: 'AAPL',
      brokerPosition: { symbol: 'AAPL', qty: '5', avg_entry_price: '150' },
      source: 'broker_sync',
    });

    await syncTradesWithBroker({ brokerPositions: [], brokerOrders: [] });
    await syncTradesWithBroker({ brokerPositions: [], brokerOrders: [] });

    const closed = await getClosedTrades();
    const aaplClosed = closed.filter((t) => t.symbol === 'AAPL');
    expect(aaplClosed).toHaveLength(1);
  });

  it('does not apply broker_sync_reconciled to non-broker_sync open trades', async () => {
    const pending = await createPendingTrade({ decision: baseDecision });
    await markTradeOpen({
      tradeId: pending.tradeId,
      brokerPosition: { symbol: 'AAPL', qty: '5', avg_entry_price: '150' },
    });

    await syncTradesWithBroker({ brokerPositions: [], brokerOrders: [] });

    const closed = await getClosedTrades();
    const aaplClosed = closed.find((t) => t.symbol === 'AAPL');
    // If closed, must not carry the broker_sync_reconciled reason
    if (aaplClosed) {
      expect(aaplClosed.exitReason).not.toBe('broker_sync_reconciled');
    }
  });

  it('reconciles all stale broker_sync trades when broker positions list is empty', async () => {
    await markTradeOpen({
      symbol: 'AAPL',
      brokerPosition: { symbol: 'AAPL', qty: '5', avg_entry_price: '150' },
      source: 'broker_sync',
    });
    await markTradeOpen({
      symbol: 'MSFT',
      brokerPosition: { symbol: 'MSFT', qty: '3', avg_entry_price: '420' },
      source: 'broker_sync',
    });

    await syncTradesWithBroker({ brokerPositions: [], brokerOrders: [] });

    const open = await getOpenTrades();
    const closed = await getClosedTrades();
    expect(open).toHaveLength(0);
    expect(closed).toHaveLength(2);
    expect(closed.every((t) => t.exitReason === 'broker_sync_reconciled')).toBe(true);
  });
});
