/**
 * Portfolio-level risk controls.
 * Runs after per-symbol guards to enforce aggregate exposure limits.
 *
 * Checks:
 *   1. Total open risk cap — sum of all open + candidate risk vs account equity.
 *      A position protected by a broker-side stop counts as
 *      (current price − stop limit) × quantity; otherwise its journal riskAmount.
 *   2. Correlation buckets — max positions per asset class (stock | crypto)
 *   3. Drawdown throttle — reduce candidate slots when daily loss exceeds throttle threshold
 */

import { config as runtimeConfig } from '../config/env.js';
import { normalizeSymbol } from '../utils/symbolNorm.js';
import { openRiskForTrade } from './openRisk.js';
import { isActiveTradeStatus } from '../journal/tradeStatus.js';


function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function inferAssetClass(symbol) {
  return typeof symbol === 'string' && symbol.includes('/') ? 'crypto' : 'stock';
}

function symbolKey(symbol) {
  return normalizeSymbol(String(symbol ?? ''));
}

export { openRiskForTrade };

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
 *   riskConfig?: {
 *     maxTotalRiskPct?: number,
 *     maxCorrelatedPositions?: number,
 *     drawdownThrottlePct?: number,
 *     dailyLossLimitPct?: number,
 *   }
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
  riskConfig = {},
}) {
  const maxTotalRiskPct = toNumber(riskConfig.maxTotalRiskPct ?? runtimeConfig.risk.maxTotalRiskPct, 5) / 100;
  const maxCorrelated = toNumber(riskConfig.maxCorrelatedPositions ?? runtimeConfig.risk.maxCorrelatedPositions, 3);
  const drawdownThrottlePct = toNumber(riskConfig.drawdownThrottlePct ?? runtimeConfig.risk.drawdownThrottlePct, 1) / 100;
  const dailyLossLimitPct = toNumber(riskConfig.dailyLossLimitPct ?? runtimeConfig.risk.maxDailyLossPercent, 2) / 100;

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
  // Keyed by normalized symbol so "SOL/USD" and "SOLUSD" count once.
  const activeTrades = (openTrades ?? []).filter((t) => isActiveTradeStatus(t.status));
  const classBySymbol = new Map();
  for (const p of brokerPositions ?? []) {
    const cls = p.asset_class === 'crypto' ? 'crypto' : p.asset_class === 'us_equity' ? 'stock' : inferAssetClass(p.symbol);
    classBySymbol.set(symbolKey(p.symbol), cls);
  }
  for (const t of activeTrades) {
    const key = symbolKey(t.normalizedSymbol ?? t.symbol);
    if (!classBySymbol.has(key)) classBySymbol.set(key, t.assetClass ?? inferAssetClass(t.symbol));
  }

  // Count existing open positions per asset class
  const openCountByClass = { stock: 0, crypto: 0 };
  for (const cls of classBySymbol.values()) {
    openCountByClass[cls] = (openCountByClass[cls] ?? 0) + 1;
  }

  // ── Total open risk already committed ────────────────────────────────────────
  const positionFor = (trade) =>
    (brokerPositions ?? []).find((p) => symbolKey(p.symbol) === symbolKey(trade.normalizedSymbol ?? trade.symbol));
  const existingRisk = activeTrades.reduce((sum, t) => sum + openRiskForTrade(t, positionFor(t)), 0);

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
