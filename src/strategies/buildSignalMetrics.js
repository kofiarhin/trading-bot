import { calcATR } from '../indicators/atr.js';
import { calcHighestHigh } from '../indicators/highestHigh.js';
import { calcAverageVolume } from '../indicators/averageVolume.js';

function toMetric(value) {
  return Number.isFinite(value) ? parseFloat(value.toFixed(4)) : null;
}

export function buildSignalMetrics(bars, options = {}) {
  const breakoutLookback = Number.isFinite(Number(options.breakoutLookback)) ? Number(options.breakoutLookback) : 20;
  const volumeLookback = Number.isFinite(Number(options.volumeLookback)) ? Number(options.volumeLookback) : 20;
  const atrPeriod = Number.isFinite(Number(options.atrPeriod)) ? Number(options.atrPeriod) : 14;

  const barsAvailable = Array.isArray(bars) ? bars.length : 0;
  if (!Array.isArray(bars) || barsAvailable < breakoutLookback + 2) {
    return { ok: false, reason: 'insufficient_market_data', metrics: { barsAvailable } };
  }

  const latestBar = bars[bars.length - 1];
  const closePrice = Number(latestBar?.c);
  const currentVolume = Number(latestBar?.v);
  const rawBreakoutLevel = calcHighestHigh(bars, breakoutLookback);
  if (!Number.isFinite(rawBreakoutLevel)) {
    return { ok: false, reason: 'insufficient_market_data', metrics: { barsAvailable } };
  }

  const rawAtr = calcATR(bars, atrPeriod);
  const averageVolume = calcAverageVolume(bars, volumeLookback);
  const volumeRatio = Number.isFinite(averageVolume) && averageVolume > 0 && Number.isFinite(currentVolume)
    ? currentVolume / averageVolume
    : null;

  const lookbackSlice = bars.slice(-breakoutLookback);
  const localLow = lookbackSlice.reduce((min, bar) => {
    const low = Number(bar?.l);
    return Number.isFinite(low) ? Math.min(min, low) : min;
  }, Number.POSITIVE_INFINITY);
  const range = Number.isFinite(localLow) ? rawBreakoutLevel - localLow : null;
  const rangeAtrMultiple = Number.isFinite(range) && Number.isFinite(rawAtr) && rawAtr > 0
    ? range / rawAtr
    : null;

  const distanceToBreakoutPct = rawBreakoutLevel > 0 && Number.isFinite(closePrice)
    ? ((closePrice - rawBreakoutLevel) / rawBreakoutLevel) * 100
    : null;

  return {
    ok: true,
    reason: null,
    metrics: {
      closePrice: toMetric(closePrice),
      breakoutLevel: toMetric(rawBreakoutLevel),
      highestHigh: toMetric(rawBreakoutLevel),
      atr: toMetric(rawAtr),
      volumeRatio: toMetric(volumeRatio),
      averageVolume: toMetric(averageVolume),
      barsAvailable,
      barCount: barsAvailable,
      distanceToBreakoutPct: toMetric(distanceToBreakoutPct),
      rangeAtrMultiple: toMetric(rangeAtrMultiple),
    },
  };
}
