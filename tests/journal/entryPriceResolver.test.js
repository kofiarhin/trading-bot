import { describe, it, expect } from '@jest/globals';
import {
  isValidPrice,
  resolveEntryFromFills,
  resolveEntryPrice,
} from '../../src/journal/entryPriceResolver.js';

// Mirrors the live SOL/USD paper history: repeated round trips left Alpaca
// reporting a negative avg_entry_price for the current position.
const SOL_FILLS = [
  { symbol: 'SOL/USD', side: 'buy', status: 'filled', filled_qty: '656.51915489', filled_avg_price: '76.135662261', filled_at: '2026-08-17T06:51:05Z' },
  { symbol: 'SOL/USD', side: 'sell', status: 'filled', filled_qty: '572.461899057', filled_avg_price: '76.61379007', filled_at: '2026-08-09T21:01:52Z' },
  { symbol: 'SOL/USD', side: 'buy', status: 'filled', filled_qty: '573.4941886', filled_avg_price: '77.593453723', filled_at: '2026-08-09T20:50:44Z' },
];

const SOL_POSITION = {
  symbol: 'SOLUSD',
  qty: '655.337420408',
  avg_entry_price: '-2.380451952',
  current_price: '105',
};

describe('isValidPrice', () => {
  it('accepts only finite positive numbers', () => {
    expect(isValidPrice(76.1)).toBe(true);
    expect(isValidPrice('76.1')).toBe(true);
    expect(isValidPrice(-2.38)).toBe(false);
    expect(isValidPrice(0)).toBe(false);
    expect(isValidPrice(null)).toBe(false);
    expect(isValidPrice('abc')).toBe(false);
  });
});

describe('resolveEntryFromFills', () => {
  it('rebuilds the SOL entry from the buy since the last sell (~$76.14)', () => {
    const result = resolveEntryFromFills({ fills: SOL_FILLS, symbol: 'SOLUSD', positionQty: 655.337420408 });
    expect(result).not.toBeNull();
    expect(result.price).toBeCloseTo(76.1357, 3);
    expect(result.source).toBe('fill_history');
    expect(result.fillCount).toBe(1);
  });

  it('weights multiple buys since the last sell', () => {
    const fills = [
      { symbol: 'BTC/USD', side: 'buy', filled_qty: '1', filled_avg_price: '100', filled_at: '2026-01-03T00:00:00Z' },
      { symbol: 'BTC/USD', side: 'buy', filled_qty: '3', filled_avg_price: '200', filled_at: '2026-01-02T00:00:00Z' },
      { symbol: 'BTC/USD', side: 'sell', filled_qty: '5', filled_avg_price: '150', filled_at: '2026-01-01T00:00:00Z' },
    ];
    const result = resolveEntryFromFills({ fills, symbol: 'BTCUSD', positionQty: 4 });
    expect(result.price).toBeCloseTo(175, 6);
    expect(result.fillCount).toBe(2);
  });

  it('returns null when buys since the last sell do not cover the position', () => {
    const fills = [
      { symbol: 'SOL/USD', side: 'buy', filled_qty: '100', filled_avg_price: '80', filled_at: '2026-08-17T00:00:00Z' },
      { symbol: 'SOL/USD', side: 'sell', filled_qty: '50', filled_avg_price: '79', filled_at: '2026-08-16T00:00:00Z' },
      { symbol: 'SOL/USD', side: 'buy', filled_qty: '600', filled_avg_price: '70', filled_at: '2026-08-15T00:00:00Z' },
    ];
    expect(resolveEntryFromFills({ fills, symbol: 'SOLUSD', positionQty: 650 })).toBeNull();
  });

  it('ignores unfilled orders and other symbols', () => {
    const fills = [
      { symbol: 'SOL/USD', side: 'sell', status: 'new', type: 'stop_limit', filled_qty: '0', filled_avg_price: null, submitted_at: '2026-10-19T02:31:32Z' },
      { symbol: 'ETH/USD', side: 'sell', filled_qty: '1', filled_avg_price: '3000', filled_at: '2026-09-01T00:00:00Z' },
      ...SOL_FILLS,
    ];
    const result = resolveEntryFromFills({ fills, symbol: 'SOL/USD', positionQty: 655.337420408 });
    expect(result.price).toBeCloseTo(76.1357, 3);
  });

  it('returns null with no history or no quantity', () => {
    expect(resolveEntryFromFills({ fills: [], symbol: 'SOLUSD', positionQty: 1 })).toBeNull();
    expect(resolveEntryFromFills({ fills: SOL_FILLS, symbol: 'SOLUSD', positionQty: 0 })).toBeNull();
  });
});

describe('resolveEntryPrice', () => {
  it('uses a valid broker average as-is', () => {
    expect(resolveEntryPrice({ brokerPosition: { ...SOL_POSITION, avg_entry_price: '90' }, fills: SOL_FILLS }))
      .toEqual({ price: 90, source: 'broker' });
  });

  it('falls back to fill history when the broker average is negative', () => {
    const result = resolveEntryPrice({ brokerPosition: SOL_POSITION, fills: SOL_FILLS });
    expect(result.source).toBe('fill_history');
    expect(result.price).toBeCloseTo(76.1357, 3);
  });

  it('reports unverified instead of guessing', () => {
    expect(resolveEntryPrice({ brokerPosition: SOL_POSITION, fills: [] }))
      .toEqual({ price: null, source: 'unverified' });
  });
});
