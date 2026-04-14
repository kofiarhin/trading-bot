/**
 * Pre-filter engine — fast, cheap rejection of symbols before the full strategy runs.
 *
 * Returns a PreFilterResult with computed metrics so the caller can pass them directly
 * into evaluateBreakout(), eliminating redundant indicator computation.
 *
 * This module is intentionally independent: no DB calls, no strategy imports.
 */

import { calcATR } from './indicators/atr.js';
import { calcHighestHigh } from './indicators/highestHigh.js';
import { calcAverageVolume } from './indicators/averageVolume.js';

// Read numeric env vars, falling back to a default if invalid or missing.
function envNum(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const DEFAULTS = {
  breakoutLookback: envNum('BREAKOUT_LOOKBACK', 20),
  volumeLookback: envNum('VOLUME_LOOKBACK', 20),
  atrPeriod: envNum('ATR_PERIOD', 14),
  minVolRatio: envNum('MIN_VOL_RATIO', 1.2),
  minAtr: envNum('MIN_ATR', 0.25),
  maxDistanceToBreakoutPct: envNum('MAX_DISTANCE_TO_BREAKOUT_PCT', 1.0),
};

function toMetric(value) {
  return Number.isFinite(value) ? parseFloat(value.toFixed(4)) : null;
}

/**
 * Pre-filters a symbol against cheap data-quality and breakout presence checks.
 *
 * @param {string} symbol
 * @param {"stock"|"crypto"} assetClass
 * @param {Array<{ t: string, o: number, h: number, l: number, c: number, v: number }>} bars
 * @param {object} [config={}]  optional overrides for filter thresholds
 * @returns {{
 *   symbol: string,
 *   assetClass: string,
 *   passed: boolean,
 *   rejectReason: string|null,
 *   rejectStage: "pre_filter"|null,
 *   metrics: object|null,
 * }}
 */
export function preFilter(symbol, assetClass, bars, config = {}) {
  const opts = { ...DEFAULTS, ...config };

  function reject(reason) {
    return {
      symbol,
      assetClass,
      passed: false,
      rejectReason: reason,
      rejectStage: 'pre_filter',
      metrics: null,
    };
  }

  // ── 1. Minimum bar count ───────────────────────────────────────────────────
  if (!Array.isArray(bars) || bars.length < opts.breakoutLookback + 2) {
    return reject('insufficient_market_data');
  }

  const latestBar = bars[bars.length - 1];
  const closePrice = latestBar.c;
  const currentVolume = latestBar.v;

  // ── 2. Highest high (breakout level) — excludes the current bar ───────────
  const rawHighestHigh = calcHighestHigh(bars, opts.breakoutLookback);
  if (rawHighestHigh === null) {
    return reject('insufficient_market_data');
  }
  const highestHigh = toMetric(rawHighestHigh);

  // ── 3. ATR ─────────────────────────────────────────────────────────────────
  const rawAtr = calcATR(bars, opts.atrPeriod);
  if (rawAtr === null || rawAtr <= 0 || rawAtr < opts.minAtr) {
    return reject('atr_too_low');
  }
  const atr = toMetric(rawAtr);

  // ── 4. Volume ratio ────────────────────────────────────────────────────────
  const avgVolume = calcAverageVolume(bars, opts.volumeLookback);
  if (avgVolume === null || !Number.isFinite(avgVolume) || avgVolume === 0 || currentVolume == null) {
    return reject('missing_volume');
  }
  const rawVolumeRatio = currentVolume / avgVolume;
  if (!Number.isFinite(rawVolumeRatio)) {
    return reject('missing_volume');
  }
  const volumeRatio = toMetric(rawVolumeRatio);
  if (volumeRatio === null || volumeRatio < opts.minVolRatio) {
    return reject('weak_volume');
  }

  // ── 5. Breakout present ────────────────────────────────────────────────────
  if (closePrice <= rawHighestHigh) {
    return reject('no_breakout');
  }

  // ── 6. Not overextended ────────────────────────────────────────────────────
  const distanceToBreakoutPct = toMetric(
    ((closePrice - rawHighestHigh) / rawHighestHigh) * 100,
  );
  if (distanceToBreakoutPct !== null && distanceToBreakoutPct > opts.maxDistanceToBreakoutPct) {
    return reject('overextended_breakout');
  }

  return {
    symbol,
    assetClass,
    passed: true,
    rejectReason: null,
    rejectStage: null,
    metrics: {
      closePrice: toMetric(closePrice),
      highestHigh,
      atr,
      volumeRatio,
      distanceToBreakoutPct,
      barCount: bars.length,
    },
  };
}
