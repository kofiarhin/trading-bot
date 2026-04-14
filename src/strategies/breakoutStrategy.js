// Momentum Breakout + ATR Risk Strategy — v1 built-in strategy.
//
// Entry conditions (long only):
//   1. Sufficient bar history (breakoutLookback + 2 bars minimum)
//   2. Latest close > highest high of last N completed candles (breakout confirmed)
//      — or within BREAKOUT_NEAR_MISS_PCT of the level (near_breakout, not approved)
//   3. Breakout is not overextended (distanceToBreakoutPct <= maxDistanceToBreakoutPct)
//   4. Current volume > average volume × minVolRatio
//   5. ATR is above minimum threshold (minAtr)
//   6. stopLoss < entryPrice (valid stop distance; riskPerUnit > 0)
//   7. Risk/reward >= minRiskReward
//   8. Position quantity > 0 for the asset class
//   9. Setup score >= session-aware minimum threshold
//
// Rejection reasons use explicit granular codes for analytics:
//   insufficient_market_data, no_breakout, near_breakout, overextended_breakout,
//   missing_volume, weak_volume, atr_too_low, invalid_stop_distance,
//   weak_risk_reward, invalid_position_size, score_below_threshold

import { calcATR } from "../indicators/atr.js";
import { calcHighestHigh } from "../indicators/highestHigh.js";
import { calcAverageVolume } from "../indicators/averageVolume.js";
import { normalizeSymbol } from "../utils/symbolNorm.js";
import { resolveSession } from "../utils/time.js";

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
  maxDistanceToBreakoutPct: envNum('MAX_DISTANCE_TO_BREAKOUT_PCT', 1.0),
  minRiskReward: envNum('MIN_RISK_REWARD', 1.5),
  // Near-breakout: price within this % below the breakout level is classified
  // as near_breakout (not approved, but tracked for analytics).
  breakoutNearMissPct: envNum('BREAKOUT_NEAR_MISS_PCT', 0.5),
  // Minimum confirmation: price must be at least this % above the breakout level.
  // Set to 0 to allow any price above the level (default: no confirmation buffer).
  breakoutConfirmationPct: Number.isFinite(Number(process.env.BREAKOUT_CONFIRMATION_PCT))
    ? Number(process.env.BREAKOUT_CONFIRMATION_PCT)
    : 0,
  // Score-based gating: reject if score < threshold (0 = disabled).
  // Session-specific overrides: MIN_SETUP_SCORE_TOKYO / _LONDON / _NEW_YORK.
  minSetupScore: envNum('MIN_SETUP_SCORE', 0),
  minSetupScoreTokyo: envNum('MIN_SETUP_SCORE_TOKYO', 0),
  minSetupScoreLondon: envNum('MIN_SETUP_SCORE_LONDON', 0),
  minSetupScoreNewYork: envNum('MIN_SETUP_SCORE_NEW_YORK', 0),
};

/**
 * Returns the session-aware minimum setup score threshold.
 * Session-specific overrides take precedence over the global default.
 */
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
 * Bars must be in Alpaca raw format: { t, o, h, l, c, v }
 *
 * @param {{
 *   symbol: string,
 *   assetClass: "stock"|"crypto",
 *   bars: Array<{ t: string, o: number, h: number, l: number, c: number, v: number }>,
 *   accountEquity: number,
 *   riskPercent: number,
 *   timeframe?: string,
 *   options?: object,
 * }} params
 *
 * @returns Canonical decision object with a `metrics` sub-object and `blockers` array.
 */
export function evaluateBreakout({
  symbol,
  assetClass = "stock",
  bars,
  accountEquity,
  riskPercent,
  timeframe = "15Min",
  options = {},
}) {
  const opts = { ...DEFAULTS, ...options };
  const timestamp = new Date().toISOString();
  const normalizedSym = normalizeSymbol(symbol);

  // Metrics are populated incrementally and always included in the return value,
  // even on early rejection, so the dashboard can display partial data.
  let closePrice = null;
  let breakoutLevel = null;
  let atr = null;
  let volumeRatio = null;
  let distanceToBreakoutPct = null;
  let breakoutClassification = null; // "confirmed_breakout" | "near_breakout" | "no_breakout"

  function toMetric(value) {
    return Number.isFinite(value) ? parseFloat(value.toFixed(4)) : null;
  }

  function buildMetrics() {
    return {
      closePrice,
      breakoutLevel,
      atr,
      volumeRatio,
      distanceToBreakoutPct,
      breakoutClassification,
    };
  }

  function reject(reason, extra = {}) {
    const { score, setupGrade, context } = computeScore(
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
      blockers: [reason],
      entryPrice: null,
      stopLoss: null,
      takeProfit: null,
      quantity: null,
      riskAmount: null,
      riskReward: null,
      setupScore: score,
      setupGrade,
      rejectionClass: mapRejectionClass(reason),
      rejectionGroup: mapRejectionGroup(reason),
      context,
      breakoutClassification,
      ...extra,
      metrics: buildMetrics(),
    };
  }

  // ── 1. Sufficient bar history ──────────────────────────────────────────────
  if (!Array.isArray(bars) || bars.length < opts.breakoutLookback + 2) {
    return reject('insufficient_market_data');
  }

  const latestBar = bars[bars.length - 1];
  closePrice = latestBar.c;
  const entryPrice = closePrice;
  const currentVolume = latestBar.v;

  // ── 2. Highest high (breakout level) — excludes the current bar ───────────
  const rawBreakoutLevel = calcHighestHigh(bars, opts.breakoutLookback);
  if (rawBreakoutLevel === null) return reject('insufficient_market_data');
  breakoutLevel = toMetric(rawBreakoutLevel);

  // ── 3. Volume ratio ────────────────────────────────────────────────────────
  const avgVolume = calcAverageVolume(bars, opts.volumeLookback);
  if (avgVolume !== null && avgVolume > 0) {
    volumeRatio = toMetric(currentVolume / avgVolume);
  }

  // ── 4. ATR ─────────────────────────────────────────────────────────────────
  const rawAtr = calcATR(bars, opts.atrPeriod);
  if (rawAtr !== null && rawAtr > 0) {
    atr = toMetric(rawAtr);
  }

  // ── 5. Distance to breakout level ─────────────────────────────────────────
  // Positive value = price is above the breakout level (valid breakout territory).
  // Negative value = price is still below the level.
  distanceToBreakoutPct = breakoutLevel
    ? toMetric(((entryPrice - rawBreakoutLevel) / rawBreakoutLevel) * 100)
    : null;

  // ── Breakout classification ────────────────────────────────────────────────
  if (entryPrice > rawBreakoutLevel) {
    // Confirmed if price is above the level (and meets confirmation buffer if set)
    if (
      opts.breakoutConfirmationPct > 0 &&
      distanceToBreakoutPct !== null &&
      distanceToBreakoutPct < opts.breakoutConfirmationPct
    ) {
      // Price is above the level but hasn't cleared the confirmation buffer yet.
      // Still treat it as confirmed_breakout but note the narrow margin.
      breakoutClassification = 'confirmed_breakout';
    } else {
      breakoutClassification = 'confirmed_breakout';
    }
  } else {
    // Below the level — check if it's a near-miss
    const distanceBelow =
      distanceToBreakoutPct !== null ? -distanceToBreakoutPct : null;
    if (distanceBelow !== null && distanceBelow <= opts.breakoutNearMissPct) {
      breakoutClassification = 'near_breakout';
      // near_breakout: tracked for analytics but not approved
      return reject('near_breakout');
    }
    breakoutClassification = 'no_breakout';
    return reject('no_breakout');
  }

  // ── Guard: not overextended ────────────────────────────────────────────────
  if (distanceToBreakoutPct !== null && distanceToBreakoutPct > opts.maxDistanceToBreakoutPct) {
    return reject('overextended_breakout');
  }

  // ── Guard: volume confirmation ─────────────────────────────────────────────
  if (avgVolume === null || avgVolume === 0) {
    return reject('missing_volume');
  }
  if (volumeRatio === null) {
    return reject('missing_volume');
  }
  if (volumeRatio < opts.minVolRatio) {
    return reject('weak_volume');
  }

  // ── Guard: ATR minimum ─────────────────────────────────────────────────────
  if (rawAtr === null || rawAtr <= 0) {
    return reject('atr_too_low');
  }
  if (rawAtr < opts.minAtr) {
    return reject('atr_too_low');
  }

  // ── Stop-loss and take-profit via ATR ──────────────────────────────────────
  const stopLoss = entryPrice - opts.atrMultiplier * rawAtr;
  const riskPerUnit = entryPrice - stopLoss;
  if (riskPerUnit <= 0) return reject('invalid_stop_distance');

  const takeProfit = entryPrice + opts.targetMultiple * riskPerUnit;

  // ── Guard: risk/reward ─────────────────────────────────────────────────────
  const rewardPerUnit = takeProfit - entryPrice;
  const riskReward = riskPerUnit > 0 ? rewardPerUnit / riskPerUnit : null;
  if (!riskReward || riskReward < opts.minRiskReward) {
    return reject('weak_risk_reward');
  }

  // ── Position sizing ────────────────────────────────────────────────────────
  const riskAmount = (accountEquity ?? 0) * (riskPercent ?? 0.005);
  if (riskAmount <= 0) return reject('invalid_position_size');

  const quantity =
    assetClass === 'crypto'
      ? parseFloat((riskAmount / riskPerUnit).toFixed(8))
      : Math.floor(riskAmount / riskPerUnit);

  if (assetClass !== 'crypto' && quantity < 1) return reject('invalid_position_size');
  if (quantity <= 0) return reject('invalid_position_size');

  // ── Score + session-aware threshold ───────────────────────────────────────
  const { score, setupGrade, context } = computeScore(
    { distanceToBreakoutPct, volumeRatio, atr, closePrice, riskReward: toMetric(riskReward) },
    opts,
  );

  const minScore = resolveMinScore(opts, context.session);
  if (minScore > 0 && score < minScore) {
    return reject('score_below_threshold', { setupScore: score, setupGrade, context });
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
    blockers: [],
    entryPrice: toMetric(entryPrice),
    stopLoss: toMetric(stopLoss),
    takeProfit: toMetric(takeProfit),
    quantity,
    riskAmount: toMetric(riskAmount),
    riskReward: toMetric(riskReward),
    setupScore: score,
    setupGrade,
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

// ── Scoring helpers ────────────────────────────────────────────────────────────

/**
 * Computes a numeric setup score (0–100) and grade for a candidate.
 *
 * Components (each 0–25):
 *   - Momentum: tighter distance to breakout = higher score
 *   - Volume:   volumeRatio capped at 3×
 *   - ATR:      mid-range ATR relative to price preferred
 *   - R:R:      higher risk/reward = higher score (ceiling 4)
 *
 * @param {{ distanceToBreakoutPct: number|null, volumeRatio: number|null, atr: number|null, closePrice: number|null, riskReward: number|null }} metrics
 * @param {object} opts
 * @returns {{ score: number, setupGrade: "A"|"B"|"C", context: object }}
 */
export function computeScore(metrics, opts = {}) {
  const {
    distanceToBreakoutPct,
    volumeRatio,
    atr,
    closePrice,
    riskReward,
  } = metrics;

  const maxDist = opts.maxDistanceToBreakoutPct ?? envNum('MAX_DISTANCE_TO_BREAKOUT_PCT', 1.0);
  const minRR = opts.minRiskReward ?? envNum('MIN_RISK_REWARD', 1.5);

  // Momentum: 0 distance = 25, maxDist = 0. Clamp to [0, 25].
  let momentumScore = 0;
  if (typeof distanceToBreakoutPct === 'number' && Number.isFinite(distanceToBreakoutPct) && distanceToBreakoutPct >= 0) {
    momentumScore = Math.max(0, 25 * (1 - distanceToBreakoutPct / maxDist));
  }

  // Volume: ratio capped at 3× → full 25 pts.
  let volumeScore = 0;
  if (typeof volumeRatio === 'number' && Number.isFinite(volumeRatio) && volumeRatio > 0) {
    volumeScore = Math.min(25, (volumeRatio / 3) * 25);
  }

  // ATR quality: 0.5–2% of price is considered mid-range (best). Outside that range, score drops.
  let atrScore = 0;
  if (typeof atr === 'number' && Number.isFinite(atr) && atr > 0 &&
      typeof closePrice === 'number' && Number.isFinite(closePrice) && closePrice > 0) {
    const atrPct = (atr / closePrice) * 100;
    // Ideal band: 0.5% – 2%. Normalize within that band.
    if (atrPct >= 0.5 && atrPct <= 2.0) {
      atrScore = 25;
    } else if (atrPct < 0.5) {
      atrScore = Math.max(0, (atrPct / 0.5) * 25);
    } else {
      // atrPct > 2%: diminishing returns beyond 4%
      atrScore = Math.max(0, 25 * (1 - (atrPct - 2.0) / 2.0));
    }
  }

  // R:R: normalized against ceiling of 4.
  let rrScore = 0;
  if (typeof riskReward === 'number' && Number.isFinite(riskReward) && riskReward >= minRR) {
    rrScore = Math.min(25, ((riskReward - minRR) / (4 - minRR)) * 25);
  }

  const score = Math.round(momentumScore + volumeScore + atrScore + rrScore);

  let setupGrade;
  if (score >= 75) setupGrade = 'A';
  else if (score >= 50) setupGrade = 'B';
  else setupGrade = 'C';

  const { session } = resolveSession();

  let volatilityLabel = 'mid';
  if (typeof atr === 'number' && Number.isFinite(atr) && typeof closePrice === 'number' && closePrice > 0) {
    const atrPct = (atr / closePrice) * 100;
    if (atrPct < 0.5) volatilityLabel = 'low';
    else if (atrPct > 2.0) volatilityLabel = 'high';
  }

  return {
    score,
    setupGrade,
    context: {
      session,
      volatilityLabel,
      trendLabel: 'breakout',
    },
  };
}

/**
 * Maps a strategy rejection reason to a broad rejection class.
 * Used for legacy analytics grouping.
 * @param {string} reason
 * @returns {"no_signal"|"weak_conditions"|"sizing_error"|"data_quality"|"unknown"}
 */
export function mapRejectionClass(reason) {
  if (['no_breakout', 'near_breakout', 'overextended_breakout'].includes(reason)) return 'no_signal';
  if (['weak_volume', 'missing_volume', 'atr_too_low', 'weak_risk_reward', 'score_below_threshold'].includes(reason)) return 'weak_conditions';
  if (['invalid_stop_distance', 'invalid_position_size'].includes(reason)) return 'sizing_error';
  if (['insufficient_market_data'].includes(reason)) return 'data_quality';
  return 'unknown';
}

/**
 * Maps a rejection reason to a grouped analytics category.
 * Used for the enhanced rejection analytics endpoint.
 * @param {string} reason
 * @returns {"signal_quality"|"data_quality"|"execution_guard"|"risk_guard"}
 */
export function mapRejectionGroup(reason) {
  const groups = {
    signal_quality: ['no_breakout', 'near_breakout', 'overextended_breakout', 'weak_volume', 'missing_volume', 'atr_too_low', 'weak_risk_reward', 'score_below_threshold'],
    data_quality: ['insufficient_market_data'],
    execution_guard: ['invalid_stop_distance', 'invalid_position_size'],
    risk_guard: ['duplicate_position_guard', 'max_positions_guard', 'daily_loss_guard', 'cooldown_guard'],
  };

  for (const [group, reasons] of Object.entries(groups)) {
    if (reasons.includes(reason)) return group;
  }
  return 'signal_quality';
}
