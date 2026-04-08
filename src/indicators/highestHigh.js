/**
 * Returns the highest high over the last `lookback` bars,
 * excluding the most recent (current) bar.
 *
 * @param {Array<{ h: number }>} bars  Oldest first.
 * @param {number} [lookback]
 * @returns {number|null}  null if insufficient data.
 */
export function calcHighestHigh(bars, lookback = 20) {
  if (!Array.isArray(bars) || bars.length < lookback + 1) return null;

  // The "lookback" window is bars[-(lookback+1)] through bars[-2]
  // (excludes the most recent bar at bars[-1])
  const window = bars.slice(-(lookback + 1), -1);
  return Math.max(...window.map((b) => b.h));
}
