/**
 * Trade state across cycles and restarts — real journal + exit engine against
 * in-memory MongoDB. Each "cycle" re-reads trades from the database, exactly
 * like a restarted worker would. Alpaca positions are mocked.
 */
import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';

import { clearMongoHarness, startMongoHarness, stopMongoHarness } from '../helpers/mongoHarness.js';

const getOpenPositions = jest.fn();

jest.unstable_mockModule('../../src/execution/alpacaTrading.js', () => ({
  getOpenPositions,
  submitOrder: jest.fn(),
  closePosition: jest.fn(),
}));

let journal;
let repo;
let exits;
let config;

const NOW = Date.parse('2026-10-20T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();

function strategyTrade(overrides = {}) {
  return {
    tradeId: 't-1',
    symbol: 'ETH/USD',
    normalizedSymbol: 'ETHUSD',
    assetClass: 'crypto',
    strategyName: 'momentum_breakout_atr_v1',
    status: 'open',
    entryPrice: 100,
    stopLoss: 95,
    takeProfit: 120,
    quantity: 10,
    riskAmount: 50,
    openedAt: hoursAgo(2),
    metrics: { atr: 2 },
    ...overrides,
  };
}

function position(price, overrides = {}) {
  return [{
    symbol: 'ETHUSD', qty: '10', qty_available: '10', avg_entry_price: '100',
    current_price: String(price), unrealized_pl: '0', market_value: String(price * 10), ...overrides,
  }];
}

// One cycle as a restarted worker sees it: fresh read from the DB, then exits.
async function cycle(price, { now = NOW, positionOverrides } = {}) {
  getOpenPositions.mockResolvedValue(position(price, positionOverrides));
  const trades = await journal.getOpenTrades();
  return exits.evaluateExits(trades, { now });
}

beforeAll(async () => {
  await startMongoHarness('trade-state-restart');
  journal = await import('../../src/journal/tradeJournal.js');
  repo = await import('../../src/repositories/tradeJournalRepo.mongo.js');
  exits = await import('../../src/positions/exitEngine.js');
  ({ config } = await import('../../src/config/env.js'));
});

afterAll(async () => {
  await stopMongoHarness();
});

beforeEach(async () => {
  await clearMongoHarness();
  getOpenPositions.mockReset();
  config.risk.stopLimitFallback = 'alert';
  config.trading.maxHoldBars = 48;
  config.trading.timeframe = '15Min';
});

describe('barsHeld', () => {
  it('is derived from openedAt and persisted', async () => {
    await repo.upsertOpenTrade(strategyTrade({ openedAt: hoursAgo(2) }));

    expect(await cycle(101)).toEqual([]);
    const [trade] = await journal.getOpenTrades();
    expect(trade.barsHeld).toBe(8); // 2h of 15-minute bars
  });

  it('is not inflated by extra (manual) cycles', async () => {
    await repo.upsertOpenTrade(strategyTrade({ openedAt: hoursAgo(2) }));

    for (let i = 0; i < 5; i += 1) await cycle(101);
    const [trade] = await journal.getOpenTrades();
    expect(trade.barsHeld).toBe(8);
  });

  it('time-exits after MAX_HOLD_BARS even across a restart/downtime gap', async () => {
    await repo.upsertOpenTrade(strategyTrade({ openedAt: hoursAgo(2) }));
    await cycle(101);

    // Worker was down for 11 hours; on restart the age is measured from openedAt.
    const result = await cycle(101, { now: NOW + 11 * 3_600_000 });
    expect(result).toEqual([expect.objectContaining({ shouldExit: true, reason: 'time_exit' })]);
  });

  it('never time-exits an adopted broker_sync position', async () => {
    await repo.upsertOpenTrade(strategyTrade({
      strategyName: 'broker_sync', openedAt: hoursAgo(200), stopLoss: null, takeProfit: null, entryPrice: 100,
    }));
    const result = await cycle(101);
    expect(result.find((r) => r.reason === 'time_exit')).toBeUndefined();
  });

  it('does not time-exit when openedAt is unknown', async () => {
    await repo.upsertOpenTrade(strategyTrade({ openedAt: null, barsHeld: 100 }));
    const result = await cycle(101);
    expect(result.find((r) => r.reason === 'time_exit')).toBeUndefined();
  });
});

describe('breakeven / trailing state', () => {
  it('survives a restart and triggers the trailing exit later', async () => {
    await repo.upsertOpenTrade(strategyTrade());

    // Price reaches entry + 1R → breakeven, trailing stop armed.
    const first = await cycle(106);
    expect(first[0]).toMatchObject({ shouldExit: false, reason: 'breakeven_stop' });

    const [afterRestart] = await journal.getOpenTrades();
    expect(afterRestart.breakevenTriggered).toBe(true);
    expect(afterRestart.trailingStopPrice).toBeCloseTo(103, 6); // 106 − 1.5 × ATR 2
    expect(afterRestart.stopLoss).toBeCloseTo(100.2, 6);

    // Trail ratchets up, and is still there after another fresh read.
    const second = await cycle(110);
    expect(second[0]).toMatchObject({ shouldExit: false, reason: 'trailing_stop' });
    const [ratcheted] = await journal.getOpenTrades();
    expect(ratcheted.trailingStopPrice).toBeCloseTo(107, 6);

    // Pull back through the persisted trailing stop → exit.
    const third = await cycle(106.5);
    expect(third[0]).toMatchObject({ shouldExit: true, reason: 'trailing_stop' });
  });
});

describe('bot-owned broker stop', () => {
  const botStop = (status) => ({ status, owner: 'bot', orderId: 'stop-1', stopPrice: 95, limitPrice: 93.1 });

  it('leaves the stop loss to the broker order (no software stop sell)', async () => {
    await repo.upsertOpenTrade(strategyTrade({ protection: botStop('active') }));
    expect(await cycle(94, { positionOverrides: { qty_available: '0' } })).toEqual([]);
  });

  it('falls back to the software stop once breakeven lifts it above the broker stop', async () => {
    await repo.upsertOpenTrade(strategyTrade({ stopLoss: 100.2, breakevenTriggered: true, trailingStopPrice: 99, protection: botStop('active') }));
    const result = await cycle(100, { positionOverrides: { qty_available: '0' } });
    expect(result).toEqual([expect.objectContaining({ shouldExit: true, reason: 'stop_loss' })]);
  });

  it('alerts only on an unfilled stop-limit by default', async () => {
    await repo.upsertOpenTrade(strategyTrade({ protection: botStop('unfilled') }));
    expect(await cycle(92, { positionOverrides: { qty_available: '0' } })).toEqual([]);
  });

  it('exits at market on an unfilled stop-limit with STOP_LIMIT_FALLBACK=market_bot_only', async () => {
    config.risk.stopLimitFallback = 'market_bot_only';
    await repo.upsertOpenTrade(strategyTrade({ protection: botStop('unfilled') }));
    const result = await cycle(92, { positionOverrides: { qty_available: '0' } });
    expect(result).toEqual([expect.objectContaining({ shouldExit: true, reason: 'stop_limit_unfilled' })]);
  });

  it('never exits an externally protected position, whatever the fallback', async () => {
    config.risk.stopLimitFallback = 'market_bot_only';
    await repo.upsertOpenTrade(strategyTrade({ protection: { ...botStop('unfilled'), owner: 'external' } }));
    expect(await cycle(92, { positionOverrides: { qty_available: '0' } })).toEqual([]);
  });
});
