// Momentum Breakout + ATR Risk Strategy — v2 refactor.
//
// Pre-filter checks (bar count, ATR floor, volume presence/ratio, breakout presence,
// overextension) have been extracted to src/preFilter.js.
//
// When `preFilterMetrics` is supplied by the autopilot pipeline the indicators are
// NOT recomputed here — they are taken directly from the pre-filter result.
// When `preFilterMetrics` is absent (e.g. the manual forceTrade path) the strategy
// falls back to computing them internally for full backward compatibility.
//
// Rejection reasons for strategy-stage checks:
//   near_breakout, invalid_stop_distance, weak_risk_reward,
//   invalid_position_size, score_below_threshold

import { normalizeSymbol } from "../utils/symbolNorm.js";
import { resolveSession } from "../utils/time.js";
import { computeScore } from "../scoring/scorer.js";
import { buildSignalMetrics } from "./buildSignalMetrics.js";

export { computeScore } from "../scoring/scorer.js";

export const STRATEGY_NAME = "momentum_breakout_atr_v1";

// Read numeric env vars, falling back to a default if invalid or missing.
function envNum(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

// Defaults are env-configurable at process start.
// Pass `options` to evaluateBreakout() to override per-call.
const DEFAULTS = {
  breakoutLookback: envNum('BREAKOUT_LOOKBACK', 20),
  volumeLookback: envNum('VOLUME_LOOKBACK', 20),
  atrPeriod: envNum('ATR_PERIOD', 14),
  atrMultiplier: envNum('ATR_MULTIPLIER', 1.5),
  targetMultiple: envNum('TARGET_MULTIPLE', 2),
  minVolRatio: envNum('MIN_VOL_RATIO', 1.2),
  minAtr: envNum('MIN_ATR', 0.25),
  maxDistanceToBreakoutPct: envNum('PREFILTER_MAX_DISTANCE_TO_BREAKOUT_PCT', 1.0),
  minRiskReward: envNum('MIN_RISK_REWARD', 1.5),
  breakoutNearMissPct: envNum('BREAKOUT_NEAR_MISS_PCT', 0.5),
  breakoutConfirmationPct: Number.isFinite(Number(process.env.BREAKOUT_CONFIRMATION_PCT))
    ? Number(process.env.BREAKOUT_CONFIRMATION_PCT)
    : 0,
  minSetupScore: envNum('MIN_SETUP_SCORE', 0),
  minSetupScoreTokyo: envNum('MIN_SETUP_SCORE_TOKYO', 0),
  minSetupScoreLondon: envNum('MIN_SETUP_SCORE_LONDON', 0),
  minSetupScoreNewYork: envNum('MIN_SETUP_SCORE_NEW_YORK', 0),
};

function resolveMinScore(opts, session) {
  const sessionKey = session?.toLowerCase().replace(/[^a-z]/g, '_');
  if (sessionKey === 'tokyo' && opts.minSetupScoreTokyo > 0) return opts.minSetupScoreTokyo;
  if (sessionKey === 'london' && opts.minSetupScoreLondon > 0) return opts.minSetupScoreLondon;
  if (sessionKey === 'new_york' && opts.minSetupScoreNewYork > 0) return opts.minSetupScoreNewYork;
  return opts.minSetupScore;
}

/**
 * Evaluates a symbol against the breakout strategy.
 *
 * When `preFilterMetrics` is provided (from the autopilot pre-filter stage),
 * indicator values are taken from it directly. When absent, they are computed
 * from `bars` for full backward compatibility (e.g. manual trade / forceTrade).
 *
 * @param {{
 *   symbol: string,
 *   assetClass: "stock"|"crypto",
 *   bars: Array<{ t: string, o: number, h: number, l: number, c: number, v: number }>,
 *   preFilterMetrics?: {
 *     closePrice: number,
 *     highestHigh: number,
 *     atr: number,
 *     volumeRatio: number,
 *     distanceToBreakoutPct: number,
 *     barCount: number,
 *   },
 *   accountEquity: number,
 *   riskPercent: number,
 *   timeframe?: string,
 *   options?: object,
 * }} params
 */
export function evaluateBreakout({
  symbol,
  assetClass = "stock",
  bars,
  preFilterMetrics,
  accountEquity,
  riskPercent,
  timeframe = "15Min",
  options = {},
}) {
  const opts = { ...DEFAULTS, ...options };
  const timestamp = new Date().toISOString();
  const normalizedSym = normalizeSymbol(symbol);

  function toMetric(value) {
    return Number.isFinite(value) ? parseFloat(value.toFixed(4)) : null;
  }

  // ── Resolve indicators ─────────────────────────────────────────────────────
  // If preFilterMetrics were supplied, reuse them. Otherwise compute from bars
  // (fallback path for callers that don't go through the pre-filter stage).
  let closePrice, breakoutLevel, atr, volumeRatio, distanceToBreakoutPct;

  if (preFilterMetrics) {
    closePrice = preFilterMetrics.closePrice;
    breakoutLevel = preFilterMetrics.highestHigh ?? preFilterMetrics.breakoutLevel;
    atr = preFilterMetrics.atr;
    volumeRatio = preFilterMetrics.volumeRatio;
    distanceToBreakoutPct = preFilterMetrics.distanceToBreakoutPct;
  } else {
    const signal = buildSignalMetrics(bars, opts);
    if (!signal.ok) {
      return buildReject(signal.reason, null, null, null, null, null, null, symbol, normalizedSym, assetClass, timestamp, timeframe, opts);
    }

    closePrice = signal.metrics.closePrice;
    breakoutLevel = signal.metrics.breakoutLevel;
    atr = signal.metrics.atr;
    volumeRatio = signal.metrics.volumeRatio;
    distanceToBreakoutPct = signal.metrics.distanceToBreakoutPct;

    if (closePrice <= breakoutLevel) {
      const distanceBelow = distanceToBreakoutPct !== null ? -distanceToBreakoutPct : null;
      const bc = (distanceBelow !== null && distanceBelow <= opts.breakoutNearMissPct)
        ? 'near_breakout'
        : 'no_breakout';
      return buildReject(bc, closePrice, breakoutLevel, atr, volumeRatio, distanceToBreakoutPct, bc, symbol, normalizedSym, assetClass, timestamp, timeframe, opts);
    }
    if (distanceToBreakoutPct !== null && distanceToBreakoutPct > opts.maxDistanceToBreakoutPct) {
      return buildReject('overextended_breakout', closePrice, breakoutLevel, atr, volumeRatio, distanceToBreakoutPct, 'confirmed_breakout', symbol, normalizedSym, assetClass, timestamp, timeframe, opts);
    }
    if (volumeRatio == null) {
      return buildReject('missing_volume', closePrice, breakoutLevel, atr, volumeRatio, distanceToBreakoutPct, 'confirmed_breakout', symbol, normalizedSym, assetClass, timestamp, timeframe, opts);
    }
    if (volumeRatio < opts.minVolRatio) {
      return buildReject('weak_volume', closePrice, breakoutLevel, atr, volumeRatio, distanceToBreakoutPct, 'confirmed_breakout', symbol, normalizedSym, assetClass, timestamp, timeframe, opts);
    }
    if (atr === null || atr < opts.minAtr) {
      return buildReject('atr_too_low', closePrice, breakoutLevel, atr, volumeRatio, distanceToBreakoutPct, 'confirmed_breakout', symbol, normalizedSym, assetClass, timestamp, timeframe, opts);
    }
  }

  const entryPrice = closePrice;
  const rawBreakoutLevelNum = breakoutLevel;

  // ── Strategy-stage: breakout classification ────────────────────────────────
  let breakoutClassification;
  if (entryPrice > rawBreakoutLevelNum) {
    const confirmationLevel = rawBreakoutLevelNum * (1 + opts.breakoutConfirmationPct / 100);
    if (entryPrice < confirmationLevel) {
      return buildReject('breakout_not_confirmed', closePrice, breakoutLevel, atr, volumeRatio, distanceToBreakoutPct, 'near_breakout', symbol, normalizedSym, assetClass, timestamp, timeframe, opts, 'strategy');
    }
    breakoutClassification = 'confirmed_breakout';
  } else {
    const distanceBelow = distanceToBreakoutPct !== null ? -distanceToBreakoutPct : null;
    if (distanceBelow !== null && distanceBelow <= opts.breakoutNearMissPct) {
      breakoutClassification = 'near_breakout';
      return buildReject('near_breakout', closePrice, breakoutLevel, atr, volumeRatio, distanceToBreakoutPct, breakoutClassification, symbol, normalizedSym, assetClass, timestamp, timeframe, opts, 'strategy');
    }
    breakoutClassification = 'no_breakout';
    return buildReject('no_breakout', closePrice, breakoutLevel, atr, volumeRatio, distanceToBreakoutPct, breakoutClassification, symbol, normalizedSym, assetClass, timestamp, timeframe, opts, 'strategy');
  }

  // ── Stop-loss and take-profit via ATR ──────────────────────────────────────
  const rawAtrForSizing = atr;
  const stopLoss = entryPrice - opts.atrMultiplier * rawAtrForSizing;
  const riskPerUnit = entryPrice - stopLoss;
  if (riskPerUnit <= 0) {
    return buildReject('invalid_stop_distance', closePrice, breakoutLevel, atr, volumeRatio, distanceToBreakoutPct, breakoutClassification, symbol, normalizedSym, assetClass, timestamp, timeframe, opts, 'strategy');
  }

  const takeProfit = entryPrice + opts.targetMultiple * riskPerUnit;

  // ── Guard: risk/reward ─────────────────────────────────────────────────────
  const rewardPerUnit = takeProfit - entryPrice;
  const riskReward = riskPerUnit > 0 ? rewardPerUnit / riskPerUnit : null;
  if (!riskReward || riskReward < opts.minRiskReward) {
    return buildReject('weak_risk_reward', closePrice, breakoutLevel, atr, volumeRatio, distanceToBreakoutPct, breakoutClassification, symbol, normalizedSym, assetClass, timestamp, timeframe, opts, 'strategy');
  }

  // ── Position sizing ────────────────────────────────────────────────────────
  const riskAmount = (accountEquity ?? 0) * (riskPercent ?? 0.005);
  if (riskAmount <= 0) {
    return buildReject('invalid_position_size', closePrice, breakoutLevel, atr, volumeRatio, distanceToBreakoutPct, breakoutClassification, symbol, normalizedSym, assetClass, timestamp, timeframe, opts, 'strategy');
  }

  const quantity =
    assetClass === 'crypto'
      ? parseFloat((riskAmount / riskPerUnit).toFixed(8))
      : Math.floor(riskAmount / riskPerUnit);

  if (assetClass !== 'crypto' && quantity < 1) {
    return buildReject('invalid_position_size', closePrice, breakoutLevel, atr, volumeRatio, distanceToBreakoutPct, breakoutClassification, symbol, normalizedSym, assetClass, timestamp, timeframe, opts, 'strategy');
  }
  if (quantity <= 0) {
    return buildReject('invalid_position_size', closePrice, breakoutLevel, atr, volumeRatio, distanceToBreakoutPct, breakoutClassification, symbol, normalizedSym, assetClass, timestamp, timeframe, opts, 'strategy');
  }

  // ── Score + session-aware threshold ───────────────────────────────────────
  const { total: score, grade: setupGrade, breakdown: scoreBreakdown, context } = computeScore(
    { distanceToBreakoutPct, volumeRatio, atr, closePrice, riskReward: toMetric(riskReward) },
    opts,
  );

  const minScore = resolveMinScore(opts, context.session);
  if (minScore > 0 && score < minScore) {
    return buildReject('score_below_threshold', closePrice, breakoutLevel, atr, volumeRatio, distanceToBreakoutPct, breakoutClassification, symbol, normalizedSym, assetClass, timestamp, timeframe, opts, 'strategy', { setupScore: score, setupGrade, scoreBreakdown, context });
  }

  return {
    approved: true,
    symbol,
    normalizedSymbol: normalizedSym,
    assetClass,
    strategyName: STRATEGY_NAME,
    timestamp,
    timeframe,
    side: 'buy',
    reason: 'breakout_confirmed',
    rejectStage: null,
    blockers: [],
    entryPrice: toMetric(entryPrice),
    stopLoss: toMetric(stopLoss),
    takeProfit: toMetric(takeProfit),
    quantity,
    riskAmount: toMetric(riskAmount),
    riskReward: toMetric(riskReward),
    setupScore: score,
    setupGrade,
    scoreBreakdown,
    rejectionClass: null,
    rejectionGroup: null,
    context,
    breakoutClassification,
    metrics: {
      closePrice: toMetric(closePrice),
      breakoutLevel: toMetric(breakoutLevel),
      atr: toMetric(atr),
      volumeRatio: toMetric(volumeRatio),
      distanceToBreakoutPct: toMetric(distanceToBreakoutPct),
      breakoutClassification,
    },
  };
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function buildReject(
  reason,
  closePrice,
  breakoutLevel,
  atr,
  volumeRatio,
  distanceToBreakoutPct,
  breakoutClassification,
  symbol,
  normalizedSym,
  assetClass,
  timestamp,
  timeframe,
  opts,
  rejectStage = null,
  extra = {},
) {
  function toMetric(value) {
    return Number.isFinite(value) ? parseFloat(value.toFixed(4)) : null;
  }
  const { total: score, grade: setupGrade, breakdown: scoreBreakdown, context } = computeScore(
    { distanceToBreakoutPct, volumeRatio, atr, closePrice, riskReward: null },
    opts,
  );
  return {
    approved: false,
    symbol,
    normalizedSymbol: normalizedSym,
    assetClass,
    strategyName: STRATEGY_NAME,
    timestamp,
    timeframe,
    side: 'buy',
    reason,
    rejectStage: rejectStage ?? null,
    blockers: [reason],
    entryPrice: null,
    stopLoss: null,
    takeProfit: null,
    quantity: null,
    riskAmount: null,
    riskReward: null,
    setupScore: score,
    setupGrade,
    scoreBreakdown,
    rejectionClass: mapRejectionClass(reason),
    rejectionGroup: mapRejectionGroup(reason),
    context,
    breakoutClassification: breakoutClassification ?? null,
    ...extra,
    metrics: {
      closePrice: toMetric(closePrice),
      breakoutLevel: toMetric(breakoutLevel),
      atr: toMetric(atr),
      volumeRatio: toMetric(volumeRatio),
      distanceToBreakoutPct: toMetric(distanceToBreakoutPct),
      breakoutClassification: breakoutClassification ?? null,
    },
  };
}

/**
 * Maps a strategy rejection reason to a broad rejection class.
 * Used for legacy analytics grouping.
 */
export function mapRejectionClass(reason) {
  if (['no_breakout', 'near_breakout', 'overextended_breakout', 'breakout_not_confirmed'].includes(reason)) return 'no_signal';
  if (['weak_volume', 'missing_volume', 'atr_too_low', 'weak_risk_reward', 'score_below_threshold'].includes(reason)) return 'weak_conditions';
  if (['invalid_stop_distance', 'invalid_position_size'].includes(reason)) return 'sizing_error';
  if (['insufficient_market_data'].includes(reason)) return 'data_quality';
  return 'unknown';
}

/**
 * Maps a rejection reason to a grouped analytics category.
 */
export function mapRejectionGroup(reason) {
  const groups = {
    signal_quality: ['no_breakout', 'near_breakout', 'overextended_breakout', 'breakout_not_confirmed', 'weak_volume', 'missing_volume', 'atr_too_low', 'weak_risk_reward', 'score_below_threshold'],
    data_quality: ['insufficient_market_data'],
    execution_guard: ['invalid_stop_distance', 'invalid_position_size'],
    risk_guard: ['duplicate_position_guard', 'max_positions_guard', 'daily_loss_guard', 'cooldown_guard'],
  };

  for (const [group, reasons] of Object.entries(groups)) {
    if (reasons.includes(reason)) return group;
  }
  return 'signal_quality';
}
