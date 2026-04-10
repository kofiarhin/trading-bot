/**
 * MongoDB repository for strategy decisions.
 * Mirrors the function signatures used by decisionLogger.js.
 */
import Decision from '../models/Decision.js';
import { etDateString } from '../utils/time.js';

// ─── Write ────────────────────────────────────────────────────────────────────

export async function saveDecision(record) {
  const date = etDateString();
  const doc = await Decision.create({ ...record, date });
  return stripMongo(doc.toObject());
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getDecisionsForDate(date = etDateString()) {
  const docs = await Decision.find({ date }).sort({ timestamp: 1 }).lean();
  return docs.map(stripMongo);
}

export async function getLatestDecisionDate() {
  const doc = await Decision.findOne({}).sort({ date: -1, timestamp: -1 }).lean();
  return doc?.date ?? null;
}

export async function getLatestDecisions() {
  const date = await getLatestDecisionDate();
  if (!date) return { date: null, records: [] };
  const records = await getDecisionsForDate(date);
  return { date, records };
}

export async function loadDecisionLog({ date = etDateString(), fallbackToLatest = false } = {}) {
  const records = await getDecisionsForDate(date);

  if (records.length > 0) {
    return { date, records, requestedDate: date, isFallback: false, exists: true, parseFailed: false };
  }

  if (fallbackToLatest) {
    const latest = await getLatestDecisions();
    if (latest.date && latest.date !== date) {
      return {
        date: latest.date,
        records: latest.records,
        requestedDate: date,
        isFallback: true,
        exists: true,
        parseFailed: false,
      };
    }
  }

  return { date, records: [], requestedDate: date, isFallback: false, exists: false, parseFailed: false };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripMongo(doc) {
  if (!doc) return doc;
  const { _id, __v, ...rest } = doc;
  return rest;
}
