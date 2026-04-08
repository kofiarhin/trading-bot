// Decision logger — appends one record per symbol evaluation per cycle.
// Stored in storage/decisions/YYYY-MM-DD.json
// Captures both approved and rejected decisions with full strategy context.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { etDateString } from "../utils/time.js";
import { logger } from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DECISIONS_DIR = resolve(__dirname, "../../storage/decisions");

function ensureDir() {
  if (!existsSync(DECISIONS_DIR)) mkdirSync(DECISIONS_DIR, { recursive: true });
}

function decisionsPath(date = etDateString()) {
  return resolve(DECISIONS_DIR, `${date}.json`);
}

function readDecisions(path) {
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return [];
  }
}

/**
 * Logs a strategy decision (approved or rejected) for a symbol.
 * @param {object} decision  Output from evaluateBreakout()
 * @param {string} assetClass
 */
export function logDecision(decision, assetClass) {
  ensureDir();
  const path = decisionsPath();
  const decisions = readDecisions(path);
  decisions.push({
    timestamp: decision.timestamp ?? new Date().toISOString(),
    recordedAt: new Date().toISOString(),
    symbol: decision.symbol,
    assetClass: assetClass ?? decision.assetClass ?? null,
    approved: decision.approved,
    reason: decision.reason,
    closePrice: decision.entryPrice ?? null,
    breakoutLevel: decision.breakoutLevel ?? null,
    atr: decision.atr ?? null,
    volumeRatio: decision.volumeRatio ?? null,
  });
  try {
    writeFileSync(path, JSON.stringify(decisions, null, 2), "utf-8");
  } catch (err) {
    logger.error("Failed to write decision log", { error: err.message });
  }
}
