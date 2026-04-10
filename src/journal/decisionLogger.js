// Decision logger — stores one record per symbol evaluation per cycle in MongoDB.
import { etDateString } from '../utils/time.js';
import { logger } from '../utils/logger.js';
import {
  saveDecision,
  getDecisionsForDate,
  getLatestDecisions,
  loadDecisionLog as repoLoadDecisionLog,
} from '../repositories/decisionRepo.mongo.js';

export function decisionDateString(now = new Date()) {
  return etDateString(now);
}

function buildDecisionRecord(decision, assetClass) {
  if (!decision || typeof decision !== 'object') {
    throw new Error('Decision payload is required');
  }

  if (!decision.symbol) {
    throw new Error('Decision symbol is required');
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

export async function readDecisionLogForDate(date = decisionDateString()) {
  const records = await getDecisionsForDate(date);
  return {
    date,
    exists: records.length > 0,
    parseFailed: false,
    records,
  };
}

export async function readLatestDecisionLog() {
  const latest = await getLatestDecisions();
  if (!latest.date) return null;
  return {
    date: latest.date,
    exists: true,
    parseFailed: false,
    records: latest.records,
  };
}

export async function loadDecisionLog({ date = decisionDateString(), fallbackToLatest = false } = {}) {
  return repoLoadDecisionLog({ date, fallbackToLatest });
}

/**
 * Logs a strategy decision (approved or rejected) for a symbol.
 * @param {object} decision  Output from evaluateBreakout()
 * @param {string} assetClass
 */
export async function logDecision(decision, assetClass) {
  const record = buildDecisionRecord(decision, assetClass);

  try {
    const saved = await saveDecision(record);
    return {
      date: saved.date,
      totalRecords: 1,
      record: saved,
    };
  } catch (err) {
    logger.error('Failed to write decision log', {
      error: err.message,
      symbol: record.symbol,
    });
    throw err;
  }
}
