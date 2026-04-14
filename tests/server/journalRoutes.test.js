import express from 'express';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import request from 'supertest';

const BROKER_SYNC_TRADE = {
  tradeId: 'broker-1',
  symbol: 'TSLA',
  normalizedSymbol: 'TSLA',
  assetClass: 'us_equity',
  strategyName: 'broker_sync',
  quantity: 3,
  entryPrice: 200,
  exitPrice: 180,
  pnl: -60,
  pnlPct: -10,
  exitReason: 'reconciliation',
  openedAt: '2026-04-08T09:00:00.000Z',
  closedAt: '2026-04-08T12:00:00.000Z',
  status: 'closed',
};

const OPEN_TRADE = {
  tradeId: 'open-1',
  symbol: 'AAPL',
  normalizedSymbol: 'AAPL',
  assetClass: 'us_equity',
  strategyName: 'breakout',
  quantity: 2,
  entryPrice: 150,
  stopLoss: 147,
  takeProfit: 158,
  riskAmount: 6,
  openedAt: '2026-04-10T10:00:00.000Z',
  status: 'open',
  metrics: { atr: 1.5 },
};

const BROKER_SYNC_OPEN_TRADE = {
  tradeId: 'broker-open-1',
  symbol: 'NVDA',
  normalizedSymbol: 'NVDA',
  assetClass: 'us_equity',
  strategyName: 'broker_sync',
  quantity: 1,
  entryPrice: 500,
  openedAt: '2026-04-11T09:30:00.000Z',
  status: 'open',
};

const CLOSED_TRADE = {
  tradeId: 'closed-1',
  symbol: 'MSFT',
  normalizedSymbol: 'MSFT',
  assetClass: 'us_equity',
  strategyName: 'breakout',
  quantity: 1,
  entryPrice: 300,
  exitPrice: 315,
  stopLoss: 294,
  takeProfit: 318,
  riskAmount: 6,
  pnl: 15,
  pnlPct: 5,
  exitReason: 'target_hit',
  openedAt: '2026-04-09T09:00:00.000Z',
  closedAt: '2026-04-09T14:00:00.000Z',
  status: 'closed',
  metrics: { atr: 2.1 },
};

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

async function buildApp({ openTrades = [], closedTrades = [], brokerPositions = [] } = {}) {
  jest.unstable_mockModule('../../src/journal/tradeJournal.js', () => ({
    getOpenTrades: jest.fn(async () => openTrades),
    getClosedTrades: jest.fn(async () => closedTrades),
  }));

  jest.unstable_mockModule('../../src/execution/alpacaTrading.js', () => ({
    getOpenPositions: jest.fn(async () => brokerPositions),
  }));

  const { default: journalRoutes } = await import('../../src/server/routes/journal.js');
  const app = express();
  app.use('/api/journal', journalRoutes);
  return app;
}

describe('GET /api/journal/summary', () => {
  it('returns 200 with zeroed stats when no trades exist', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/journal/summary');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        totalTrades: 0,
        closedTrades: 0,
        openTrades: 0,
        wins: 0,
        losses: 0,
        winRate: null,
        totalPnl: 0,
        avgWin: null,
        avgLoss: null,
        bestTrade: null,
        worstTrade: null,
      }),
    );
  });

  it('returns 200 with correct aggregated stats for mixed trades', async () => {
    const app = await buildApp({ openTrades: [OPEN_TRADE], closedTrades: [CLOSED_TRADE] });
    const res = await request(app).get('/api/journal/summary');

    expect(res.status).toBe(200);
    expect(res.body.closedTrades).toBe(1);
    expect(res.body.openTrades).toBe(1);
    expect(res.body.totalTrades).toBe(2);
    expect(res.body.wins).toBe(1);
    expect(res.body.losses).toBe(0);
    expect(res.body.winRate).toBe(100);
    expect(res.body.totalPnl).toBe(15);
    expect(res.body.avgWin).toBe(15);
    expect(res.body.avgLoss).toBeNull();
    expect(res.body.bestTrade).toEqual(
      expect.objectContaining({ tradeId: 'closed-1', symbol: 'MSFT', pnl: 15 }),
    );
    expect(res.body.worstTrade).toEqual(
      expect.objectContaining({ tradeId: 'closed-1', symbol: 'MSFT', pnl: 15 }),
    );
  });

  it('excludes canceled open trades from totals', async () => {
    const canceled = { ...OPEN_TRADE, tradeId: 'canceled-1', status: 'canceled' };
    const app = await buildApp({ openTrades: [canceled] });
    const res = await request(app).get('/api/journal/summary');

    expect(res.status).toBe(200);
    expect(res.body.openTrades).toBe(0);
    expect(res.body.totalTrades).toBe(0);
  });

  it('excludes broker_sync trades from summary by default', async () => {
    const app = await buildApp({
      openTrades: [OPEN_TRADE],
      closedTrades: [CLOSED_TRADE, BROKER_SYNC_TRADE],
    });
    const res = await request(app).get('/api/journal/summary');

    expect(res.status).toBe(200);
    // broker_sync closed trade must not be counted
    expect(res.body.closedTrades).toBe(1);
    expect(res.body.totalTrades).toBe(2); // 1 open + 1 real closed
    expect(res.body.wins).toBe(1);
    expect(res.body.losses).toBe(0);
    expect(res.body.winRate).toBe(100);
    expect(res.body.totalPnl).toBe(15); // broker_sync pnl (-60) excluded
    expect(res.body.avgWin).toBe(15);
    expect(res.body.avgLoss).toBeNull();
  });

  it('includes broker_sync trades when includeBrokerSync=true', async () => {
    const app = await buildApp({
      openTrades: [OPEN_TRADE],
      closedTrades: [CLOSED_TRADE, BROKER_SYNC_TRADE],
    });
    const res = await request(app).get('/api/journal/summary?includeBrokerSync=true');

    expect(res.status).toBe(200);
    expect(res.body.closedTrades).toBe(2);
    expect(res.body.totalPnl).toBe(-45); // 15 + (-60)
    expect(res.body.wins).toBe(1);
    expect(res.body.losses).toBe(1);
    expect(res.body.winRate).toBe(50);
  });

  it('excludes broker_sync open trades from openTrades by default', async () => {
    const app = await buildApp({
      openTrades: [OPEN_TRADE, BROKER_SYNC_OPEN_TRADE],
      closedTrades: [CLOSED_TRADE],
    });
    const res = await request(app).get('/api/journal/summary');

    expect(res.status).toBe(200);
    // BROKER_SYNC_OPEN_TRADE must not be counted
    expect(res.body.openTrades).toBe(1);
    expect(res.body.totalTrades).toBe(2); // 1 real open + 1 real closed
  });

  it('excludes broker_sync open trades from totalTrades by default', async () => {
    const app = await buildApp({
      openTrades: [BROKER_SYNC_OPEN_TRADE],
      closedTrades: [CLOSED_TRADE],
    });
    const res = await request(app).get('/api/journal/summary');

    expect(res.status).toBe(200);
    expect(res.body.openTrades).toBe(0);
    expect(res.body.totalTrades).toBe(1); // only the 1 real closed trade
  });

  it('includes broker_sync open trades in openTrades when includeBrokerSync=true', async () => {
    const app = await buildApp({
      openTrades: [OPEN_TRADE, BROKER_SYNC_OPEN_TRADE],
      closedTrades: [CLOSED_TRADE],
    });
    const res = await request(app).get('/api/journal/summary?includeBrokerSync=true');

    expect(res.status).toBe(200);
    expect(res.body.openTrades).toBe(2);
    expect(res.body.totalTrades).toBe(3); // 2 open + 1 closed
  });

  it('handles zero closed trades safely after broker_sync filtering', async () => {
    const app = await buildApp({ closedTrades: [BROKER_SYNC_TRADE] });
    const res = await request(app).get('/api/journal/summary');

    expect(res.status).toBe(200);
    expect(res.body.closedTrades).toBe(0);
    expect(res.body.winRate).toBeNull();
    expect(res.body.totalPnl).toBe(0);
    expect(res.body.avgWin).toBeNull();
    expect(res.body.avgLoss).toBeNull();
    expect(res.body.bestTrade).toBeNull();
    expect(res.body.worstTrade).toBeNull();
  });
});

describe('GET /api/journal/trades', () => {
  it('returns 200 with empty paginated list when no trades exist', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/journal/trades');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        trades: [],
        total: 0,
        page: 1,
        limit: 50,
        pages: 0,
      }),
    );
  });

  it('returns all trades combined by default', async () => {
    const app = await buildApp({ openTrades: [OPEN_TRADE], closedTrades: [CLOSED_TRADE] });
    const res = await request(app).get('/api/journal/trades');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.trades).toHaveLength(2);
  });

  it('filters to open trades only when status=open', async () => {
    const app = await buildApp({ openTrades: [OPEN_TRADE], closedTrades: [CLOSED_TRADE] });
    const res = await request(app).get('/api/journal/trades?status=open');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.trades[0].tradeId).toBe('open-1');
  });

  it('filters to closed trades only when status=closed', async () => {
    const app = await buildApp({ openTrades: [OPEN_TRADE], closedTrades: [CLOSED_TRADE] });
    const res = await request(app).get('/api/journal/trades?status=closed');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.trades[0].tradeId).toBe('closed-1');
  });

  it('filters by symbol substring match', async () => {
    const app = await buildApp({ openTrades: [OPEN_TRADE], closedTrades: [CLOSED_TRADE] });
    const res = await request(app).get('/api/journal/trades?symbol=MSFT');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.trades[0].symbol).toBe('MSFT');
  });

  it('normalizes assetClass label in response', async () => {
    const app = await buildApp({ closedTrades: [CLOSED_TRADE] });
    const res = await request(app).get('/api/journal/trades?status=closed');

    expect(res.status).toBe(200);
    expect(res.body.trades[0].assetClassLabel).toBe('Stock');
  });

  it('respects page and limit params', async () => {
    const trades = Array.from({ length: 5 }, (_, i) => ({
      ...CLOSED_TRADE,
      tradeId: `closed-${i}`,
    }));
    const app = await buildApp({ closedTrades: trades });
    const res = await request(app).get('/api/journal/trades?page=2&limit=2');

    expect(res.status).toBe(200);
    expect(res.body.page).toBe(2);
    expect(res.body.limit).toBe(2);
    expect(res.body.trades).toHaveLength(2);
    expect(res.body.total).toBe(5);
    expect(res.body.pages).toBe(3);
  });

  it('excludes broker_sync closed trades from default trade list', async () => {
    const app = await buildApp({
      openTrades: [OPEN_TRADE],
      closedTrades: [CLOSED_TRADE, BROKER_SYNC_TRADE],
    });
    const res = await request(app).get('/api/journal/trades');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2); // OPEN_TRADE + CLOSED_TRADE only
    const ids = res.body.trades.map((t) => t.tradeId);
    expect(ids).not.toContain('broker-1');
    expect(ids).toContain('open-1');
    expect(ids).toContain('closed-1');
  });

  it('excludes broker_sync open trades from default trade list', async () => {
    const app = await buildApp({
      openTrades: [OPEN_TRADE, BROKER_SYNC_OPEN_TRADE],
      closedTrades: [CLOSED_TRADE],
    });
    const res = await request(app).get('/api/journal/trades');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2); // OPEN_TRADE + CLOSED_TRADE only
    const ids = res.body.trades.map((t) => t.tradeId);
    expect(ids).not.toContain('broker-open-1');
    expect(ids).toContain('open-1');
    expect(ids).toContain('closed-1');
  });

  it('excludes broker_sync open trades from default status=open list', async () => {
    const app = await buildApp({
      openTrades: [OPEN_TRADE, BROKER_SYNC_OPEN_TRADE],
      closedTrades: [],
    });
    const res = await request(app).get('/api/journal/trades?status=open');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.trades[0].tradeId).toBe('open-1');
  });

  it('includes broker_sync trades when includeBrokerSync=true', async () => {
    const app = await buildApp({
      openTrades: [OPEN_TRADE, BROKER_SYNC_OPEN_TRADE],
      closedTrades: [CLOSED_TRADE, BROKER_SYNC_TRADE],
    });
    const res = await request(app).get('/api/journal/trades?includeBrokerSync=true');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
    const ids = res.body.trades.map((t) => t.tradeId);
    expect(ids).toContain('broker-1');
    expect(ids).toContain('broker-open-1');
  });
});
