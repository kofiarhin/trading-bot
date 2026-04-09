// Closed trade store — persists completed trade history.
// Stored in storage/trades/closed.json
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { logger } from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRADES_DIR = resolve(__dirname, "../../storage/trades");
const CLOSED_TRADES_PATH = resolve(TRADES_DIR, "closed.json");

function ensureDir() {
  if (!existsSync(TRADES_DIR)) mkdirSync(TRADES_DIR, { recursive: true });
}

function readTrades() {
  if (!existsSync(CLOSED_TRADES_PATH)) return [];
  try {
    const parsed = JSON.parse(readFileSync(CLOSED_TRADES_PATH, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    logger.error("Failed to read closed trades store", { error: err.message });
    return [];
  }
}

export function getClosedTrades() {
  return readTrades();
}

/**
 * Appends a closed trade record.
 * @param {{
 *   symbol: string,
 *   normalizedSymbol: string,
 *   assetClass: string,
 *   strategyName: string,
 *   openedAt: string,
 *   closedAt: string,
 *   entryPrice: number,
 *   exitPrice: number,
 *   quantity: number,
 *   pnl: number,
 *   pnlPct: number,
 *   exitReason: string,
 * }} trade
 */
export function appendClosedTrade(trade) {
  const trades = readTrades();
  trades.push(trade);
  ensureDir();
  writeFileSync(CLOSED_TRADES_PATH, JSON.stringify(trades, null, 2), "utf-8");
}
