// Protective stop tests — all broker calls are mocks; nothing reaches Alpaca.
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const submitOrder = jest.fn();
const getOrder = jest.fn();
const getOrderByClientId = jest.fn();
const cancelOrderById = jest.fn();

jest.unstable_mockModule('../../src/execution/alpacaTrading.js', () => ({
  submitOrder,
  closePosition: jest.fn(),
  getOpenPositions: jest.fn(),
}));
jest.unstable_mockModule('../../src/execution/alpacaOrders.js', () => ({
  getOrder,
  getOrderByClientId,
  cancelOrderById,
  getOrderHistory: jest.fn(),
  getOpenOrders: jest.fn(async () => []),
  getPositionForSymbol: jest.fn(async () => null),
}));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const {
  isBotOwned,
  findProtectiveOrders,
  describeProtection,
  evaluateProtectionGate,
  ensureProtectiveStop,
  buildProtectiveStopOrder,
  cancelBotStop,
  botStopClientOrderId,
} = await import('../../src/execution/protectiveStops.js');

// The real manual SOL stop-limit placed on 2026-10-19.
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
};

const SOL_POSITION = {
  symbol: 'SOLUSD',
  asset_class: 'crypto',
  qty: 655.337420408,
  qty_available: '0',
  current_price: 105,
  avg_entry_price: -2.380451952,
};

const botTrade = (overrides = {}) => ({
  tradeId: 'trade-1',
  symbol: 'ETH/USD',
  normalizedSymbol: 'ETHUSD',
  assetClass: 'crypto',
  strategyName: 'momentum_breakout_atr_v1',
  status: 'open',
  entryPrice: 3000,
  stopLoss: 2900,
  takeProfit: 3200,
  quantity: 1.5,
  ...overrides,
});

const ethPosition = (overrides = {}) => ({
  symbol: 'ETHUSD',
  asset_class: 'crypto',
  qty: 1.5,
  qty_available: '1.5',
  current_price: 3010,
  ...overrides,
});

beforeEach(() => {
  submitOrder.mockReset();
  getOrder.mockReset();
  getOrderByClientId.mockReset();
  cancelOrderById.mockReset();
});

describe('ownership', () => {
  it('treats the manual SOL stop as external', () => {
    expect(isBotOwned(KOFI_SOL_STOP)).toBe(false);
  });

  it('recognises bot orders and bot bracket legs', () => {
    expect(isBotOwned({ client_order_id: botStopClientOrderId('t1') })).toBe(true);
    expect(isBotOwned({ client_order_id: 'random', parent_client_order_id: 'tb-entry-t1' })).toBe(true);
  });
});

describe('findProtectiveOrders / describeProtection', () => {
  it('matches the SOL/USD stop order to the SOLUSD position', () => {
    expect(findProtectiveOrders([KOFI_SOL_STOP], 'SOLUSD')).toHaveLength(1);
  });

  it('ignores entry, filled and buy-side orders', () => {
    const orders = [
      { ...KOFI_SOL_STOP, status: 'filled' },
      { ...KOFI_SOL_STOP, id: 'x2', side: 'buy' },
      { ...KOFI_SOL_STOP, id: 'x3', type: 'market' },
    ];
    expect(findProtectiveOrders(orders, 'SOLUSD')).toHaveLength(0);
  });

  it('describes the SOL position as actively protected by an external order', () => {
    const p = describeProtection({ brokerPosition: SOL_POSITION, orders: [KOFI_SOL_STOP] });
    expect(p).toMatchObject({
      status: 'active',
      owner: 'external',
      orderId: KOFI_SOL_STOP.id,
      clientOrderId: 'kofi-sol-stop-2026-10-19',
      stopPrice: 99,
      limitPrice: 97,
    });
  });

  it('flags an unfilled stop-limit when price is at or below the stop', () => {
    const p = describeProtection({ brokerPosition: { ...SOL_POSITION, current_price: 96 }, orders: [KOFI_SOL_STOP] });
    expect(p.status).toBe('unfilled');
  });

  it('flags partial coverage', () => {
    const p = describeProtection({ brokerPosition: SOL_POSITION, orders: [{ ...KOFI_SOL_STOP, qty: '100' }] });
    expect(p.status).toBe('partial');
  });

  it('reports a tracked stop as filled, and a canceled one as missing', () => {
    const trade = { protection: { status: 'active', owner: 'bot', orderId: 'o1' } };
    expect(describeProtection({ trade, brokerPosition: SOL_POSITION, orders: [{ id: 'o1', status: 'filled' }] }).status)
      .toBe('filled');
    const missing = describeProtection({ trade, brokerPosition: SOL_POSITION, orders: [{ id: 'o1', status: 'canceled' }] });
    expect(missing.status).toBe('missing');
    expect(missing.lastOrderStatus).toBe('canceled');
  });

  it('reports missing with no stop orders at all', () => {
    expect(describeProtection({ brokerPosition: SOL_POSITION, orders: [] }).status).toBe('missing');
  });
});

describe('evaluateProtectionGate', () => {
  const solTrade = {
    tradeId: 'sol',
    symbol: 'SOLUSD',
    status: 'open',
    entryPriceSource: 'fill_history',
    protection: { status: 'active', owner: 'external' },
  };

  it('allows entries when every position is actively protected', () => {
    expect(evaluateProtectionGate({ openTrades: [solTrade], brokerPositions: [SOL_POSITION] }))
      .toEqual({ allowed: true, reasons: [] });
  });

  it.each([
    ['missing', 'protection_missing'],
    ['failed', 'protection_failed'],
    ['unfilled', 'protection_unfilled'],
    ['partial', 'protection_partial'],
  ])('blocks when protection is %s', (status, reason) => {
    const gate = evaluateProtectionGate({
      openTrades: [{ ...solTrade, protection: { status } }],
      brokerPositions: [SOL_POSITION],
    });
    expect(gate.allowed).toBe(false);
    expect(gate.reasons).toContainEqual({ symbol: 'SOLUSD', reason });
  });

  it('blocks on an untracked position', () => {
    const gate = evaluateProtectionGate({ openTrades: [], brokerPositions: [SOL_POSITION] });
    expect(gate.reasons).toContainEqual({ symbol: 'SOLUSD', reason: 'untracked_position' });
  });

  it('blocks on an unverified entry price', () => {
    const gate = evaluateProtectionGate({
      openTrades: [{ ...solTrade, entryPriceSource: 'unverified' }],
      brokerPositions: [SOL_POSITION],
    });
    expect(gate.reasons).toContainEqual({ symbol: 'SOLUSD', reason: 'entry_unverified' });
  });

  it('fails closed when broker state is unavailable', () => {
    expect(evaluateProtectionGate({ openTrades: [], brokerPositions: [], brokerStateOk: false }).allowed).toBe(false);
  });

  it('blocks while a crypto entry is pending (no stop yet)', () => {
    const gate = evaluateProtectionGate({
      openTrades: [{ tradeId: 'p', symbol: 'ETH/USD', assetClass: 'crypto', status: 'pending' }],
      brokerPositions: [],
    });
    expect(gate.reasons).toContainEqual({ symbol: 'ETH/USD', reason: 'entry_pending_unprotected' });
  });
});

describe('ensureProtectiveStop', () => {
  it('never places a second stop when any stop exists (SOL external order)', async () => {
    const result = await ensureProtectiveStop({
      trade: botTrade({ symbol: 'SOL/USD', normalizedSymbol: 'SOLUSD', stopLoss: 95 }),
      brokerPosition: { ...SOL_POSITION, qty_available: SOL_POSITION.qty },
      orders: [KOFI_SOL_STOP],
    });
    expect(result.action).toBe('already_protected');
    expect(submitOrder).not.toHaveBeenCalled();
  });

  it('never acts on adopted broker_sync positions', async () => {
    const result = await ensureProtectiveStop({
      trade: botTrade({ strategyName: 'broker_sync' }),
      brokerPosition: ethPosition(),
      orders: [],
    });
    expect(result.action).toBe('skipped_external_trade');
    expect(submitOrder).not.toHaveBeenCalled();
  });

  it('skips when quantity is reserved by another order', async () => {
    const result = await ensureProtectiveStop({
      trade: botTrade(),
      brokerPosition: ethPosition({ qty_available: '0' }),
      orders: [],
    });
    expect(result.action).toBe('skipped_reserved');
    expect(submitOrder).not.toHaveBeenCalled();
  });

  it('places a crypto GTC stop_limit with a bot client id and 2% buffer', async () => {
    submitOrder.mockResolvedValue({ id: 'stop-1', client_order_id: 'tb-stop-trade-1', status: 'new', stop_price: '2900', limit_price: '2842', qty: '1.5' });
    const result = await ensureProtectiveStop({ trade: botTrade(), brokerPosition: ethPosition(), orders: [] });

    expect(submitOrder).toHaveBeenCalledTimes(1);
    expect(submitOrder).toHaveBeenCalledWith({
      symbol: 'ETHUSD',
      qty: '1.5',
      side: 'sell',
      assetClass: 'crypto',
      timeInForce: 'gtc',
      clientOrderId: 'tb-stop-trade-1',
      stopPrice: 2900,
      type: 'stop_limit',
      limitPrice: 2842,
    });
    expect(result.action).toBe('placed');
    expect(result.protection).toMatchObject({ status: 'active', owner: 'bot', orderId: 'stop-1' });
  });

  it('uses a plain GTC stop for stocks', () => {
    const order = buildProtectiveStopOrder({
      trade: botTrade({ symbol: 'AAPL', normalizedSymbol: 'AAPL', assetClass: 'stock', stopLoss: 140.123 }),
      brokerPosition: { symbol: 'AAPL', qty: 5 },
    });
    expect(order).toMatchObject({ type: 'stop', stopPrice: 140.12, timeInForce: 'gtc', assetClass: 'stock' });
    expect(order.limitPrice).toBeUndefined();
  });

  it('retries once, then reports failed without selling', async () => {
    submitOrder.mockRejectedValue(new Error('Alpaca API 422: rejected'));
    getOrderByClientId.mockResolvedValue(null);
    const result = await ensureProtectiveStop({ trade: botTrade(), brokerPosition: ethPosition(), orders: [] });

    expect(submitOrder).toHaveBeenCalledTimes(2);
    expect(result.action).toBe('failed');
    expect(result.protection).toMatchObject({ status: 'failed', owner: 'bot', clientOrderId: 'tb-stop-trade-1' });
  });

  it('treats a reused client id that already landed as placed (no second submit)', async () => {
    submitOrder.mockRejectedValueOnce(new Error('Alpaca API 422: client_order_id must be unique'));
    getOrderByClientId.mockResolvedValue({ id: 'stop-9', client_order_id: 'tb-stop-trade-1', status: 'new', stop_price: '2900', limit_price: '2842', qty: '1.5' });
    const result = await ensureProtectiveStop({ trade: botTrade(), brokerPosition: ethPosition(), orders: [] });

    expect(submitOrder).toHaveBeenCalledTimes(1);
    expect(result.action).toBe('placed');
    expect(result.protection.orderId).toBe('stop-9');
  });

  it('does not submit in dry-run mode', async () => {
    const result = await ensureProtectiveStop({ trade: botTrade(), brokerPosition: ethPosition(), orders: [], dryRun: true });
    expect(result.action).toBe('dry_run');
    expect(submitOrder).not.toHaveBeenCalled();
  });

  it('skips when price is already below the stop level', async () => {
    const result = await ensureProtectiveStop({
      trade: botTrade(),
      brokerPosition: ethPosition({ current_price: 2800 }),
      orders: [],
    });
    expect(result.action).toBe('skipped_price_below_stop');
    expect(submitOrder).not.toHaveBeenCalled();
  });
});

describe('cancelBotStop', () => {
  it('refuses to cancel the manual SOL stop', async () => {
    getOrder.mockResolvedValue(KOFI_SOL_STOP);
    await expect(cancelBotStop({ orderId: KOFI_SOL_STOP.id })).rejects.toThrow(/not bot-owned/);
    expect(cancelOrderById).not.toHaveBeenCalled();
  });

  it('cancels a bot stop and confirms it', async () => {
    const own = { ...KOFI_SOL_STOP, id: 'stop-1', client_order_id: 'tb-stop-trade-1' };
    getOrder.mockResolvedValueOnce(own).mockResolvedValueOnce({ ...own, status: 'canceled' });
    cancelOrderById.mockResolvedValue(null);

    await expect(cancelBotStop({ orderId: 'stop-1' })).resolves.toEqual({ canceled: true, reason: undefined });
    expect(cancelOrderById).toHaveBeenCalledWith('stop-1');
  });

  it('reports an unconfirmed cancel', async () => {
    const own = { ...KOFI_SOL_STOP, id: 'stop-1', client_order_id: 'tb-stop-trade-1' };
    getOrder.mockResolvedValueOnce(own).mockResolvedValueOnce({ ...own, status: 'new' });
    const result = await cancelBotStop({ orderId: 'stop-1' });
    expect(result.canceled).toBe(false);
  });
});
