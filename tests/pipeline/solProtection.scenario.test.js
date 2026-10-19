/**
 * SOL protection scenario — replays the live 2026-10-19 state against the real
 * journal, exit engine, order manager and risk code.
 *
 *   - Alpaca reports a negative avg_entry_price (-2.38) for 655.337420408 SOL.
 *   - The journal holds an adopted broker_sync record with that bad entry.
 *   - A manual GTC stop-limit (stop $99 / limit $97) reserves the whole position.
 *
 * In-memory MongoDB; every Alpaca call is a mock. The bot must never place,
 * cancel or close anything for this position.
 */
import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';

import { clearMongoHarness, startMongoHarness, stopMongoHarness } from '../helpers/mongoHarness.js';

const submitOrder = jest.fn();
const closePosition = jest.fn();
const getOpenPositions = jest.fn();
const getOrder = jest.fn();
const getOrderByClientId = jest.fn();
const cancelOrderById = jest.fn();

jest.unstable_mockModule('../../src/execution/alpacaTrading.js', () => ({
  submitOrder,
  closePosition,
  getOpenPositions,
  getAccount: jest.fn(),
  getPosition: jest.fn(),
}));
jest.unstable_mockModule('../../src/execution/alpacaOrders.js', () => ({
  getOrder,
  getOrderByClientId,
  cancelOrderById,
  getOrderHistory: jest.fn(),
}));

const KOFI_SOL_STOP = {
  id: '58a7be32-4edb-40e6-a9cc-9e3fcbd4fe6a',
  client_order_id: 'kofi-sol-stop-2026-10-19',
  symbol: 'SOL/USD',
  side: 'sell',
  type: 'stop_limit',
  qty: '655.337420408',
  filled_qty: '0',
  stop_price: '99',
  limit_price: '97',
  time_in_force: 'gtc',
  status: 'new',
  submitted_at: '2026-10-19T02:31:32Z',
};

const SOL_FILLS = [
  { id: 'f3', symbol: 'SOL/USD', side: 'buy', type: 'market', status: 'filled', filled_qty: '656.51915489', filled_avg_price: '76.135662261', filled_at: '2026-08-17T06:51:05Z' },
  { id: 'f2', symbol: 'SOL/USD', side: 'sell', type: 'market', status: 'filled', filled_qty: '572.461899057', filled_avg_price: '76.61379007', filled_at: '2026-08-09T21:01:52Z' },
];

// Shape produced by lib/alpaca.js getPositions() (numbers normalized, rest raw).
function solPosition(overrides = {}) {
  return {
    symbol: 'SOLUSD',
    asset_class: 'crypto',
    side: 'long',
    qty: 655.337420408,
    qty_available: '0',
    avg_entry_price: -2.380451952,
    current_price: 105,
    market_value: 68810,
    unrealized_pl: 70370,
    ...overrides,
  };
}

// Raw shape returned by alpacaTrading.getOpenPositions().
function rawSolPosition(overrides = {}) {
  return {
    symbol: 'SOLUSD',
    asset_class: 'crypto',
    qty: '655.337420408',
    qty_available: '0',
    avg_entry_price: '-2.380451952',
    current_price: '105',
    unrealized_pl: '70370',
    market_value: '68810',
    ...overrides,
  };
}

let journal;
let repo;
let exits;
let orderManager;
let protective;
let portfolio;
let enricher;

beforeAll(async () => {
  await startMongoHarness('sol-protection-scenario');
  journal = await import('../../src/journal/tradeJournal.js');
  repo = await import('../../src/repositories/tradeJournalRepo.mongo.js');
  exits = await import('../../src/positions/exitEngine.js');
  orderManager = await import('../../src/execution/orderManager.js');
  protective = await import('../../src/execution/protectiveStops.js');
  portfolio = await import('../../src/risk/portfolioRisk.js');
  enricher = await import('../../src/journal/positionEnricher.js');
});

afterAll(async () => {
  await stopMongoHarness();
});

beforeEach(async () => {
  await clearMongoHarness();
  for (const fn of [submitOrder, closePosition, getOpenPositions, getOrder, getOrderByClientId, cancelOrderById]) {
    fn.mockReset();
  }
  // Copy of the live adopted record (bad entry, no stop).
  await repo.upsertOpenTrade({
    tradeId: 'fab46894-a0d0-432a-8614-376bef1e6366',
    symbol: 'SOLUSD',
    normalizedSymbol: 'SOLUSD',
    strategyName: 'broker_sync',
    status: 'open',
    entryPrice: -2.380451952,
    quantity: 655.337420408,
    riskAmount: 0,
    stopLoss: null,
    takeProfit: null,
    barsHeld: 1,
    openedAt: '2026-10-19T01:58:39.369Z',
    metrics: { closePrice: 0, breakoutLevel: 0, atr: 0, volumeRatio: 0, distanceToBreakoutPct: 0 },
  });
});

function expectNoBrokerWrites() {
  expect(submitOrder).not.toHaveBeenCalled();
  expect(closePosition).not.toHaveBeenCalled();
  expect(cancelOrderById).not.toHaveBeenCalled();
}

async function syncSol({ position = solPosition(), orders = [KOFI_SOL_STOP], history = SOL_FILLS } = {}) {
  const fillHistoryForSymbol = jest.fn(async () => history);
  await journal.syncTradesWithBroker({ brokerPositions: [position], brokerOrders: orders, fillHistoryForSymbol });
  return fillHistoryForSymbol;
}

describe('SOL protection scenario', () => {
  it('repairs the entry price from fill history and detects the external stop', async () => {
    const fillHistory = await syncSol();

    const trades = await journal.getOpenTrades();
    expect(trades).toHaveLength(1);
    const [sol] = trades;
    expect(sol.entryPrice).toBeCloseTo(76.1357, 3);
    expect(sol.entryPriceSource).toBe('fill_history');
    expect(sol.protection).toMatchObject({
      status: 'active',
      owner: 'external',
      orderId: KOFI_SOL_STOP.id,
      clientOrderId: 'kofi-sol-stop-2026-10-19',
      stopPrice: 99,
      limitPrice: 97,
    });
    expect(fillHistory).toHaveBeenCalledTimes(1);
    expectNoBrokerWrites();
  });

  it('is idempotent across restarts — no duplicate records or orders', async () => {
    await syncSol();
    await syncSol();
    await syncSol();

    expect(await journal.getOpenTrades()).toHaveLength(1);
    const events = (await journal.getTradeEvents()).filter((e) => e.type === 'protection_status_changed');
    expect(events).toHaveLength(1);
    expectNoBrokerWrites();
  });

  it('runs no bot exits on the externally protected position at any price', async () => {
    await syncSol();
    const trades = await journal.getOpenTrades();

    for (const price of ['300', '105', '50']) {
      getOpenPositions.mockResolvedValue([rawSolPosition({ current_price: price })]);
      expect(await exits.evaluateExits(trades)).toEqual([]);
    }
    expectNoBrokerWrites();
  });

  it('skips exits for the external stop alone (even if quantity were not reserved)', async () => {
    await syncSol();
    const trades = await journal.getOpenTrades();
    getOpenPositions.mockResolvedValue([rawSolPosition({ current_price: '50', qty_available: '655.337420408' })]);
    expect(await exits.evaluateExits(trades)).toEqual([]);
  });

  it('skips exits for reserved quantity alone (no protection recorded)', async () => {
    const trade = {
      tradeId: 'reserved-1',
      symbol: 'SOLUSD',
      normalizedSymbol: 'SOLUSD',
      strategyName: 'momentum_breakout_atr_v1',
      status: 'open',
      entryPrice: 100,
      stopLoss: 90,
      takeProfit: 120,
      quantity: 655.337420408,
    };
    getOpenPositions.mockResolvedValue([rawSolPosition({ current_price: '50' })]);
    expect(await exits.evaluateExits([trade])).toEqual([]);
    const events = (await journal.getTradeEvents()).filter((e) => e.type === 'exit_skipped_reserved');
    expect(events).toHaveLength(1);
  });

  it('refuses a close request without touching the broker', async () => {
    await syncSol();
    const [sol] = await journal.getOpenTrades();

    const result = await orderManager.closeTrade({
      tradeId: sol.tradeId,
      symbol: 'SOLUSD',
      exitPrice: 105,
      reason: 'take_profit',
      dryRun: false,
    });

    expect(result).toMatchObject({ closed: false, error: 'externally_protected' });
    expect(await journal.getOpenTrades()).toHaveLength(1);
    expect(getOrder).not.toHaveBeenCalled();
    expectNoBrokerWrites();
  });

  it('never places a bot stop for the adopted position', async () => {
    await syncSol();
    const [sol] = await journal.getOpenTrades();

    const result = await protective.ensureProtectiveStop({
      trade: sol,
      brokerPosition: solPosition(),
      orders: [KOFI_SOL_STOP],
    });
    expect(result.action).toBe('skipped_external_trade');
    expectNoBrokerWrites();
  });

  it('shows the broker stop on the dashboard enrichment', async () => {
    await syncSol();
    const [sol] = await journal.getOpenTrades();
    const enriched = enricher.enrichPosition(sol, solPosition());
    expect(enriched).toMatchObject({ managementStatus: 'broker_protected', stopLoss: 99, riskSource: 'broker' });
  });

  it('passes the protection gate but blocks new entries on the total-risk cap', async () => {
    await syncSol();
    const openTrades = await journal.getOpenTrades();
    const positions = [solPosition()];

    expect(protective.evaluateProtectionGate({ openTrades, brokerPositions: positions }).allowed).toBe(true);

    // (105 − 97) × 655.337… ≈ $5,243 = 7.4% of equity, above the 5% cap.
    expect(portfolio.openRiskForTrade(openTrades[0], positions[0])).toBeCloseTo(5242.7, 0);
    const result = portfolio.checkPortfolioRisk({
      candidates: [{ symbol: 'ETH/USD', assetClass: 'crypto', riskAmount: 50 }],
      openTrades,
      brokerPositions: positions,
      accountEquity: 70407.97,
      riskState: { dailyRealizedLoss: 0 },
      riskConfig: { maxTotalRiskPct: 5, maxCorrelatedPositions: 3, drawdownThrottlePct: 1, dailyLossLimitPct: 2 },
    });
    expect(result.allowed).toHaveLength(0);
    expect(result.blocked[0].reason).toBe('total_risk_cap');
  });

  it('alerts and blocks entries when the stop-limit is triggered but unfilled — no selling', async () => {
    await syncSol({ position: solPosition({ current_price: 96 }) });
    const openTrades = await journal.getOpenTrades();

    expect(openTrades[0].protection.status).toBe('unfilled');
    const gate = protective.evaluateProtectionGate({ openTrades, brokerPositions: [solPosition({ current_price: 96 })] });
    expect(gate.allowed).toBe(false);
    expect(gate.reasons).toContainEqual({ symbol: 'SOLUSD', reason: 'protection_unfilled' });
    expectNoBrokerWrites();
  });

  it('flags the position unprotected if the external stop disappears — and still never re-places it', async () => {
    await syncSol();
    await syncSol({ orders: [{ ...KOFI_SOL_STOP, status: 'canceled' }], position: solPosition({ qty_available: '655.337420408' }) });
    const openTrades = await journal.getOpenTrades();

    expect(openTrades[0].protection.status).toBe('missing');
    expect(protective.evaluateProtectionGate({ openTrades, brokerPositions: [solPosition()] }).allowed).toBe(false);

    const result = await protective.ensureProtectiveStop({
      trade: openTrades[0],
      brokerPosition: solPosition({ qty_available: '655.337420408' }),
      orders: [],
    });
    expect(result.action).toBe('skipped_external_trade');
    expectNoBrokerWrites();
  });

  it('keeps the entry unverified (and blocks entries) when history cannot prove it', async () => {
    await syncSol({ history: [] });
    const openTrades = await journal.getOpenTrades();

    expect(openTrades[0].entryPriceSource).toBe('unverified');
    expect(openTrades[0].entryPrice).toBe(-2.380451952);
    const gate = protective.evaluateProtectionGate({ openTrades, brokerPositions: [solPosition()] });
    expect(gate.reasons).toContainEqual({ symbol: 'SOLUSD', reason: 'entry_unverified' });
    expectNoBrokerWrites();
  });
});
