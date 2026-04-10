import express from 'express';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import request from 'supertest';

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

describe('positions route canonical shape', () => {
  it('returns expected open and closed position fields', async () => {
    jest.unstable_mockModule('../../src/journal/tradeJournal.js', () => ({
      getOpenTrades: jest.fn(async () => [
        {
          tradeId: 'open-1',
          symbol: 'AAPL',
          normalizedSymbol: 'AAPL',
          assetClass: 'stock',
          strategyName: 'breakout',
          quantity: 2,
          entryPrice: 101,
          stopLoss: 99,
          takeProfit: 108,
          riskAmount: 4,
          openedAt: '2026-04-10T10:00:00.000Z',
          status: 'open',
          metrics: { atr: 1.2 },
        },
      ]),
      getClosedTrades: jest.fn(async () => [
        {
          tradeId: 'closed-1',
          symbol: 'MSFT',
          normalizedSymbol: 'MSFT',
          assetClass: 'stock',
          strategyName: 'breakout',
          quantity: 1,
          entryPrice: 100,
          exitPrice: 110,
          stopLoss: 97,
          takeProfit: 112,
          riskAmount: 3,
          pnl: 10,
          pnlPct: 10,
          exitReason: 'target_hit',
          openedAt: '2026-04-10T09:00:00.000Z',
          closedAt: '2026-04-10T11:00:00.000Z',
          status: 'closed',
          metrics: { atr: 1.8 },
        },
      ]),
    }));

    const { default: positionsRoutes } = await import('../../src/server/routes/positions.js');
    const app = express();
    app.use('/api/positions', positionsRoutes);

    const openResponse = await request(app).get('/api/positions/open');
    const closedResponse = await request(app).get('/api/positions/closed');

    expect(openResponse.status).toBe(200);
    expect(openResponse.body[0]).toEqual(
      expect.objectContaining({
        tradeId: 'open-1',
        symbol: 'AAPL',
        normalizedSymbol: 'AAPL',
        assetClass: 'stock',
        strategyName: 'breakout',
        metrics: { atr: 1.2 },
      }),
    );

    expect(closedResponse.status).toBe(200);
    expect(closedResponse.body[0]).toEqual(
      expect.objectContaining({
        tradeId: 'closed-1',
        symbol: 'MSFT',
        exitPrice: 110,
        pnl: 10,
        exitReason: 'target_hit',
        metrics: { atr: 1.8 },
      }),
    );
  });
});

describe('dashboard route canonical shape', () => {
  it('returns expected summary payload fields', async () => {
    jest.unstable_mockModule('../../src/execution/alpacaTrading.js', () => ({
      getAccount: jest.fn(async () => ({ equity: '10500', portfolio_value: '10500' })),
      getOpenPositions: jest.fn(async () => [
        {
          symbol: 'AAPL',
          qty: '2',
          avg_entry_price: '101',
          current_price: '104',
          unrealized_pl: '6',
          unrealized_plpc: '0.0297',
          market_value: '208',
          asset_class: 'us_equity',
          side: 'long',
        },
      ]),
    }));
    jest.unstable_mockModule('../../src/config/env.js', () => ({
      config: { trading: { runMode: 'paper', dryRun: true } },
    }));
    jest.unstable_mockModule('../../src/journal/decisionLogger.js', () => ({
      loadDecisionLog: jest.fn(async () => ({
        date: '2026-04-10',
        exists: true,
        parseFailed: false,
        records: [],
      })),
    }));
    jest.unstable_mockModule('../../src/journal/tradeJournal.js', () => ({
      getOpenTrades: jest.fn(async () => [
        {
          tradeId: 'open-1',
          symbol: 'AAPL',
          normalizedSymbol: 'AAPL',
          assetClass: 'stock',
          strategyName: 'breakout',
          quantity: 2,
          entryPrice: 101,
          stopLoss: 99,
          takeProfit: 108,
          riskAmount: 4,
          openedAt: '2026-04-10T10:00:00.000Z',
          status: 'open',
          metrics: { atr: 1.2 },
        },
      ]),
      getClosedTrades: jest.fn(async () => []),
      getTradeEvents: jest.fn(async () => []),
    }));
    jest.unstable_mockModule('../../src/repositories/cycleRepo.mongo.js', () => ({
      getCyclesForDate: jest.fn(async () => [
        {
          type: 'completed',
          timestamp: '2026-04-10T10:15:00.000Z',
          recordedAt: '2026-04-10T10:15:01.000Z',
          scanned: 4,
          approved: 1,
          placed: 1,
        },
      ]),
    }));
    jest.unstable_mockModule('../../src/repositories/tradeJournalRepo.mongo.js', () => ({
      getTradeEventsForDate: jest.fn(async () => [
        {
          timestamp: '2026-04-10T10:15:00.000Z',
          pnl: 5,
          orderStatus: 'filled',
        },
      ]),
    }));
    jest.unstable_mockModule('../../src/risk/riskState.js', () => ({
      loadRiskState: jest.fn(async () => ({ dailyRealizedLoss: 0 })),
    }));
    jest.unstable_mockModule('../../src/utils/logger.js', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    }));

    const { default: dashboardRoutes } = await import('../../src/server/routes/dashboard.js');
    const app = express();
    app.use('/api/dashboard', dashboardRoutes);

    const response = await request(app).get('/api/dashboard/summary');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        botStatus: expect.any(String),
        lastCycleTime: expect.any(String),
        symbolsScanned: 4,
        approvedSignals: 1,
        ordersPlacedToday: 1,
        openPositionsCount: 1,
        realizedPnl: 5,
        unrealizedPnl: 6,
        dailyPnl: 11,
        equity: 10500,
        portfolioValue: 10500,
        dailyRealizedLoss: 0,
      }),
    );
  });
});
