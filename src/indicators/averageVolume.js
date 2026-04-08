/**
 * Returns the average volume over the last `lookback` bars,
 * excluding the most recent (current) bar.
 *
 * @param {Array<{ v: number }>} bars  Oldest first.
 * @param {number} [lookback]
 * @returns {number|null}  null if insufficient data.
 */
export function calcAverageVolume(bars, lookback = 20) {
  if (!Array.isArray(bars) || bars.length < lookback + 1) return null;

  const window = bars.slice(-(lookback + 1), -1);
  return window.reduce((sum, b) => sum + b.v, 0) / window.length;
}
