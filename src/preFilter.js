/**
 * Pre-filter engine — fast, cheap rejection of symbols before the full strategy runs.
 */

import { buildSignalMetrics } from './strategies/buildSignalMetrics.js';

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

export function preFilter(symbol, assetClass, bars, config = {}) {
  const opts = { ...DEFAULTS, ...config };

  function reject(reason, metrics = null) {
    return {
      symbol,
      assetClass,
      passed: false,
      rejectReason: reason,
      rejectStage: 'pre_filter',
      metrics,
    };
  }

  const signal = buildSignalMetrics(bars, opts);
  if (!signal.ok) {
    return reject(signal.reason, signal.metrics ?? null);
  }

  const metrics = signal.metrics;

  if (metrics.atr == null || metrics.atr <= 0 || metrics.atr < opts.minAtr) {
    return reject('atr_too_low', metrics);
  }

  if (metrics.averageVolume == null || metrics.averageVolume <= 0 || metrics.volumeRatio == null) {
    return reject('missing_volume', metrics);
  }

  if (metrics.volumeRatio < opts.minVolRatio) {
    return reject('weak_volume', metrics);
  }

  if (metrics.closePrice <= metrics.breakoutLevel) {
    return reject('no_breakout', metrics);
  }

  if (metrics.distanceToBreakoutPct != null && metrics.distanceToBreakoutPct > opts.maxDistanceToBreakoutPct) {
    return reject('overextended_breakout', metrics);
  }

  return {
    symbol,
    assetClass,
    passed: true,
    rejectReason: null,
    rejectStage: null,
    metrics,
  };
}
