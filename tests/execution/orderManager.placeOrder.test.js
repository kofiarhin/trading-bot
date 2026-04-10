// Tests for orderManager.placeOrder — validation guards and dry-run safety.
import fs from 'node:fs';
import { jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

async function importPlaceOrder() {
  jest.unstable_mockModule('../../src/execution/alpacaTrading.js', () => ({
    submitOrder: jest.fn(async () => ({ id: 'broker-1', status: 'accepted' })),
    closePosition: jest.fn(),
  }));
  jest.unstable_mockModule('../../src/lib/alpaca.js', () => ({
    isDryRunEnabled: jest.fn(() => false),
  }));
  jest.unstable_mockModule('../../src/config/env.js', () => ({
    config: { trading: { runMode: 'paper' } },
  }));
  jest.unstable_mockModule('../../src/journal/tradeJournal.js', () => ({
    createPendingTrade: jest.fn(async () => ({ tradeId: 'x' })),
    markTradeOpen: jest.fn(),
    markTradeCanceled: jest.fn(),
    getOpenTradeById: jest.fn(async () => null),
    removeOpenTrade: jest.fn(),
    addClosedTrade: jest.fn(),
  }));
  jest.unstable_mockModule('../../src/utils/logger.js', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  }));
  jest.unstable_mockModule('../../src/utils/symbolNorm.js', () => ({
    normalizeSymbol: (s) => s.replace('/', ''),
  }));
  jest.unstable_mockModule('../../src/journal/normalizeTrade.js', () => ({
    normalizeTradeForWrite: (t) => t,
  }));
  const { placeOrder } = await import('../../src/execution/orderManager.js');
  return placeOrder;
}

const valid = { symbol: 'AAPL', approved: true, entryPrice: 150, stopLoss: 140, takeProfit: 165, quantity: 5 };

describe('canonical orderManager.placeOrder — validation guards', () => {
  it('throws when entryPrice is 0', async () => {
    const placeOrder = await importPlaceOrder();
    await expect(placeOrder({ decision: { ...valid, entryPrice: 0 }, dryRun: false }))
      .rejects.toThrow('entryPrice must be > 0');
  });

  it('throws when stopLoss is 0', async () => {
    const placeOrder = await importPlaceOrder();
    await expect(placeOrder({ decision: { ...valid, stopLoss: 0 }, dryRun: false }))
      .rejects.toThrow('stopLoss must be > 0');
  });

  it('throws when takeProfit is 0', async () => {
    const placeOrder = await importPlaceOrder();
    await expect(placeOrder({ decision: { ...valid, takeProfit: 0 }, dryRun: false }))
      .rejects.toThrow('takeProfit must be > 0');
  });

  it('throws when quantity is 0', async () => {
    const placeOrder = await importPlaceOrder();
    await expect(placeOrder({ decision: { ...valid, quantity: 0 }, dryRun: false }))
      .rejects.toThrow('quantity must be > 0');
  });

  it('throws when stopLoss >= entryPrice', async () => {
    const placeOrder = await importPlaceOrder();
    await expect(placeOrder({ decision: { ...valid, stopLoss: 150 }, dryRun: false }))
      .rejects.toThrow('stopLoss must be < entryPrice');
  });

  it('throws when takeProfit <= entryPrice', async () => {
    const placeOrder = await importPlaceOrder();
    await expect(placeOrder({ decision: { ...valid, takeProfit: 150 }, dryRun: false }))
      .rejects.toThrow('takeProfit must be > entryPrice');
  });
});

describe('canonical orderManager.placeOrder — dry-run path', () => {
  it('keeps dry-run side-effect free: no broker call, no storage write', async () => {
    const submitMock = jest.fn();
    const createPendingMock = jest.fn();

    jest.unstable_mockModule('../../src/execution/alpacaTrading.js', () => ({
      submitOrder: submitMock,
      closePosition: jest.fn(),
    }));
    jest.unstable_mockModule('../../src/lib/alpaca.js', () => ({
      isDryRunEnabled: jest.fn(() => false),
    }));
    jest.unstable_mockModule('../../src/config/env.js', () => ({
      config: { trading: { runMode: 'paper' } },
    }));
    jest.unstable_mockModule('../../src/journal/tradeJournal.js', () => ({
      createPendingTrade: createPendingMock,
      markTradeOpen: jest.fn(),
      markTradeCanceled: jest.fn(),
      getOpenTradeById: jest.fn(async () => null),
      removeOpenTrade: jest.fn(),
      addClosedTrade: jest.fn(),
    }));
    jest.unstable_mockModule('../../src/utils/logger.js', () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    }));
    jest.unstable_mockModule('../../src/utils/symbolNorm.js', () => ({
      normalizeSymbol: (s) => s,
    }));
    jest.unstable_mockModule('../../src/journal/normalizeTrade.js', () => ({
      normalizeTradeForWrite: (t) => t,
    }));

    const { placeOrder } = await import('../../src/execution/orderManager.js');
    const writeSpy = jest.spyOn(fs, 'writeFileSync');

    const result = await placeOrder({ decision: valid, dryRun: true });

    expect(result.placed).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(submitMock).not.toHaveBeenCalled();
    expect(createPendingMock).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
