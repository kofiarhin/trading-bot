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

  for (const doc of docs) {
    const cls = doc.rejectionClass ?? 'unknown';
    const reason = doc.reason ?? 'unknown';
    const symbol = doc.symbol ?? 'unknown';
    const group = doc.rejectionGroup ?? rejectionGroup(reason);

    byClass[cls] = (byClass[cls] ?? 0) + 1;
    byReason[reason] = (byReason[reason] ?? 0) + 1;
    byGroup[group] = (byGroup[group] ?? 0) + 1;
    bySymbol[symbol] = (bySymbol[symbol] ?? 0) + 1;
  }

  const topReasons = Object.entries(byReason)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([reason, count]) => ({ reason, count, group: rejectionGroup(reason) }));

  return {
    byClass,
    byReason,
    byGroup,
    bySymbol,
    topReasons,
    total: docs.length,
  };
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
