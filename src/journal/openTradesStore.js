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
 * Saves or updates an open trade record by normalizedSymbol (legacy key).
 * Prefer upsertOpenTrade for new code.
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
 * Upserts an open trade record, matching by tradeId first, then normalizedSymbol.
 * Sets updatedAt on every update. Use this for all new code.
 * @param {object} trade
 * @returns {object} The saved record
 */
export function upsertOpenTrade(trade) {
  const trades = readTrades();
  const record = normalizeTradeRecord(trade);

  if (!record) {
    throw new Error("Open trade requires a symbol");
  }

  const now = new Date().toISOString();
  let idx = -1;

  if (record.tradeId) {
    idx = trades.findIndex((t) => t.tradeId === record.tradeId);
  }
  if (idx < 0) {
    idx = trades.findIndex((t) => t.normalizedSymbol === record.normalizedSymbol);
  }

  if (idx >= 0) {
    trades[idx] = { ...trades[idx], ...record, updatedAt: now };
  } else {
    trades.push({ ...record, updatedAt: now });
  }

  writeTrades(trades);
  return idx >= 0 ? trades[idx] : trades[trades.length - 1];
}

/**
 * Updates specific fields on an open trade by tradeId.
 * @param {string} tradeId
 * @param {object} updates
 * @returns {object} The updated record
 */
export function updateOpenTrade(tradeId, updates) {
  const trades = readTrades();
  const idx = trades.findIndex((t) => t.tradeId === tradeId);
  if (idx < 0) throw new Error(`Open trade not found by tradeId: ${tradeId}`);

  trades[idx] = { ...trades[idx], ...updates, updatedAt: new Date().toISOString() };
  writeTrades(trades);
  return trades[idx];
}

/**
 * Removes an open trade record by symbol (normalizedSymbol).
 * @param {string} symbol
 */
export function removeOpenTrade(symbol) {
  const key = normalizeSymbol(symbol);
  const trades = readTrades().filter((t) => t.normalizedSymbol !== key);
  writeTrades(trades);
}

/**
 * Removes an open trade record by tradeId.
 * @param {string} tradeId
 */
export function removeOpenTradeById(tradeId) {
  const trades = readTrades().filter((t) => t.tradeId !== tradeId);
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

/**
 * Finds an open trade record by symbol. Returns null if not found.
 * Alias for findOpenTrade — use this in new code.
 * @param {string} symbol
 * @returns {object|null}
 */
export function findOpenTradeBySymbol(symbol) {
  return findOpenTrade(symbol);
}

/**
 * Finds an open trade record by tradeId. Returns null if not found.
 * @param {string} tradeId
 * @returns {object|null}
 */
export function findOpenTradeByTradeId(tradeId) {
  return readTrades().find((t) => t.tradeId === tradeId) ?? null;
}
