// Tests for canonical_execution_spec.md
// Covers: canonical decision output, single execution path, validation guards,
// dry-run safety, and legacy alias resolution in orderManager.
//
// Legacy read compat + canonical write contract are covered in
// tests/journal/normalizeTrade.test.js (static imports, no mocking needed).
import fs from 'node:fs';
import path from 'node:path';
import { jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Canonical decision contract — source-level checks on autopilot.js
// ---------------------------------------------------------------------------
describe('buildDecision() — canonical decision shape', () => {
  it('emits canonical field names', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/autopilot.js'), 'utf8');

    for (const field of ['strategyName', 'entryPrice', 'stopLoss', 'takeProfit', 'quantity',
      'riskAmount', 'normalizedSymbol', 'assetClass', 'metrics', 'closePrice']) {
      expect(src).toMatch(field);
    }
  });

  it('does not assign legacy fields as return-object keys in buildDecision', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/autopilot.js'), 'utf8');

    const fnStart = src.indexOf('function buildDecision(');
    const fnEnd = src.indexOf('\nfunction ', fnStart + 1);
    const fnBody = src.slice(fnStart, fnEnd);

    expect(fnBody).not.toMatch(/^\s+strategy:/m);
    expect(fnBody).not.toMatch(/^\s+stop:/m);
    expect(fnBody).not.toMatch(/^\s+target:/m);
    expect(fnBody).not.toMatch(/^\s+risk:/m);
    expect(fnBody).not.toMatch(/^\s+qty:/m);
  });
});

// ---------------------------------------------------------------------------
// 2. Single execution path — source-level checks
// ---------------------------------------------------------------------------
describe('single execution path', () => {
  it('placeOrder.js delegates to orderManager — no independent broker calls', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/execution/placeOrder.js'),
      'utf8'
    );

    expect(src).toMatch(/from ['"]\.\/orderManager\.js['"]/);
    expect(src).not.toMatch(/submitOrder/);
    expect(src).not.toMatch(/alpacaTrading/);
    expect(src).not.toMatch(/alpaca\.js/);
  });

  it('autopilot imports placeOrder from orderManager, not placeOrder.js', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/autopilot.js'), 'utf8');

    expect(src).toMatch(/import\s*\{\s*placeOrder\s*\}\s*from\s*['"]\.\/execution\/orderManager\.js['"]/u);
    expect(src).not.toMatch(/from\s*['"]\.\/execution\/placeOrder\.js['"]/u);
  });

  it('autopilot calls placeOrder with canonical { decision, dryRun } object', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/autopilot.js'), 'utf8');

    expect(src).toMatch(/placeOrder\(\s*\{\s*decision\s*,\s*dryRun\s*\}/);
  });
});

// ---------------------------------------------------------------------------
// Shared mock setup for orderManager tests
// ---------------------------------------------------------------------------
async function setupOrderManagerMocks({ submitOrderImpl } = {}) {
  jest.unstable_mockModule('../../src/execution/alpacaTrading.js', () => ({
    submitOrder: submitOrderImpl ?? jest.fn(async () => ({ id: 'x', status: 'accepted' })),
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
    normalizeSymbol: (s) => s,
  }));
  jest.unstable_mockModule('../../src/journal/normalizeTrade.js', () => ({
    normalizeTradeForWrite: (t) => t,
  }));

  const { placeOrder } = await import('../../src/execution/orderManager.js');
  return placeOrder;
}

// ---------------------------------------------------------------------------
// 3. Validation guards
// ---------------------------------------------------------------------------
describe('orderManager.placeOrder — validation guards', () => {
  const valid = { symbol: 'AAPL', approved: true, entryPrice: 150, stopLoss: 140, takeProfit: 165, quantity: 5 };

  it('throws when entryPrice is 0', async () => {
    const placeOrder = await setupOrderManagerMocks();
    await expect(placeOrder({ decision: { ...valid, entryPrice: 0 }, dryRun: false }))
      .rejects.toThrow('entryPrice must be > 0');
  });

  it('throws when entryPrice is negative', async () => {
    const placeOrder = await setupOrderManagerMocks();
    await expect(placeOrder({ decision: { ...valid, entryPrice: -10 }, dryRun: false }))
      .rejects.toThrow('entryPrice must be > 0');
  });

  it('throws when stopLoss is 0', async () => {
    const placeOrder = await setupOrderManagerMocks();
    await expect(placeOrder({ decision: { ...valid, stopLoss: 0 }, dryRun: false }))
      .rejects.toThrow('stopLoss must be > 0');
  });

  it('throws when takeProfit is 0', async () => {
    const placeOrder = await setupOrderManagerMocks();
    await expect(placeOrder({ decision: { ...valid, takeProfit: 0 }, dryRun: false }))
      .rejects.toThrow('takeProfit must be > 0');
  });

  it('throws when quantity is 0', async () => {
    const placeOrder = await setupOrderManagerMocks();
    await expect(placeOrder({ decision: { ...valid, quantity: 0 }, dryRun: false }))
      .rejects.toThrow('quantity must be > 0');
  });

  it('throws when stopLoss equals entryPrice', async () => {
    const placeOrder = await setupOrderManagerMocks();
    await expect(placeOrder({ decision: { ...valid, stopLoss: 150 }, dryRun: false }))
      .rejects.toThrow('stopLoss must be < entryPrice');
  });

  it('throws when stopLoss exceeds entryPrice', async () => {
    const placeOrder = await setupOrderManagerMocks();
    await expect(placeOrder({ decision: { ...valid, stopLoss: 160 }, dryRun: false }))
      .rejects.toThrow('stopLoss must be < entryPrice');
  });

  it('throws when takeProfit equals entryPrice', async () => {
    const placeOrder = await setupOrderManagerMocks();
    await expect(placeOrder({ decision: { ...valid, takeProfit: 150 }, dryRun: false }))
      .rejects.toThrow('takeProfit must be > entryPrice');
  });

  it('throws when takeProfit is below entryPrice', async () => {
    const placeOrder = await setupOrderManagerMocks();
    await expect(placeOrder({ decision: { ...valid, takeProfit: 145 }, dryRun: false }))
      .rejects.toThrow('takeProfit must be > entryPrice');
  });
});

// ---------------------------------------------------------------------------
// 4. Dry-run safety
// ---------------------------------------------------------------------------
describe('dry-run safety', () => {
  it('does not call broker or write storage in dry-run mode', async () => {
    const submitMock = jest.fn();
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
    const createPendingMock = jest.fn();
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
    const fsSpy = jest.spyOn(fs, 'writeFileSync');

    const result = await placeOrder({
      decision: { symbol: 'AAPL', approved: true, entryPrice: 150, stopLoss: 140, takeProfit: 165, quantity: 5 },
      dryRun: true,
    });

    expect(result.placed).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(submitMock).not.toHaveBeenCalled();
    expect(createPendingMock).not.toHaveBeenCalled();
    expect(fsSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. Legacy alias resolution — orderManager strips legacy keys before journal
// ---------------------------------------------------------------------------
describe('orderManager.placeOrder — legacy alias resolution', () => {
  it('resolves stop/target/qty/risk/strategy before passing to journal', async () => {
    const createPendingMock = jest.fn(async (opts) => ({ tradeId: 't-1', ...opts.decision }));

    jest.unstable_mockModule('../../src/execution/alpacaTrading.js', () => ({
      submitOrder: jest.fn(async () => ({ id: 'b-1', status: 'accepted' })),
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
      markTradeOpen: jest.fn(async () => ({})),
      markTradeCanceled: jest.fn(async () => ({})),
      getOpenTradeById: jest.fn(async () => null),
      removeOpenTrade: jest.fn(async () => {}),
      addClosedTrade: jest.fn(async () => {}),
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

    await placeOrder({
      decision: {
        symbol: 'TSLA',
        approved: true,
        entryPrice: 200,
        stop: 190,
        target: 220,
        qty: 3,
        risk: 30,
        strategy: 'breakout',
      },
      dryRun: false,
    });

    const journalDecision = createPendingMock.mock.calls[0][0].decision;

    // canonical fields resolved correctly
    expect(journalDecision.stopLoss).toBe(190);
    expect(journalDecision.takeProfit).toBe(220);
    expect(journalDecision.quantity).toBe(3);
    expect(journalDecision.riskAmount).toBe(30);
    expect(journalDecision.strategyName).toBe('breakout');

    // legacy aliases must not be present on the clean canonical object
    expect(journalDecision).not.toHaveProperty('stop');
    expect(journalDecision).not.toHaveProperty('target');
    expect(journalDecision).not.toHaveProperty('qty');
    expect(journalDecision).not.toHaveProperty('risk');
    expect(journalDecision).not.toHaveProperty('strategy');
  });
});
