// Decision logger — appends one record per symbol evaluation per cycle.
// Stored in storage/decisions/YYYY-MM-DD.json
// Captures both approved and rejected decisions with full strategy context.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { etDateString } from "../utils/time.js";
import { logger } from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DECISIONS_DIR = resolve(__dirname, "../../storage/decisions");

function ensureDir() {
  if (!existsSync(DECISIONS_DIR)) mkdirSync(DECISIONS_DIR, { recursive: true });
}

export function decisionDateString(now = new Date()) {
  return etDateString(now);
}

export function decisionLogPath(date = decisionDateString()) {
  return resolve(DECISIONS_DIR, `${date}.json`);
}

function readDecisionRecords(filePath, { strict = false } = {}) {
  if (!existsSync(filePath)) return [];

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"));

    if (!Array.isArray(parsed)) {
      throw new Error("Decision log file must contain a JSON array");
    }

    return parsed;
  } catch (err) {
    logger.error("Failed to read decision log", { filePath, error: err.message });

    if (strict) {
      throw err;
    }

    return null;
  }
}

function buildDecisionRecord(decision, assetClass) {
  if (!decision || typeof decision !== "object") {
    throw new Error("Decision payload is required");
  }

  if (!decision.symbol) {
    throw new Error("Decision symbol is required");
  }

  return {
    timestamp: decision.timestamp ?? new Date().toISOString(),
    recordedAt: new Date().toISOString(),
    symbol: decision.symbol,
    assetClass: assetClass ?? decision.assetClass ?? null,
    approved: !!decision.approved,
    reason: decision.reason ?? null,
    timeframe: decision.timeframe ?? null,
    strategyName: decision.strategyName ?? null,
    closePrice: decision.closePrice ?? decision.entryPrice ?? null,
    entryPrice: decision.entryPrice ?? null,
    breakoutLevel: decision.breakoutLevel ?? null,
    atr: decision.atr ?? null,
    volumeRatio: decision.volumeRatio ?? null,
    distanceToBreakoutPct: decision.distanceToBreakoutPct ?? null,
    stopLoss: decision.stopLoss ?? null,
    takeProfit: decision.takeProfit ?? null,
    quantity: decision.quantity ?? null,
    riskAmount: decision.riskAmount ?? null,
  };
}

export function readDecisionLogForDate(date = decisionDateString()) {
  const filePath = decisionLogPath(date);
  const records = readDecisionRecords(filePath);

  return {
    date,
    filePath,
    fileName: `${date}.json`,
    exists: existsSync(filePath),
    parseFailed: records === null,
    records: records ?? [],
  };
}

export function readLatestDecisionLog() {
  if (!existsSync(DECISIONS_DIR)) return null;

  const files = readdirSync(DECISIONS_DIR)
    .filter((fileName) => /^\d{4}-\d{2}-\d{2}\.json$/.test(fileName))
    .sort()
    .reverse();

  for (const fileName of files) {
    const date = fileName.replace(/\.json$/, "");
    const filePath = resolve(DECISIONS_DIR, fileName);
    const records = readDecisionRecords(filePath);

    if (records === null) continue;

    return {
      date,
      filePath,
      fileName,
      exists: true,
      parseFailed: false,
      records,
    };
  }

  return null;
}

export function loadDecisionLog({ date = decisionDateString(), fallbackToLatest = false } = {}) {
  const requested = readDecisionLogForDate(date);

  if (requested.exists && !requested.parseFailed) {
    return { ...requested, requestedDate: date, isFallback: false };
  }

  if (fallbackToLatest) {
    const latest = readLatestDecisionLog();

    if (latest && latest.date !== date) {
      return { ...latest, requestedDate: date, isFallback: true };
    }
  }

  return { ...requested, requestedDate: date, isFallback: false };
}

/**
 * Logs a strategy decision (approved or rejected) for a symbol.
 * @param {object} decision  Output from evaluateBreakout()
 * @param {string} assetClass
 */
export function logDecision(decision, assetClass) {
  ensureDir();

  const date = decisionDateString();
  const filePath = decisionLogPath(date);
  const existingRecords = existsSync(filePath)
    ? readDecisionRecords(filePath, { strict: true })
    : [];
  const record = buildDecisionRecord(decision, assetClass);
  const nextRecords = [...existingRecords, record];

  try {
    writeFileSync(filePath, JSON.stringify(nextRecords, null, 2), "utf-8");

    return {
      date,
      filePath,
      fileName: `${date}.json`,
      totalRecords: nextRecords.length,
      record,
    };
  } catch (err) {
    logger.error("Failed to write decision log", {
      filePath,
      error: err.message,
      symbol: record.symbol,
    });
    throw err;
  }
}
