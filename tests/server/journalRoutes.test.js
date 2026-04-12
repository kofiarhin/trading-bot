import express from 'express';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import request from 'supertest';

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

async function buildApp({ openTrades = [], closedTrades = [] } = {}) {
  jest.unstable_mockModule('../../src/journal/tradeJournal.js', () => ({
    getOpenTrades: jest.fn(async () => openTrades),
    getClosedTrades: jest.fn(async () => closedTrades),
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
});
