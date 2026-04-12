/**
 * Tests for resolveSession() in src/utils/time.js.
 *
 * All timestamps use January 2026 (winter — no DST for ET or London) so the
 * session boundaries are simple and predictable:
 *
 *   Tokyo    (JST = UTC+9):  Mon–Fri 09:00–15:30 JST  =  00:00–06:30 UTC
 *   London   (GMT = UTC+0):  Mon–Fri 08:00–16:30 GMT  =  08:00–16:30 UTC
 *   New York (EST = UTC-5):  Mon–Fri 09:30–16:00 ET   =  14:30–21:00 UTC
 *   Overlap  (LSE ∩ NYSE):                            =  14:30–16:30 UTC
 */

import { describe, it, expect, afterEach } from '@jest/globals';
import { resolveSession } from '../../src/utils/time.js';

// Monday 2026-01-05 — a plain weekday in winter (no DST anywhere)
const MON = '2026-01-05';

function utc(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}Z`);
}

describe('resolveSession', () => {
  afterEach(() => {
    delete process.env.SKIP_MARKET_HOURS;
  });

  it('returns TOKYO when only the Tokyo session is active', () => {
    // 02:00 UTC = 11:00 JST (Tokyo active), 02:00 GMT (London closed), 21:00 ET prev day (NYSE closed)
    const result = resolveSession(utc(MON, '02:00:00'));
    expect(result.session).toBe('TOKYO');
    expect(result.allowCrypto).toBe(true);
    expect(result.allowStocks).toBe(false);
  });

  it('returns LONDON when only the London session is active', () => {
    // 10:00 UTC = 10:00 GMT (London open), 05:00 ET (NYSE not yet open)
    const result = resolveSession(utc(MON, '10:00:00'));
    expect(result.session).toBe('LONDON');
    expect(result.allowCrypto).toBe(true);
    expect(result.allowStocks).toBe(false);
  });

  it('returns NEW_YORK when only NYSE is open', () => {
    // 17:00 UTC = 12:00 ET (NYSE open), 17:00 GMT (London closed at 16:30)
    const result = resolveSession(utc(MON, '17:00:00'));
    expect(result.session).toBe('NEW_YORK');
    expect(result.allowCrypto).toBe(true);
    expect(result.allowStocks).toBe(true);
  });

  it('returns LONDON_NEW_YORK_OVERLAP when both exchanges are open', () => {
    // 15:00 UTC = 15:00 GMT (London open), 10:00 ET (NYSE open)
    const result = resolveSession(utc(MON, '15:00:00'));
    expect(result.session).toBe('LONDON_NEW_YORK_OVERLAP');
    expect(result.allowCrypto).toBe(true);
    expect(result.allowStocks).toBe(true);
  });

  it('returns CRYPTO_ONLY outside all major sessions', () => {
    // 22:00 UTC = after NYSE close (21:00), before London open (08:00), after Tokyo close
    const result = resolveSession(utc(MON, '22:00:00'));
    expect(result.session).toBe('CRYPTO_ONLY');
    expect(result.allowCrypto).toBe(true);
    expect(result.allowStocks).toBe(false);
  });

  it('returns CRYPTO_ONLY on weekends', () => {
    // Saturday 2026-01-03 at noon UTC — no exchanges open
    const result = resolveSession(new Date('2026-01-03T12:00:00Z'));
    expect(result.session).toBe('CRYPTO_ONLY');
    expect(result.allowCrypto).toBe(true);
    expect(result.allowStocks).toBe(false);
  });

  it('allowStocks is true only when New York session is active', () => {
    const nyOnly = resolveSession(utc(MON, '17:00:00'));
    const overlap = resolveSession(utc(MON, '15:00:00'));
    const london = resolveSession(utc(MON, '10:00:00'));
    const tokyo = resolveSession(utc(MON, '02:00:00'));
    const crypto = resolveSession(utc(MON, '22:00:00'));

    expect(nyOnly.allowStocks).toBe(true);
    expect(overlap.allowStocks).toBe(true);
    expect(london.allowStocks).toBe(false);
    expect(tokyo.allowStocks).toBe(false);
    expect(crypto.allowStocks).toBe(false);
  });

  it('allowCrypto is always true regardless of session', () => {
    const sessions = [
      utc(MON, '02:00:00'), // TOKYO
      utc(MON, '10:00:00'), // LONDON
      utc(MON, '15:00:00'), // OVERLAP
      utc(MON, '17:00:00'), // NEW_YORK
      utc(MON, '22:00:00'), // CRYPTO_ONLY
      new Date('2026-01-03T12:00:00Z'), // weekend
    ];
    for (const ts of sessions) {
      expect(resolveSession(ts).allowCrypto).toBe(true);
    }
  });

  it('SKIP_MARKET_HOURS=true forces NEW_YORK with both asset classes eligible', () => {
    process.env.SKIP_MARKET_HOURS = 'true';
    // Use a weekend timestamp that would otherwise return CRYPTO_ONLY
    const result = resolveSession(new Date('2026-01-03T12:00:00Z'));
    expect(result.session).toBe('NEW_YORK');
    expect(result.allowCrypto).toBe(true);
    expect(result.allowStocks).toBe(true);
  });
});
