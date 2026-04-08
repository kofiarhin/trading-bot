// Cycle logger — appends one JSON record per autopilot cycle run.
// Stored in storage/logs/YYYY-MM-DD.json
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { etDateString } from "../utils/time.js";
import { logger } from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = resolve(__dirname, "../../storage/logs");

function ensureDir() {
  if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
}

function logPath(date = etDateString()) {
  return resolve(LOGS_DIR, `${date}.json`);
}

function readCycles(path) {
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return [];
  }
}

/**
 * Appends a cycle summary record.
 * @param {object} record
 */
export function logCycle(record) {
  ensureDir();
  const path = logPath();
  const cycles = readCycles(path);
  cycles.push({ ...record, recordedAt: new Date().toISOString() });
  try {
    writeFileSync(path, JSON.stringify(cycles, null, 2), "utf-8");
  } catch (err) {
    logger.error("Failed to write cycle log", { error: err.message });
  }
}

/**
 * Logs a skipped cycle (e.g. outside market hours).
 * @param {string} reason
 */
export function logSkipped(reason) {
  logger.info("Cycle skipped", { reason });
  logCycle({ type: "skipped", reason, timestamp: new Date().toISOString() });
}

/**
 * Logs a completed cycle summary.
 * @param {{ scanned: number, approved: number, placed: number, skipped: number, errors: number }} summary
 */
export function logCycleComplete(summary) {
  logger.info("Cycle complete", summary);
  logCycle({ type: "completed", ...summary, timestamp: new Date().toISOString() });
}
