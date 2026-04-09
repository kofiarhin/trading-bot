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

function normalizeTradeRecord(trade) {
  if (!trade || typeof trade !== "object") return null;

  const symbol = trade.symbol ?? trade.normalizedSymbol ?? null;
  if (!symbol) return null;

  return {
    ...trade,
    symbol,
    normalizedSymbol: normalizeSymbol(trade.normalizedSymbol ?? symbol),
    status: trade.status ?? "open",
  };
}

function ensureDir() {
  if (!existsSync(TRADES_DIR)) mkdirSync(TRADES_DIR, { recursive: true });
}

function readTrades() {
  if (!existsSync(OPEN_TRADES_PATH)) return [];
  try {
    const parsed = JSON.parse(readFileSync(OPEN_TRADES_PATH, "utf-8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeTradeRecord).filter(Boolean);
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
  const record = normalizeTradeRecord(trade);

  if (!record) {
    throw new Error("Open trade requires a symbol");
  }

  const key = record.normalizedSymbol;
  const idx = trades.findIndex((t) => t.normalizedSymbol === key);

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
  const trades = readTrades().filter((t) => t.normalizedSymbol !== key);
  writeTrades(trades);
}

/**
 * Finds an open trade record by symbol. Returns null if not found.
 * @param {string} symbol
 * @returns {object|null}
 */
export function findOpenTrade(symbol) {
  const key = normalizeSymbol(symbol);
  return readTrades().find((t) => t.normalizedSymbol === key) ?? null;
}
