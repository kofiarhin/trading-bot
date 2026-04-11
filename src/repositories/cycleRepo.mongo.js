/**
 * MongoDB repository for cycle run events.
 * Mirrors the function signatures used by cycleLogger.js and storage.appendLogEvent.
 */
import CycleRun from '../models/CycleRun.js';
import { londonDateString } from '../utils/time.js';

function nowIso() {
  return new Date().toISOString();
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function appendCycleEvent(record) {
  const date = londonDateString();
  const doc = await CycleRun.create({
    ...record,
    recordedAt: record.recordedAt ?? nowIso(),
    date,
  });
  return stripMongo(doc.toObject());
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getCyclesForDate(date = londonDateString()) {
  const docs = await CycleRun.find({ date }).sort({ recordedAt: 1 }).lean();
  return docs.map(stripMongo);
}

export async function getLatestCompletedCycle() {
  const doc = await CycleRun.findOne({ type: 'completed' }).sort({ recordedAt: -1 }).lean();
  return doc ? stripMongo(doc) : null;
}

/**
 * Returns the most recent terminal cycle event — completed, skipped_outside_overlap, or failed.
 * Use this when the dashboard needs to show what the last scheduled run actually did.
 */
export async function getLatestCycleRun() {
  const doc = await CycleRun.findOne({
    type: { $in: ['completed', 'skipped_outside_overlap', 'failed'] },
  }).sort({ recordedAt: -1 }).lean();
  return doc ? stripMongo(doc) : null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripMongo(doc) {
  if (!doc) return doc;
  const { _id, __v, ...rest } = doc;
  return rest;
}
