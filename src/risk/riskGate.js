/**
 * Pre-entry risk gate — pure, no broker or database calls.
 *
 * Blocks ALL new entries for the cycle (fails closed) when:
 *   - account equity / previous-day equity is missing or invalid
 *   - trading is halted in risk state
 *   - today's loss ≥ MAX_DAILY_LOSS_PERCENT of previous-day equity
 *     (the larger of the broker equity change — realized + unrealized — and
 *     the realized loss recorded since the daily reset)
 *   - open risk ≥ MAX_TOTAL_RISK_PCT of equity
 *   - gross exposure (sum of |market value|) ≥ MAX_GROSS_EXPOSURE_PCT of equity
 *
 * All limits are percent units (2 = 2%).
 */
import { openRiskForTrade } from './openRisk.js';
import { isActiveTradeStatus } from '../journal/tradeStatus.js';
import { normalizeSymbol } from '../utils/symbolNorm.js';

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function symbolKey(symbol) {
  return normalizeSymbol(String(symbol ?? ''));
}

/**
 * @param {{
 *   account: object|null,
 *   brokerPositions?: object[],
 *   openTrades?: object[],
 *   riskState?: object,
 *   limits: { maxDailyLossPct: number, maxTotalRiskPct: number, maxGrossExposurePct: number },
 * }} params
 * @returns {{ allowed: boolean, reasons: Array<{ reason: string, value?: number, limit?: number }>, metrics: object }}
 */
export function evaluateRiskGate({ account, brokerPositions = [], openTrades = [], riskState = {}, limits }) {
  const reasons = [];
  const equity = toNumber(account?.equity, NaN);
  const lastEquity = toNumber(account?.last_equity, NaN);

  if (!(equity > 0) || !(lastEquity > 0)) {
    reasons.push({ reason: 'account_unavailable' });
    return { allowed: false, reasons, metrics: {} };
  }

  if (riskState?.halted) {
    reasons.push({ reason: 'trading_halted' });
  }

  // ── Daily loss ──────────────────────────────────────────────────────────────
  const brokerLoss = Math.max(0, lastEquity - equity);
  const realizedLoss = Math.max(0, toNumber(riskState?.dailyRealizedLoss, 0));
  const dailyLossPct = (Math.max(brokerLoss, realizedLoss) / lastEquity) * 100;
  if (dailyLossPct >= limits.maxDailyLossPct) {
    reasons.push({ reason: 'daily_loss_limit', value: round2(dailyLossPct), limit: limits.maxDailyLossPct });
  }

  // ── Open risk ───────────────────────────────────────────────────────────────
  const positionFor = (trade) =>
    (brokerPositions ?? []).find((p) => symbolKey(p.symbol) === symbolKey(trade.normalizedSymbol ?? trade.symbol));
  const openRisk = (openTrades ?? [])
    .filter((t) => isActiveTradeStatus(t.status))
    .reduce((sum, t) => sum + openRiskForTrade(t, positionFor(t)), 0);
  const openRiskPct = (openRisk / equity) * 100;
  if (openRiskPct >= limits.maxTotalRiskPct) {
    reasons.push({ reason: 'total_risk_limit', value: round2(openRiskPct), limit: limits.maxTotalRiskPct });
  }

  // ── Gross exposure ──────────────────────────────────────────────────────────
  const grossExposure = (brokerPositions ?? []).reduce((sum, p) => {
    const marketValue = toNumber(p.market_value, NaN);
    const value = Number.isFinite(marketValue)
      ? marketValue
      : toNumber(p.qty, 0) * toNumber(p.current_price, 0);
    return sum + Math.abs(value);
  }, 0);
  const grossExposurePct = (grossExposure / equity) * 100;
  if (grossExposurePct >= limits.maxGrossExposurePct) {
    reasons.push({ reason: 'gross_exposure_limit', value: round2(grossExposurePct), limit: limits.maxGrossExposurePct });
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    metrics: {
      equity,
      lastEquity,
      dailyLossPct: round2(dailyLossPct),
      openRisk: round2(openRisk),
      openRiskPct: round2(openRiskPct),
      grossExposure: round2(grossExposure),
      grossExposurePct: round2(grossExposurePct),
    },
  };
}
