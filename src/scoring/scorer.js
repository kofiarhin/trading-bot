/**
 * Standalone scoring module — extracted from breakoutStrategy.js.
 *
 * Pure function: no DB calls, no strategy imports.
 * Returns a full score breakdown per component so each piece can be stored
 * and rendered in the dashboard.
 */

import { resolveSession } from '../utils/time.js';

function envNum(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * Computes a composite setup score (0–100) with per-component breakdown.
 *
 * Components (each 0–25 pts):
 *   - momentum:   tighter distance to breakout = higher score
 *   - volume:     volumeRatio capped at 3×
 *   - atrQuality: mid-range ATR relative to price preferred (0.5%–2%)
 *   - riskReward: higher R:R = higher score (ceiling 4.0)
 *
 * Grade thresholds: A ≥ 75, B ≥ 50, C < 50.
 *
 * @param {{
 *   distanceToBreakoutPct: number|null,
 *   volumeRatio: number|null,
 *   atr: number|null,
 *   closePrice: number|null,
 *   riskReward: number|null,
 * }} metrics
 * @param {object} [opts={}]
 * @returns {{
 *   total: number,
 *   grade: "A"|"B"|"C",
 *   breakdown: { momentum: number, volume: number, atrQuality: number, riskReward: number },
 *   context: { session: string, volatilityLabel: string, trendLabel: string },
 * }}
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
  let momentum = 0;
  if (typeof distanceToBreakoutPct === 'number' && Number.isFinite(distanceToBreakoutPct) && distanceToBreakoutPct >= 0) {
    momentum = Math.max(0, 25 * (1 - distanceToBreakoutPct / maxDist));
  }

  // Volume: ratio capped at 3× → full 25 pts.
  let volume = 0;
  if (typeof volumeRatio === 'number' && Number.isFinite(volumeRatio) && volumeRatio > 0) {
    volume = Math.min(25, (volumeRatio / 3) * 25);
  }

  // ATR quality: 0.5–2% of price is mid-range (best). Outside that range, score drops.
  let atrQuality = 0;
  if (
    typeof atr === 'number' && Number.isFinite(atr) && atr > 0 &&
    typeof closePrice === 'number' && Number.isFinite(closePrice) && closePrice > 0
  ) {
    const atrPct = (atr / closePrice) * 100;
    if (atrPct >= 0.5 && atrPct <= 2.0) {
      atrQuality = 25;
    } else if (atrPct < 0.5) {
      atrQuality = Math.max(0, (atrPct / 0.5) * 25);
    } else {
      // atrPct > 2%: diminishing returns beyond 4%
      atrQuality = Math.max(0, 25 * (1 - (atrPct - 2.0) / 2.0));
    }
  }

  // R:R: normalized against ceiling of 4.
  let rrScore = 0;
  if (typeof riskReward === 'number' && Number.isFinite(riskReward) && riskReward >= minRR) {
    rrScore = Math.min(25, ((riskReward - minRR) / (4 - minRR)) * 25);
  }

  const total = Math.round(momentum + volume + atrQuality + rrScore);

  let grade;
  if (total >= 75) grade = 'A';
  else if (total >= 50) grade = 'B';
  else grade = 'C';

  const { session } = resolveSession();

  let volatilityLabel = 'mid';
  if (typeof atr === 'number' && Number.isFinite(atr) && typeof closePrice === 'number' && closePrice > 0) {
    const atrPct = (atr / closePrice) * 100;
    if (atrPct < 0.5) volatilityLabel = 'low';
    else if (atrPct > 2.0) volatilityLabel = 'high';
  }

  return {
    total,
    grade,
    breakdown: {
      momentum: Math.round(momentum),
      volume: Math.round(volume),
      atrQuality: Math.round(atrQuality),
      riskReward: Math.round(rrScore),
    },
    context: {
      session,
      volatilityLabel,
      trendLabel: 'breakout',
    },
  };
}
