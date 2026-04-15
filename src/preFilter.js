/**
 * Pre-filter engine — fast, cheap rejection of symbols before the full strategy runs.
 */

import { config as runtimeConfig } from './config/env.js';
import { buildSignalMetrics } from './strategies/buildSignalMetrics.js';

const DEFAULTS = {
  breakoutLookback: runtimeConfig.prefilter.breakoutLookback,
  volumeLookback: runtimeConfig.prefilter.volumeLookback,
  atrPeriod: runtimeConfig.prefilter.atrPeriod,
  minVolRatio: runtimeConfig.prefilter.minVolRatio,
  minAtr: runtimeConfig.strategy.minAtr,
  minRangeAtrMultiple: runtimeConfig.prefilter.minRangeAtrMultiple,
  maxDistanceToBreakoutPct: runtimeConfig.prefilter.maxDistanceToBreakoutPct,
  breakoutNearMissPct: runtimeConfig.prefilter.breakoutNearMissPct,
  minBars: runtimeConfig.prefilter.minBars,
};

export function preFilter(symbol, assetClass, bars, options = {}) {
  const opts = { ...DEFAULTS, ...options };

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
  if (metrics.barsAvailable < opts.minBars) {
    return reject('insufficient_market_data', metrics);
  }

  if (metrics.atr == null || metrics.atr <= 0 || metrics.atr < opts.minAtr) {
    return reject('atr_too_low', metrics);
  }

  if (metrics.averageVolume == null || metrics.averageVolume <= 0 || metrics.volumeRatio == null) {
    return reject('missing_volume', metrics);
  }

  if (metrics.volumeRatio < opts.minVolRatio) {
    return reject('weak_volume', metrics);
  }

  if (metrics.rangeAtrMultiple == null || metrics.rangeAtrMultiple < opts.minRangeAtrMultiple) {
    return reject('weak_trend_environment', metrics);
  }

  const distance = metrics.distanceToBreakoutPct;
  if (distance == null) {
    return reject('insufficient_market_data', metrics);
  }

  if (distance > opts.maxDistanceToBreakoutPct) {
    return reject('overextended_breakout', metrics);
  }

  if (distance < 0 && Math.abs(distance) > opts.breakoutNearMissPct) {
    return reject('no_breakout', metrics);
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
