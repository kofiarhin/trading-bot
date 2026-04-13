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

/**
 * Returns rejected decisions in the last N days, grouped by rejectionClass and reason.
 * @param {number} [days=7]
 * @returns {Promise<{ byClass: object, byReason: object, bySymbol: object }>}
 */
export async function getRejectionStats(days = 7) {
  const since = daysAgoIso(days);
  const docs = await Decision.find({ approved: false, timestamp: { $gte: since } })
    .lean();

  const byClass = {};
  const byReason = {};
  const bySymbol = {};

  for (const doc of docs) {
    const cls = doc.rejectionClass ?? 'unknown';
    const reason = doc.reason ?? 'unknown';
    const symbol = doc.symbol ?? 'unknown';

    byClass[cls] = (byClass[cls] ?? 0) + 1;
    byReason[reason] = (byReason[reason] ?? 0) + 1;
    bySymbol[symbol] = (bySymbol[symbol] ?? 0) + 1;
  }

  return { byClass, byReason, bySymbol };
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
