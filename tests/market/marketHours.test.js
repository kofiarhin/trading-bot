/**
 * Tests for isEligibleNow() and filterEligible() in src/market/marketHours.js,
 * and an integration test that proves runtime symbol filtering matches the
 * intended per-session behaviour.
 *
 * Timestamps use January 2026 (winter — no DST) for clean, predictable boundaries.
 * See tests/market/sessionResolver.test.js for the UTC reference table.
 */

import { describe, it, expect, afterEach } from '@jest/globals';
import { isEligibleNow, filterEligible } from '../../src/market/marketHours.js';

const MON = '2026-01-05';

function utc(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}Z`);
}

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const STOCK_ENTRY = { symbol: 'AAPL', assetClass: 'stock' };
const CRYPTO_ENTRY = { symbol: 'BTC/USD', assetClass: 'crypto' };
const MIXED_UNIVERSE = [STOCK_ENTRY, CRYPTO_ENTRY];

// ─── isEligibleNow ─────────────────────────────────────────────────────────────

describe('isEligibleNow', () => {
  afterEach(() => {
    delete process.env.SKIP_MARKET_HOURS;
  });

  it('crypto is always eligible regardless of session', () => {
    const timestamps = [
      utc(MON, '02:00:00'), // TOKYO
      utc(MON, '10:00:00'), // LONDON
      utc(MON, '15:00:00'), // OVERLAP
      utc(MON, '17:00:00'), // NEW_YORK
      utc(MON, '22:00:00'), // CRYPTO_ONLY
    ];
    for (const ts of timestamps) {
      expect(isEligibleNow('crypto', ts)).toBe(true);
    }
  });

  it('stocks are ineligible outside the New York session', () => {
    expect(isEligibleNow('stock', utc(MON, '02:00:00'))).toBe(false); // TOKYO
    expect(isEligibleNow('stock', utc(MON, '10:00:00'))).toBe(false); // LONDON
    expect(isEligibleNow('stock', utc(MON, '22:00:00'))).toBe(false); // CRYPTO_ONLY
  });

  it('stocks are eligible during the New York session', () => {
    expect(isEligibleNow('stock', utc(MON, '17:00:00'))).toBe(true); // NEW_YORK
  });

  it('stocks are eligible during the London/New York overlap', () => {
    expect(isEligibleNow('stock', utc(MON, '15:00:00'))).toBe(true); // OVERLAP
  });
});

// ─── filterEligible ────────────────────────────────────────────────────────────

describe('filterEligible', () => {
  afterEach(() => {
    delete process.env.SKIP_MARKET_HOURS;
  });

  it('Tokyo session — only crypto symbols pass', () => {
    const result = filterEligible(MIXED_UNIVERSE, utc(MON, '02:00:00'));
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('BTC/USD');
  });

  it('London session — only crypto symbols pass', () => {
    const result = filterEligible(MIXED_UNIVERSE, utc(MON, '10:00:00'));
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('BTC/USD');
  });

  it('New York session — crypto and stock symbols both pass', () => {
    const result = filterEligible(MIXED_UNIVERSE, utc(MON, '17:00:00'));
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.symbol)).toContain('AAPL');
    expect(result.map((e) => e.symbol)).toContain('BTC/USD');
  });

  it('London/New York overlap — crypto and stocks pass in a single pass (no duplicates)', () => {
    const result = filterEligible(MIXED_UNIVERSE, utc(MON, '15:00:00'));
    expect(result).toHaveLength(2);
    // Verify each entry appears exactly once
    const symbols = result.map((e) => e.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it('CRYPTO_ONLY session — only crypto symbols pass', () => {
    const result = filterEligible(MIXED_UNIVERSE, utc(MON, '22:00:00'));
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('BTC/USD');
  });

  it('larger universe — all stocks filtered out outside New York', () => {
    const universe = [
      { symbol: 'AAPL', assetClass: 'stock' },
      { symbol: 'MSFT', assetClass: 'stock' },
      { symbol: 'NVDA', assetClass: 'stock' },
      { symbol: 'BTC/USD', assetClass: 'crypto' },
      { symbol: 'ETH/USD', assetClass: 'crypto' },
    ];
    const result = filterEligible(universe, utc(MON, '10:00:00')); // LONDON
    expect(result.every((e) => e.assetClass === 'crypto')).toBe(true);
    expect(result).toHaveLength(2);
  });

  it('larger universe — all symbols eligible during New York', () => {
    const universe = [
      { symbol: 'AAPL', assetClass: 'stock' },
      { symbol: 'MSFT', assetClass: 'stock' },
      { symbol: 'BTC/USD', assetClass: 'crypto' },
      { symbol: 'ETH/USD', assetClass: 'crypto' },
    ];
    const result = filterEligible(universe, utc(MON, '17:00:00')); // NEW_YORK
    expect(result).toHaveLength(4);
  });
});
