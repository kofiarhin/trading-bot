import { beforeEach, describe, expect, it, jest } from '@jest/globals';

async function setupAutopilot({ accountError = null } = {}) {
  jest.resetModules();
  jest.clearAllMocks();

  const appendCycleEvent = jest.fn(async () => null);
  const startCycleRuntime = jest.fn(async () => ({ status: 'running' }));
  const updateCycleRuntime = jest.fn(async () => ({ status: 'running' }));
  const completeCycleRuntime = jest.fn(async () => ({ status: 'completed' }));
  const failCycleRuntime = jest.fn(async () => ({ status: 'failed' }));

  jest.unstable_mockModule('../../src/lib/alpaca.js', () => ({
    getAccount: jest.fn(async () => {
      if (accountError) throw accountError;
      return { equity: '100000' };
    }),
    getBarsForSymbols: jest.fn(async () => ({ AAPL: [] })),
    getOrders: jest.fn(async () => []),
    getPositions: jest.fn(async () => []),
    isDryRunEnabled: jest.fn(() => true),
  }));

  jest.unstable_mockModule('../../src/db/connectMongo.js', () => ({
    connectMongo: jest.fn(),
    disconnectMongo: jest.fn(),
  }));

  jest.unstable_mockModule('../../src/execution/orderManager.js', () => ({
    placeOrder: jest.fn(async () => ({ placed: false, dryRun: true, message: 'dry run' })),
    closeTrade: jest.fn(async () => null),
  }));

  jest.unstable_mockModule('../../src/market/alpacaMarketData.js', () => ({
    fetchCryptoBars: jest.fn(async () => []),
  }));

  jest.unstable_mockModule('../../src/market/universe.js', () => ({
    getUniverse: jest.fn(() => [{ symbol: 'AAPL' }]),
  }));

  jest.unstable_mockModule('../../src/lib/storage.js', () => ({
    nowIso: jest.fn(() => '2026-04-13T12:00:00.000Z'),
  }));

  jest.unstable_mockModule('../../src/utils/time.js', () => ({
    resolveSession: jest.fn(() => ({ session: 'us', allowCrypto: true, allowStocks: true })),
  }));

  jest.unstable_mockModule('../../src/market/marketHours.js', () => ({
    filterEligible: jest.fn((entries) => entries),
  }));

  jest.unstable_mockModule('../../src/journal/tradeJournal.js', () => ({
    getOpenTrades: jest.fn(async () => []),
    syncTradesWithBroker: jest.fn(async () => null),
  }));

  jest.unstable_mockModule('../../src/repositories/decisionRepo.mongo.js', () => ({
    saveDecision: jest.fn(async () => null),
  }));

  jest.unstable_mockModule('../../src/repositories/cycleRepo.mongo.js', () => ({
    appendCycleEvent,
  }));

  jest.unstable_mockModule('../../src/risk/riskState.js', () => ({
    loadRiskState: jest.fn(async () => ({ dailyRealizedLoss: 0, halted: false })),
  }));

  jest.unstable_mockModule('../../src/positions/positionMonitor.js', () => ({
    checkOpenTradesForExit: jest.fn(async () => []),
  }));

  jest.unstable_mockModule('../../src/strategies/breakoutStrategy.js', () => ({
    evaluateBreakout: jest.fn(({ symbol }) => ({
      timestamp: '2026-04-13T12:00:00.000Z',
      symbol,
      approved: false,
      reason: 'no_breakout',
      strategyName: 'breakout',
      metrics: { closePrice: 100 },
    })),
  }));

  jest.unstable_mockModule('../../src/repositories/cycleRuntimeRepo.mongo.js', () => ({
    startCycleRuntime,
    updateCycleRuntime,
    completeCycleRuntime,
    failCycleRuntime,
    CycleAlreadyRunningError: class CycleAlreadyRunningError extends Error {},
  }));

  const { runAutopilotCycle } = await import('../../src/autopilot.js');

  return {
    runAutopilotCycle,
    startCycleRuntime,
    updateCycleRuntime,
    completeCycleRuntime,
    failCycleRuntime,
    appendCycleEvent,
  };
}

describe('autopilot runtime lifecycle', () => {
  beforeEach(() => {
    process.env.AUTOPILOT_SYMBOLS = 'AAPL';
  });

  it('marks runtime completed after successful cycle', async () => {
    const { runAutopilotCycle, completeCycleRuntime, failCycleRuntime } = await setupAutopilot();

    const result = await runAutopilotCycle();

    expect(result.status).toBe('completed');
    expect(completeCycleRuntime).toHaveBeenCalledTimes(1);
    expect(failCycleRuntime).not.toHaveBeenCalled();
  });

  it('marks runtime failed when cycle throws', async () => {
    const { runAutopilotCycle, failCycleRuntime, completeCycleRuntime } = await setupAutopilot({
      accountError: new Error('broker unavailable'),
    });

    await expect(runAutopilotCycle()).rejects.toThrow('broker unavailable');
    expect(failCycleRuntime).toHaveBeenCalledTimes(1);
    expect(completeCycleRuntime).not.toHaveBeenCalled();
  });
});
