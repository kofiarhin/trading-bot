// Time and market-hours utilities.
// All market times are US/Eastern. We compute offsets without external deps.

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
