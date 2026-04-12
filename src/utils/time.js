// Time and market-hours utilities.
// Covers US/Eastern (NYSE) and Europe/London (LSE) without external deps.

const ET_OFFSET_STANDARD = -5; // EST
const ET_OFFSET_DAYLIGHT = -4; // EDT

/**
 * Returns true if a given UTC Date is during US Eastern Daylight Time (EDT).
 * DST: second Sunday of March → first Sunday of November.
 * @param {Date} d
 * @returns {boolean}
 */
function isEDT(d) {
  const year = d.getUTCFullYear();

  // Second Sunday of March
  const march = new Date(Date.UTC(year, 2, 1));
  const marchDay = march.getUTCDay(); // 0=Sun
  const dstStart = new Date(Date.UTC(year, 2, 8 + ((7 - marchDay) % 7), 7)); // 2AM ET = 7AM UTC (EST)

  // First Sunday of November
  const nov = new Date(Date.UTC(year, 10, 1));
  const novDay = nov.getUTCDay();
  const dstEnd = new Date(Date.UTC(year, 10, 1 + ((7 - novDay) % 7), 6)); // 2AM ET = 6AM UTC (EDT)

  return d >= dstStart && d < dstEnd;
}

/**
 * Converts a UTC Date to Eastern Time components { hour, minute, dayOfWeek }.
 * @param {Date} utcDate
 * @returns {{ hour: number, minute: number, dayOfWeek: number }}
 */
export function toEasternTime(utcDate) {
  const offsetHours = isEDT(utcDate) ? ET_OFFSET_DAYLIGHT : ET_OFFSET_STANDARD;
  const etMs = utcDate.getTime() + offsetHours * 3600000;
  const et = new Date(etMs);
  return {
    hour: et.getUTCHours(),
    minute: et.getUTCMinutes(),
    dayOfWeek: et.getUTCDay(), // 0=Sun, 6=Sat
  };
}

/**
 * Returns true if the given UTC date is within regular US stock market hours
 * (Mon–Fri, 9:30 AM – 4:00 PM ET) and is at least at the first complete
 * 15-minute bar close (9:45 AM ET).
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isStockMarketOpen(now = new Date()) {
  const { hour, minute, dayOfWeek } = toEasternTime(now);
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;

  const totalMinutes = hour * 60 + minute;
  const open = 9 * 60 + 45;  // 9:45 AM — first closed 15m candle
  const close = 16 * 60;     // 4:00 PM

  return totalMinutes >= open && totalMinutes <= close;
}

/**
 * Returns true if the current UTC time aligns with a closed 15-minute candle
 * boundary (e.g. :00, :15, :30, :45).
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isOn15MinBoundary(now = new Date()) {
  const { minute } = toEasternTime(now);
  return minute % 15 === 0;
}

/**
 * Returns ms until the next 15-minute candle boundary in ET.
 * @param {Date} [now]
 * @returns {number}
 */
export function msUntilNext15Min(now = new Date()) {
  const ms = now.getTime();
  const interval = 15 * 60 * 1000;
  return interval - (ms % interval);
}

/**
 * Returns an ISO date string (YYYY-MM-DD) in Eastern Time.
 * @param {Date} [now]
 * @returns {string}
 */
export function etDateString(now = new Date()) {
  const offsetHours = isEDT(now) ? ET_OFFSET_DAYLIGHT : ET_OFFSET_STANDARD;
  const etMs = now.getTime() + offsetHours * 3600000;
  return new Date(etMs).toISOString().slice(0, 10);
}

/**
 * Returns an ISO date string (YYYY-MM-DD) in Europe/London time (GMT in winter, BST in summer).
 * Use this for cycle date grouping so a UK-based operator sees dates that match their local calendar.
 * @param {Date} [now]
 * @returns {string}
 */
export function londonDateString(now = new Date()) {
  const offsetHours = isBST(now) ? 1 : 0;
  const londonMs = now.getTime() + offsetHours * 3600000;
  return new Date(londonMs).toISOString().slice(0, 10);
}

// ─── UK / London timezone ──────────────────────────────────────────────────────

/**
 * Returns true if the given UTC Date is during British Summer Time (BST).
 * BST: last Sunday of March at 01:00 UTC → last Sunday of October at 01:00 UTC.
 * @param {Date} d
 * @returns {boolean}
 */
function isBST(d) {
  const year = d.getUTCFullYear();

  // Last Sunday of March at 01:00 UTC (clocks spring forward)
  const marchLastDay = new Date(Date.UTC(year, 2, 31));
  const bstStart = new Date(Date.UTC(year, 2, 31 - marchLastDay.getUTCDay(), 1));

  // Last Sunday of October at 01:00 UTC (clocks fall back)
  const octLastDay = new Date(Date.UTC(year, 9, 31));
  const bstEnd = new Date(Date.UTC(year, 9, 31 - octLastDay.getUTCDay(), 1));

  return d >= bstStart && d < bstEnd;
}

/**
 * Converts a UTC Date to London time components { hour, minute, dayOfWeek }.
 * Handles GMT (UTC+0) in winter and BST (UTC+1) in summer.
 * @param {Date} utcDate
 * @returns {{ hour: number, minute: number, dayOfWeek: number }}
 */
export function toLondonTime(utcDate) {
  const offsetHours = isBST(utcDate) ? 1 : 0;
  const londonMs = utcDate.getTime() + offsetHours * 3600000;
  const london = new Date(londonMs);
  return {
    hour: london.getUTCHours(),
    minute: london.getUTCMinutes(),
    dayOfWeek: london.getUTCDay(),
  };
}

// ─── Exchange open checks ──────────────────────────────────────────────────────

/**
 * Returns true if the NYSE is open (Mon–Fri, 9:30 AM – 4:00 PM ET).
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isNYSEOpen(now = new Date()) {
  const { hour, minute, dayOfWeek } = toEasternTime(now);
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  const totalMinutes = hour * 60 + minute;
  return totalMinutes >= 9 * 60 + 30 && totalMinutes < 16 * 60;
}

/**
 * Returns true if the LSE is open (Mon–Fri, 08:00 – 16:30 Europe/London).
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isLSEOpen(now = new Date()) {
  const { hour, minute, dayOfWeek } = toLondonTime(now);
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  const totalMinutes = hour * 60 + minute;
  return totalMinutes >= 8 * 60 && totalMinutes < 16 * 60 + 30;
}

/**
 * Returns true when NYSE and LSE are both open simultaneously.
 * The overlap window is ~14:30–16:30 London time on weekdays.
 * Set SKIP_MARKET_HOURS=true to bypass (useful for local testing).
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isMarketOverlapOpen(now = new Date()) {
  if (process.env.SKIP_MARKET_HOURS === 'true') return true;
  return isNYSEOpen(now) && isLSEOpen(now);
}

// ─── Tokyo timezone ────────────────────────────────────────────────────────────

const TOKYO_OFFSET = 9; // JST is always UTC+9, no DST

/**
 * Converts a UTC Date to Tokyo time components { hour, minute, dayOfWeek }.
 * JST is UTC+9 with no daylight saving.
 * @param {Date} utcDate
 * @returns {{ hour: number, minute: number, dayOfWeek: number }}
 */
export function toTokyoTime(utcDate) {
  const tokyoMs = utcDate.getTime() + TOKYO_OFFSET * 3600000;
  const tokyo = new Date(tokyoMs);
  return {
    hour: tokyo.getUTCHours(),
    minute: tokyo.getUTCMinutes(),
    dayOfWeek: tokyo.getUTCDay(),
  };
}

/**
 * Returns true if the TSE (Tokyo Stock Exchange) main session is active.
 * TSE: Mon–Fri 09:00–15:30 JST (lunch break 11:30–12:30 not modelled).
 * @param {Date} [now]
 * @returns {boolean}
 */
function isTokyoSessionActive(now = new Date()) {
  const { hour, minute, dayOfWeek } = toTokyoTime(now);
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  const totalMinutes = hour * 60 + minute;
  return totalMinutes >= 9 * 60 && totalMinutes < 15 * 60 + 30;
}

// ─── Session resolver ──────────────────────────────────────────────────────────

/**
 * Resolves the current market session and asset eligibility.
 *
 * Session priority:
 *   1. LONDON_NEW_YORK_OVERLAP — both LSE and NYSE open
 *   2. NEW_YORK               — NYSE open, LSE closed
 *   3. LONDON                 — LSE open, NYSE closed
 *   4. TOKYO                  — TSE session active, neither LSE nor NYSE open
 *   5. CRYPTO_ONLY            — no major exchange open (includes weekends)
 *
 * Set SKIP_MARKET_HOURS=true to force NEW_YORK (stocks always eligible — for testing).
 *
 * @param {Date} [now]
 * @returns {{ session: string, allowCrypto: boolean, allowStocks: boolean }}
 */
export function resolveSession(now = new Date()) {
  if (process.env.SKIP_MARKET_HOURS === 'true') {
    return { session: 'NEW_YORK', allowCrypto: true, allowStocks: true };
  }

  const nyOpen = isNYSEOpen(now);
  const lseOpen = isLSEOpen(now);

  if (nyOpen && lseOpen) {
    return { session: 'LONDON_NEW_YORK_OVERLAP', allowCrypto: true, allowStocks: true };
  }
  if (nyOpen) {
    return { session: 'NEW_YORK', allowCrypto: true, allowStocks: true };
  }
  if (lseOpen) {
    return { session: 'LONDON', allowCrypto: true, allowStocks: false };
  }
  if (isTokyoSessionActive(now)) {
    return { session: 'TOKYO', allowCrypto: true, allowStocks: false };
  }
  return { session: 'CRYPTO_ONLY', allowCrypto: true, allowStocks: false };
}
