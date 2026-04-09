import {
  normalizeTradeForRead,
  normalizeTradeForStorage,
  normalizeTradePayloadForStorage,
} from '../../src/journal/normalizeTrade.js';

describe('trade normalization', () => {
  it('writes new open trade records in canonical shape only', () => {
    const storedTrade = normalizeTradeForStorage({
      id: 'trade-1',
      symbol: 'aapl',
      assetClass: 'equity',
      strategy: 'breakout',
      entryPrice: 100,
      stop: 95,
      target: 110,
      qty: 2,
      risk: 10,
      status: 'open',
      openedAt: '2025-01-01T10:00:00.000Z',
      metrics: { atr: 2.5 },
    });

    expect(storedTrade).toEqual({
      tradeId: 'trade-1',
      symbol: 'aapl',
      normalizedSymbol: 'AAPL',
      assetClass: 'equity',
      strategyName: 'breakout',
      entryPrice: 100,
      stopLoss: 95,
      takeProfit: 110,
      quantity: 2,
      riskAmount: 10,
      status: 'open',
      openedAt: '2025-01-01T10:00:00.000Z',
      metrics: { atr: 2.5 },
    });

    expect(storedTrade).not.toHaveProperty('id');
    expect(storedTrade).not.toHaveProperty('stop');
    expect(storedTrade).not.toHaveProperty('target');
    expect(storedTrade).not.toHaveProperty('qty');
    expect(storedTrade).not.toHaveProperty('risk');
    expect(storedTrade).not.toHaveProperty('strategy');
  });

  it('reads legacy trade records into the canonical in-memory shape', () => {
    const trade = normalizeTradeForRead({
      id: 'legacy-1',
      symbol: 'msft',
      strategy: 'breakout',
      entryPrice: 250,
      stop: 245,
      target: 265,
      qty: 4,
      risk: 20,
      status: 'open',
      openedAt: '2025-01-01T11:00:00.000Z',
      metrics: { volume: 1200000 },
    });

    expect(trade).toMatchObject({
      tradeId: 'legacy-1',
      symbol: 'msft',
      normalizedSymbol: 'MSFT',
      strategyName: 'breakout',
      entryPrice: 250,
      stopLoss: 245,
      takeProfit: 265,
      quantity: 4,
      riskAmount: 20,
      status: 'open',
      openedAt: '2025-01-01T11:00:00.000Z',
      metrics: { volume: 1200000 },
    });
  });

  it('archives legacy-shaped closed trades using canonical fields only', () => {
    const archivedTrades = normalizeTradePayloadForStorage([
      {
        id: 'legacy-close-1',
        symbol: 'nvda',
        strategy: 'breakout',
        entryPrice: 500,
        stop: 490,
        target: 530,
        qty: 1,
        risk: 10,
        status: 'closed',
        openedAt: '2025-01-01T12:00:00.000Z',
        closedAt: '2025-01-01T13:00:00.000Z',
        exitPrice: 525,
        pnl: 25,
        pnlPct: 5,
        exitReason: 'target-hit',
        metrics: { atr: 8 },
      },
    ]);

    expect(archivedTrades).toEqual([
      {
        tradeId: 'legacy-close-1',
        symbol: 'nvda',
        normalizedSymbol: 'NVDA',
        strategyName: 'breakout',
        entryPrice: 500,
        stopLoss: 490,
        takeProfit: 530,
        quantity: 1,
        riskAmount: 10,
        status: 'closed',
        openedAt: '2025-01-01T12:00:00.000Z',
        closedAt: '2025-01-01T13:00:00.000Z',
        exitPrice: 525,
        pnl: 25,
        pnlPct: 5,
        exitReason: 'target-hit',
        metrics: { atr: 8 },
      },
    ]);

    expect(archivedTrades[0]).not.toHaveProperty('id');
    expect(archivedTrades[0]).not.toHaveProperty('stop');
    expect(archivedTrades[0]).not.toHaveProperty('target');
    expect(archivedTrades[0]).not.toHaveProperty('qty');
    expect(archivedTrades[0]).not.toHaveProperty('risk');
    expect(archivedTrades[0]).not.toHaveProperty('strategy');
  });
});
