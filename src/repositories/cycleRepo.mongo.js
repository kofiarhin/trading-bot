/**
 * MongoDB repository for cycle run events.
 * Mirrors the function signatures used by cycleLogger.js and storage.appendLogEvent.
 */
import CycleRun from '../models/CycleRun.js';
import { londonDateString } from '../utils/time.js';

/**
 * Current canonical terminal cycle event types for the session-aware model.
 * New cycle events must only use these types — never legacy types.
 */
export const CANONICAL_TERMINAL_TYPES = ['completed', 'skipped', 'failed'];

/**
 * Legacy terminal event types from the pre-session overlap model.
 * These must NOT be emitted by new code. They are retained here solely for
 * backward-compatible reads of existing DB records.
 */
export const LEGACY_TERMINAL_TYPES = ['skipped_outside_overlap'];

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
 * Returns the most recent terminal cycle event — completed, skipped, or failed.
 * The query includes LEGACY_TERMINAL_TYPES so that old DB records written before
 * the session-aware refactor are still surfaced. Legacy types must not be emitted
 * by current code — this inclusion is read-compatibility only.
 */
export async function getLatestCycleRun() {
  const doc = await CycleRun.findOne({
    type: { $in: [...CANONICAL_TERMINAL_TYPES, ...LEGACY_TERMINAL_TYPES] },
  }).sort({ recordedAt: -1 }).lean();
  return doc ? stripMongo(doc) : null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripMongo(doc) {
  if (!doc) return doc;
  const { _id, __v, ...rest } = doc;
  return rest;
}
