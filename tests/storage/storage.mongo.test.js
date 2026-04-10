import { beforeAll, afterAll, beforeEach, describe, expect, it } from '@jest/globals';
import mongoose from 'mongoose';

import { clearMongoHarness, startMongoHarness, stopMongoHarness } from '../helpers/mongoHarness.js';

let connectMongo;
let readJson;
let writeJson;
let appendJsonArray;
let appendDailyRecord;
let appendLogEvent;
let getStoragePath;
let getDailyStoragePath;

beforeAll(async () => {
  await startMongoHarness('storage-behavior-test');

  ({ connectMongo } = await import('../../src/db/connectMongo.js'));
  ({
    readJson,
    writeJson,
    appendJsonArray,
    appendDailyRecord,
    appendLogEvent,
    getStoragePath,
    getDailyStoragePath,
  } = await import('../../src/lib/storage.js'));
});

afterAll(async () => {
  await stopMongoHarness();
});

beforeEach(async () => {
  await clearMongoHarness();
});

describe('Mongo connection layer', () => {
  it('connects safely when called multiple times', async () => {
    await connectMongo();
    await connectMongo();

    expect(mongoose.connection.readyState).toBe(1);
    expect(mongoose.connection.name).toBe(process.env.MONGO_DB_NAME);
  });
});

describe('Mongo-backed storage helpers', () => {
  it('writes and reads open trades', async () => {
    const filePath = getStoragePath('trades', 'open.json');
    const trade = {
      tradeId: 'open-1',
      symbol: 'AAPL',
      normalizedSymbol: 'AAPL',
      assetClass: 'stock',
      strategyName: 'breakout',
      entryPrice: 101,
      stopLoss: 99,
      takeProfit: 108,
      quantity: 2,
      riskAmount: 4,
      status: 'open',
      openedAt: '2026-04-10T10:00:00.000Z',
      brokerOrderId: 'broker-1',
      brokerClientOrderId: 'client-1',
      orphaned: false,
      metrics: { atr: 1.5 },
    };

    await writeJson(filePath, [trade]);

    const result = await readJson(filePath, []);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining(trade));
  });

  it('appends and reads closed trades and trade events', async () => {
    const closedPath = getStoragePath('trades', 'closed.json');
    const eventsPath = getStoragePath('trades', 'events.json');

    await appendJsonArray(closedPath, {
      tradeId: 'closed-1',
      symbol: 'MSFT',
      normalizedSymbol: 'MSFT',
      assetClass: 'stock',
      strategyName: 'breakout',
      entryPrice: 100,
      exitPrice: 110,
      stopLoss: 97,
      takeProfit: 112,
      quantity: 1,
      riskAmount: 3,
      pnl: 10,
      pnlPct: 10,
      exitReason: 'target_hit',
      openedAt: '2026-04-10T09:00:00.000Z',
      closedAt: '2026-04-10T11:00:00.000Z',
      status: 'closed',
      orphaned: false,
      metrics: { atr: 2 },
    });

    await appendJsonArray(eventsPath, {
      id: 'event-1',
      type: 'trade_open',
      tradeId: 'closed-1',
      symbol: 'MSFT',
      strategyName: 'breakout',
      timestamp: '2026-04-10T09:00:00.000Z',
      reason: 'entry',
      pnl: null,
      payload: { source: 'test' },
    });

    const closedTrades = await readJson(closedPath, []);
    const events = await readJson(eventsPath, []);

    expect(closedTrades).toHaveLength(1);
    expect(closedTrades[0]).toEqual(expect.objectContaining({ tradeId: 'closed-1', pnl: 10 }));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({ eventId: 'event-1', id: 'event-1', tradeId: 'closed-1' }),
    );
  });

  it('stores decisions and cycle logs by date', async () => {
    const date = new Date('2026-04-10T12:00:00.000Z');
    const decisionsPath = getDailyStoragePath('decisions', date);
    const logsPath = getDailyStoragePath('logs', date);

    await appendJsonArray(decisionsPath, {
      decisionId: 'decision-1',
      symbol: 'NVDA',
      normalizedSymbol: 'NVDA',
      assetClass: 'stock',
      approved: true,
      reason: 'breakout_confirmed',
      strategyName: 'breakout',
      entryPrice: 900,
      stopLoss: 890,
      takeProfit: 930,
      quantity: 1,
      riskAmount: 10,
      timestamp: '2026-04-10T12:00:00.000Z',
      recordedAt: '2026-04-10T12:00:00.000Z',
      metrics: { atr: 5 },
    });

    await appendLogEvent('cycle_complete', {
      cycleId: 'cycle-1',
      timestamp: '2026-04-10T12:15:00.000Z',
      recordedAt: '2026-04-10T12:15:01.000Z',
      dryRun: true,
      scanned: 5,
      approved: 1,
      rejected: 4,
      placed: 0,
      errors: 0,
    }, date);

    const decisions = await readJson(decisionsPath, []);
    const logs = await readJson(logsPath, []);

    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toEqual(expect.objectContaining({ symbol: 'NVDA', date: '2026-04-10' }));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual(expect.objectContaining({ cycleId: 'cycle-1', type: 'cycle_complete' }));
  });

  it('stores journal records by date and returns payload shape', async () => {
    const date = new Date('2026-04-10T13:00:00.000Z');
    const journalPath = getDailyStoragePath('journal', date);
    const journalRecord = {
      id: 'journal-1',
      type: 'trade_closed',
      tradeId: 'trade-1',
      symbol: 'TSLA',
      timestamp: '2026-04-10T13:00:00.000Z',
      pnl: 12.5,
    };

    await appendDailyRecord('journal', journalRecord, date);
    const records = await readJson(journalPath, []);

    expect(records).toEqual([journalRecord]);
  });

  it('reads and writes risk state as a singleton object', async () => {
    const filePath = getStoragePath('riskState.json');
    const riskState = {
      key: 'risk-state',
      date: '2026-04-10',
      halted: true,
      dailyLossPct: 1.2,
      dailyRealizedLoss: 250,
      cooldowns: { AAPL: '2026-04-10T15:00:00.000Z' },
      updatedAt: '2026-04-10T14:00:00.000Z',
    };

    await writeJson(filePath, riskState);
    const result = await readJson(filePath, {});

    expect(result).toEqual(expect.objectContaining(riskState));
  });
});
