import fs from 'node:fs';
import { jest } from '@jest/globals';

describe('canonical orderManager.placeOrder', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('delegates entry execution through the canonical order manager path', async () => {
    const legacyEntryExecutor = jest.fn(async (trade, options) => ({
      ...trade,
      status: options?.dryRun ? 'dry-run' : 'open',
    }));

    jest.unstable_mockModule('../../src/execution/placeOrder.js', () => ({
      default: legacyEntryExecutor,
    }));

    const { placeOrder } = await import('../../src/execution/orderManager.js');

    const result = await placeOrder(
      {
        id: 'trade-2',
        symbol: 'tsla',
        strategy: 'breakout',
        entryPrice: 200,
        stop: 190,
        target: 220,
        qty: 3,
        risk: 30,
      },
      { dryRun: true }
    );

    expect(legacyEntryExecutor).toHaveBeenCalledTimes(1);
    expect(legacyEntryExecutor).toHaveBeenCalledWith(
      expect.objectContaining({
        tradeId: 'trade-2',
        strategyName: 'breakout',
        stopLoss: 190,
        takeProfit: 220,
        quantity: 3,
        riskAmount: 30,
      }),
      expect.objectContaining({ dryRun: true })
    );

    const delegatedTrade = legacyEntryExecutor.mock.calls[0][0];
    expect(delegatedTrade).not.toHaveProperty('stop');
    expect(delegatedTrade).not.toHaveProperty('target');
    expect(delegatedTrade).not.toHaveProperty('qty');
    expect(delegatedTrade).not.toHaveProperty('risk');
    expect(delegatedTrade).not.toHaveProperty('strategy');

    expect(result).toMatchObject({
      tradeId: 'trade-2',
      strategyName: 'breakout',
      stopLoss: 190,
      takeProfit: 220,
      quantity: 3,
      riskAmount: 30,
      status: 'dry-run',
    });
  });

  it('keeps the wrapper dry-run path side-effect free', async () => {
    const legacyEntryExecutor = jest.fn(async (trade) => ({
      ...trade,
      status: 'dry-run',
    }));

    jest.unstable_mockModule('../../src/execution/placeOrder.js', () => ({
      default: legacyEntryExecutor,
    }));

    const { placeOrder } = await import('../../src/execution/orderManager.js');
    const writeSpy = jest.spyOn(fs, 'writeFileSync');

    await placeOrder(
      {
        id: 'trade-3',
        symbol: 'spy',
        strategy: 'breakout',
        entryPrice: 500,
        stop: 495,
        target: 510,
        qty: 1,
        risk: 5,
      },
      { dryRun: true }
    );

    expect(legacyEntryExecutor).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ dryRun: true })
    );
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
