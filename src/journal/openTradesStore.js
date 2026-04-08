// Open trade store — persists open position context across days.
// Stored in storage/trades/open.json
// Provides the strategy, stop, target, and risk data that Alpaca doesn't return.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { normalizeSymbol } from "../utils/symbolNorm.js";
import { logger } from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRADES_DIR = resolve(__dirname, "../../storage/trades");
const OPEN_TRADES_PATH = resolve(TRADES_DIR, "open.json");

function ensureDir() {
  if (!existsSync(TRADES_DIR)) mkdirSync(TRADES_DIR, { recursive: true });
}

function readTrades() {
  if (!existsSync(OPEN_TRADES_PATH)) return [];
  try {
    const parsed = JSON.parse(readFileSync(OPEN_TRADES_PATH, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    logger.error("Failed to read open trades store", { error: err.message });
    return [];
  }
}

function writeTrades(trades) {
  ensureDir();
  writeFileSync(OPEN_TRADES_PATH, JSON.stringify(trades, null, 2), "utf-8");
}

export function getOpenTrades() {
  return readTrades();
}

/**
 * Saves or updates an open trade record.
 * @param {object} trade
 * @returns {object} The saved record
 */
export function saveOpenTrade(trade) {
  const trades = readTrades();
  const key = normalizeSymbol(trade.symbol);
  const idx = trades.findIndex((t) => normalizeSymbol(t.symbol) === key);
  const record = { ...trade, status: "open" };
  if (idx >= 0) {
    trades[idx] = record;
  } else {
    trades.push(record);
  }
  writeTrades(trades);
  return record;
}

/**
 * Removes an open trade record by symbol.
 * @param {string} symbol
 */
export function removeOpenTrade(symbol) {
  const key = normalizeSymbol(symbol);
  const trades = readTrades().filter((t) => normalizeSymbol(t.symbol) !== key);
  writeTrades(trades);
}

/**
 * Finds an open trade record by symbol. Returns null if not found.
 * @param {string} symbol
 * @returns {object|null}
 */
export function findOpenTrade(symbol) {
  const key = normalizeSymbol(symbol);
  return readTrades().find((t) => normalizeSymbol(t.symbol) === key) ?? null;
}
