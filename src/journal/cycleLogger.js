// Cycle logger — appends one JSON record per autopilot cycle run to MongoDB.
import { logger } from '../utils/logger.js';
import { appendCycleEvent } from '../repositories/cycleRepo.mongo.js';

/**
 * Appends a cycle summary record.
 * @param {object} record
 */
export async function logCycle(record) {
  try {
    await appendCycleEvent({ ...record, recordedAt: new Date().toISOString() });
  } catch (err) {
    logger.error('Failed to write cycle log', { error: err.message });
  }
}

/**
 * Logs a skipped cycle (e.g. outside market hours).
 * @param {string} reason
 */
export async function logSkipped(reason) {
  logger.info('Cycle skipped', { reason });
  await logCycle({ type: 'skipped', reason, timestamp: new Date().toISOString() });
}

/**
 * Logs a completed cycle summary.
 * @param {{ scanned: number, approved: number, placed: number, skipped: number, errors: number }} summary
 */
export async function logCycleComplete(summary) {
  logger.info('Cycle complete', summary);
  await logCycle({ type: 'completed', ...summary, timestamp: new Date().toISOString() });
}
