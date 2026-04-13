/**
 * Portfolio-level risk controls.
 * Runs after per-symbol guards to enforce aggregate exposure limits.
 *
 * Checks:
 *   1. Total open risk cap — sum of all open + candidate riskAmounts vs account equity
 *   2. Correlation buckets — max positions per asset class (stock | crypto)
 *   3. Drawdown throttle — reduce candidate slots when daily loss exceeds throttle threshold
 */

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function inferAssetClass(symbol) {
  return typeof symbol === 'string' && symbol.includes('/') ? 'crypto' : 'stock';
}

/**
 * @typedef {object} Candidate
 * @property {string} symbol
 * @property {number|null} riskAmount
 * @property {string} [assetClass]
 */

/**
 * @typedef {object} PortfolioRiskResult
 * @property {Candidate[]} allowed
 * @property {Array<{ candidate: Candidate, reason: string }>} blocked
 */

/**
 * Evaluates portfolio-level risk for a batch of approved candidates.
 *
 * @param {{
 *   candidates: Candidate[],
 *   openTrades: object[],
 *   brokerPositions: object[],
 *   accountEquity: number,
 *   riskState: object,
 *   maxCandidatesOverride?: number,
 * }} params
 * @returns {PortfolioRiskResult}
 */
export function checkPortfolioRisk({
  candidates,
  openTrades,
  brokerPositions,
  accountEquity,
  riskState,
  maxCandidatesOverride,
}) {
  const maxTotalRiskPct = toNumber(process.env.MAX_TOTAL_RISK_PCT, 5) / 100;
  const maxCorrelated = toNumber(process.env.MAX_CORRELATED_POSITIONS, 3);
  const drawdownThrottlePct = toNumber(process.env.DRAWDOWN_THROTTLE_PCT, 1) / 100;
  const dailyLossLimitPct = toNumber(process.env.DAILY_LOSS_LIMIT_PCT, 2) / 100;

  const equity = toNumber(accountEquity, 100000);

  // ── Drawdown throttle ────────────────────────────────────────────────────────
  // If daily loss is between throttle threshold and hard lock, halve the candidate count.
  const dailyLoss = toNumber(riskState?.dailyRealizedLoss ?? riskState?.dailyLossPct, 0);
  const dailyLossPct = equity > 0 ? dailyLoss / equity : 0;
  const throttleActive = dailyLossPct >= drawdownThrottlePct && dailyLossPct < dailyLossLimitPct;

  let effectiveMax = maxCandidatesOverride ?? candidates.length;
  if (throttleActive) {
    effectiveMax = Math.max(1, Math.floor(effectiveMax / 2));
  }

  // ── Existing open positions by asset class ───────────────────────────────────
  const openSymbols = new Set([
    ...(brokerPositions ?? []).map((p) => p.symbol),
    ...(openTrades ?? [])
      .filter((t) => ['pending', 'open'].includes(t.status))
      .map((t) => t.symbol),
  ]);

  // Count existing open positions per asset class
  const openCountByClass = { stock: 0, crypto: 0 };
  for (const sym of openSymbols) {
    const cls = inferAssetClass(sym);
    openCountByClass[cls] = (openCountByClass[cls] ?? 0) + 1;
  }

  // ── Total open risk already committed ────────────────────────────────────────
  const existingRisk = (openTrades ?? [])
    .filter((t) => ['pending', 'open'].includes(t.status))
    .reduce((sum, t) => sum + toNumber(t.riskAmount, 0), 0);

  const maxTotalRisk = equity * maxTotalRiskPct;

  const allowed = [];
  const blocked = [];
  let runningRisk = existingRisk;
  const runningCountByClass = { ...openCountByClass };

  for (const candidate of candidates) {
    if (allowed.length >= effectiveMax) {
      blocked.push({ candidate, reason: 'drawdown_throttle' });
      continue;
    }

    const cls = candidate.assetClass ?? inferAssetClass(candidate.symbol);
    const candidateRisk = toNumber(candidate.riskAmount, 0);

    // Total risk cap
    if (runningRisk + candidateRisk > maxTotalRisk) {
      blocked.push({ candidate, reason: 'total_risk_cap' });
      continue;
    }

    // Correlation bucket
    if ((runningCountByClass[cls] ?? 0) >= maxCorrelated) {
      blocked.push({ candidate, reason: 'correlation_bucket' });
      continue;
    }

    allowed.push(candidate);
    runningRisk += candidateRisk;
    runningCountByClass[cls] = (runningCountByClass[cls] ?? 0) + 1;
  }

  return { allowed, blocked, throttleActive };
}
