// Trade journal — appends structured trade records to storage/journal/.
// One JSON file per trading day: storage/journal/YYYY-MM-DD.json
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { etDateString } from "../utils/time.js";
import { logger } from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const JOURNAL_DIR = resolve(__dirname, "../../storage/journal");

function ensureDir() {
  if (!existsSync(JOURNAL_DIR)) mkdirSync(JOURNAL_DIR, { recursive: true });
}

function journalPath(date = etDateString()) {
  return resolve(JOURNAL_DIR, `${date}.json`);
}

function readEntries(path) {
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return [];
  }
}

/**
 * Appends a trade journal entry for the current trading day.
 * @param {object} entry
 */
export function appendTradeEntry(entry) {
  ensureDir();
  const path = journalPath();
  const entries = readEntries(path);
  entries.push({ ...entry, recordedAt: new Date().toISOString() });
  try {
    writeFileSync(path, JSON.stringify(entries, null, 2), "utf-8");
  } catch (err) {
    logger.error("Failed to write trade journal", { error: err.message });
  }
}

/**
 * Builds a journal entry from an approved decision + order result.
 * @param {object} decision  Strategy decision
 * @param {object} orderResult  Result from placeOrder()
 * @returns {object}
 */
export function buildJournalEntry(decision, orderResult) {
  return {
    symbol: decision.symbol,
    assetClass: decision.assetClass,
    timeframe: decision.timeframe,
    signalTime: decision.timestamp,
    entryPricePlanned: decision.entryPrice,
    entryPriceFilled: orderResult.response?.filled_avg_price
      ? parseFloat(orderResult.response.filled_avg_price)
      : null,
    stopLoss: decision.stopLoss,
    takeProfit: decision.takeProfit,
    quantity: decision.quantity,
    riskAmount: decision.riskAmount,
    strategyName: "momentum_breakout_atr_v1",
    approvalReason: decision.reason,
    orderStatus: orderResult.orderStatus ?? (orderResult.dryRun ? "dry_run" : "failed"),
    orderId: orderResult.orderId ?? null,
    exitPrice: null,
    exitReason: null,
    pnl: null,
  };
}
