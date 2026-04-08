/**
 * ATR — Average True Range (simple moving average of True Range).
 *
 * True Range = max(high - low, |high - prevClose|, |low - prevClose|)
 * ATR = SMA of TR over `period` bars.
 *
 * @param {Array<{ h: number, l: number, c: number }>} bars  Oldest first.
 * @param {number} [period]
 * @returns {number|null}  null if insufficient data.
 */
export function calcATR(bars, period = 14) {
  if (!Array.isArray(bars) || bars.length < period + 1) return null;

  const trValues = [];
  for (let i = 1; i < bars.length; i++) {
    const { h, l } = bars[i];
    const prevClose = bars[i - 1].c;
    const tr = Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose));
    trValues.push(tr);
  }

  // Use the last `period` TR values
  const window = trValues.slice(-period);
  const atr = window.reduce((sum, v) => sum + v, 0) / window.length;
  return atr;
}
