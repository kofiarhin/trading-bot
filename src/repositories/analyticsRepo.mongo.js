/**
 * MongoDB repository for analytics queries.
 * Provides period-scoped reads for closed trades, decisions, and candidates.
 */

import ClosedTrade from '../models/ClosedTrade.js';
import Decision from '../models/Decision.js';
import { etDateString } from '../utils/time.js';

function daysAgoIso(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function stripMongo(doc) {
  if (!doc) return doc;
  const { _id, __v, ...rest } = doc;
  return rest;
}

// ─── Closed Trades ────────────────────────────────────────────────────────────

/**
 * Returns closed trades with closedAt within the last N days.
 * @param {number} [days=30]
 * @returns {Promise<object[]>}
 */
export async function getClosedTradesForPeriod(days = 30) {
  const since = daysAgoIso(days);
  const docs = await ClosedTrade.find({ closedAt: { $gte: since } })
    .sort({ closedAt: -1 })
    .lean();
  return docs.map(stripMongo);
}

// ─── Decisions ────────────────────────────────────────────────────────────────

/**
 * Returns all decisions recorded in the last N days.
 * @param {number} [days=7]
 * @returns {Promise<object[]>}
 */
export async function getDecisionsForPeriod(days = 7) {
  const since = daysAgoIso(days);
  const docs = await Decision.find({ timestamp: { $gte: since } })
    .sort({ timestamp: -1 })
    .lean();
  return docs.map(stripMongo);
}

// Rejection reason → grouped analytics category.
// Mirrors mapRejectionGroup in breakoutStrategy.js but kept here to avoid a
// circular import (analyticsRepo is loaded in the server layer, not strategy layer).
const REJECTION_GROUP_MAP = {
  no_breakout: 'signal_quality',
  near_breakout: 'signal_quality',
  overextended_breakout: 'signal_quality',
  weak_volume: 'signal_quality',
  missing_volume: 'signal_quality',
  atr_too_low: 'signal_quality',
  weak_risk_reward: 'signal_quality',
  score_below_threshold: 'signal_quality',
  // legacy reason names kept for historical DB compatibility
  breakout_too_extended: 'signal_quality',
  invalid_risk_reward: 'signal_quality',
  insufficient_market_data: 'data_quality',
  invalid_stop_distance: 'execution_guard',
  invalid_position_size: 'execution_guard',
  duplicate_position_guard: 'risk_guard',
  max_positions_guard: 'risk_guard',
  daily_loss_guard: 'risk_guard',
  cooldown_guard: 'risk_guard',
};

function rejectionGroup(reason) {
  return REJECTION_GROUP_MAP[reason] ?? 'signal_quality';
}

/**
 * Returns rejected decisions in the last N days, grouped by rejectionClass,
 * grouped analytics category, and exact reason.
 * @param {number} [days=7]
 * @param {number} [topN=10]  max exact reasons to return in topReasons
 * @returns {Promise<{
 *   byClass: object,
 *   byReason: object,
 *   byGroup: object,
 *   bySymbol: object,
 *   topReasons: Array<{ reason: string, count: number, group: string }>,
 *   total: number,
 * }>}
 */
export async function getRejectionStats(days = 7, topN = 10) {
  const since = daysAgoIso(days);
  const docs = await Decision.find({ approved: false, timestamp: { $gte: since } })
    .lean();

  const byClass = {};
  const byReason = {};
  const byGroup = {};
  const bySymbol = {};
  const reasonGroups = {};

  for (const doc of docs) {
    const cls = doc.rejectionClass ?? 'unknown';
    const reason = doc.reason ?? 'unknown';
    const symbol = doc.symbol ?? 'unknown';
    const group = doc.rejectionGroup ?? rejectionGroup(reason);

    byClass[cls] = (byClass[cls] ?? 0) + 1;
    byReason[reason] = (byReason[reason] ?? 0) + 1;
    byGroup[group] = (byGroup[group] ?? 0) + 1;
    bySymbol[symbol] = (bySymbol[symbol] ?? 0) + 1;
    if (!reasonGroups[reason]) reasonGroups[reason] = {};
    reasonGroups[reason][group] = (reasonGroups[reason][group] ?? 0) + 1;
  }

  const topReasons = Object.entries(byReason)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([reason, count]) => {
      const groups = reasonGroups[reason] ?? {};
      const dominantGroup = Object.entries(groups)
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? rejectionGroup(reason);
      return { reason, count, group: dominantGroup };
    });

  // v2: stage-level breakdown
  const byStage = { pre_filter: 0, strategy: 0, ranked_out: 0, risk_guard: 0 };
  for (const doc of docs) {
    const stage = doc.rejectStage ?? null;
    const reason = doc.reason ?? '';
    if (stage === 'pre_filter') {
      byStage.pre_filter += 1;
    } else if (stage === 'ranked_out' || reason === 'ranked_out') {
      byStage.ranked_out += 1;
    } else if (['duplicate_position_guard', 'max_positions_guard', 'daily_loss_guard', 'cooldown_guard'].includes(reason)) {
      byStage.risk_guard += 1;
    } else {
      byStage.strategy += 1;
    }
  }

  return {
    byClass,
    byReason,
    byGroup,
    byStage,
    bySymbol,
    topReasons,
    total: docs.length,
  };
}

// ─── v2 Conversion + Score analytics ─────────────────────────────────────────

/**
 * Returns shortlist conversion rates across the pipeline for the last N days.
 * @param {number} [days=7]
 * @returns {Promise<{
 *   totalScanned: number,
 *   preFilterPassed: number,
 *   shortlisted: number,
 *   strategyApproved: number,
 *   riskApproved: number,
 *   placed: number,
 *   preFilterRate: number,
 *   shortlistRate: number,
 *   approvalRate: number,
 *   placementRate: number,
 * }>}
 */
export async function getShortlistConversionStats(days = 7) {
  const since = daysAgoIso(days);
  const docs = await Decision.find({ timestamp: { $gte: since } }).lean();

  let totalScanned = 0;
  let preFilterPassed = 0;
  let shortlisted = 0;
  let strategyApproved = 0;
  let riskApproved = 0;
  let placed = 0;

  for (const doc of docs) {
    totalScanned += 1;
    const stage = doc.rejectStage ?? null;
    const reason = doc.reason ?? '';

    if (stage === 'pre_filter') continue; // rejected at pre-filter, didn't pass

    preFilterPassed += 1;

    if (!doc.shortlisted && (stage === 'ranked_out' || reason === 'ranked_out')) continue;

    if (doc.shortlisted) {
      shortlisted += 1;
    } else {
      // shortlisted field not set — count as shortlisted if not pre-filtered/ranked-out
      shortlisted += 1;
    }

    if (!doc.approved) continue;

    strategyApproved += 1;

    const isRiskBlocked = (doc.blockers ?? []).some((b) =>
      ['duplicate_position_guard', 'max_positions_guard', 'daily_loss_guard', 'cooldown_guard'].includes(b),
    );
    if (!isRiskBlocked) {
      riskApproved += 1;
    }

    if ((doc.blockers ?? []).length === 0) {
      placed += 1;
    }
  }

  const safe = (num, den) => (den > 0 ? parseFloat((num / den).toFixed(4)) : 0);

  return {
    totalScanned,
    preFilterPassed,
    shortlisted,
    strategyApproved,
    riskApproved,
    placed,
    preFilterRate: safe(preFilterPassed, totalScanned),
    shortlistRate: safe(shortlisted, preFilterPassed),
    approvalRate: safe(strategyApproved, shortlisted),
    placementRate: safe(placed, riskApproved),
  };
}

/**
 * Returns score distribution across shortlisted/strategy-evaluated decisions in the last N days.
 * @param {number} [days=7]
 * @returns {Promise<{
 *   buckets: Array<{ range: string, count: number }>,
 *   mean: number,
 *   median: number,
 *   p90: number,
 * }>}
 */
export async function getScoreDistribution(days = 7) {
  const since = daysAgoIso(days);
  const docs = await Decision.find({
    timestamp: { $gte: since },
    setupScore: { $ne: null },
  }).lean();

  const scores = docs.map((d) => d.setupScore).filter((s) => typeof s === 'number' && Number.isFinite(s));

  const buckets = [
    { range: '0-24', count: 0 },
    { range: '25-49', count: 0 },
    { range: '50-74', count: 0 },
    { range: '75-100', count: 0 },
  ];

  for (const s of scores) {
    if (s < 25) buckets[0].count += 1;
    else if (s < 50) buckets[1].count += 1;
    else if (s < 75) buckets[2].count += 1;
    else buckets[3].count += 1;
  }

  if (scores.length === 0) {
    return { buckets, mean: 0, median: 0, p90: 0 };
  }

  const sorted = [...scores].sort((a, b) => a - b);
  const mean = parseFloat((scores.reduce((s, v) => s + v, 0) / scores.length).toFixed(2));
  const midIndex = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? parseFloat(((sorted[midIndex - 1] + sorted[midIndex]) / 2).toFixed(2))
      : sorted[midIndex];
  const p90Index = Math.floor(sorted.length * 0.9);
  const p90 = sorted[Math.min(p90Index, sorted.length - 1)];

  return { buckets, mean, median, p90 };
}

// ─── Candidates ───────────────────────────────────────────────────────────────

/**
 * Returns approved decisions for the given cycle (or latest cycle) sorted by setupScore desc.
 * @param {string} [cycleId] — omit to use the latest available.
 * @returns {Promise<object[]>}
 */
export async function getCandidatesForCycle(cycleId) {
  let query = { approved: true };

  if (cycleId) {
    // Decisions don't store cycleId directly — use the date from today
    const today = etDateString();
    query = { approved: true, date: today };
  } else {
    // Latest date that has approved decisions
    const latest = await Decision.findOne({ approved: true })
      .sort({ timestamp: -1 })
      .lean();
    if (!latest) return [];
    query = { approved: true, date: latest.date };
  }

  const docs = await Decision.find(query)
    .sort({ setupScore: -1, timestamp: -1 })
    .lean();

  return docs.map(stripMongo);
}
