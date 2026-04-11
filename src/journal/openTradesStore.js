// LEGACY — not on the active runtime path.
// tradeJournal.js now reads/writes open trades directly via
// repositories/tradeJournalRepo.mongo.js.  This module survives only because
// the openTradesStore.test.js suite exercises the storage bridge
// (lib/storage.js → repos/storageRepo.mongo.js → MongoDB).
// Do not add new callers.  Migrate any remaining callers to tradeJournal.js.
import { getStoragePath, readJson, writeJson } from '../lib/storage.js';
import { normalizeSymbol } from '../utils/symbolNorm.js';

const OPEN_TRADES_PATH = getStoragePath('trades', 'open.json');

function normalizeTradeRecord(trade) {
  if (!trade || typeof trade !== 'object') return null;

  const symbol = trade.symbol ?? trade.normalizedSymbol ?? null;
  if (!symbol) return null;

  return {
    ...trade,
    tradeId: trade.tradeId ?? normalizeSymbol(symbol),
    symbol,
    normalizedSymbol: normalizeSymbol(trade.normalizedSymbol ?? symbol),
    status: trade.status ?? 'open',
  };
}

async function readTrades() {
  const parsed = await readJson(OPEN_TRADES_PATH, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeTradeRecord).filter(Boolean);
}

async function writeTrades(trades) {
  await writeJson(OPEN_TRADES_PATH, trades);
}

export async function getOpenTrades() {
  return readTrades();
}

export async function saveOpenTrade(trade) {
  const trades = await readTrades();
  const record = normalizeTradeRecord(trade);

  if (!record) {
    throw new Error('Open trade requires a symbol');
  }

  const key = record.normalizedSymbol;
  const idx = trades.findIndex((item) => item.normalizedSymbol === key);

  if (idx >= 0) {
    trades[idx] = record;
  } else {
    trades.push(record);
  }

  await writeTrades(trades);
  return record;
}

export async function upsertOpenTrade(trade) {
  const trades = await readTrades();
  const record = normalizeTradeRecord(trade);

  if (!record) {
    throw new Error('Open trade requires a symbol');
  }

  const now = new Date().toISOString();
  let idx = -1;

  if (record.tradeId) {
    idx = trades.findIndex((item) => item.tradeId === record.tradeId);
  }

  if (idx < 0) {
    idx = trades.findIndex((item) => item.normalizedSymbol === record.normalizedSymbol);
  }

  if (idx >= 0) {
    trades[idx] = { ...trades[idx], ...record, updatedAt: now };
  } else {
    trades.push({ ...record, updatedAt: now });
  }

  await writeTrades(trades);
  return idx >= 0 ? trades[idx] : trades[trades.length - 1];
}

export async function updateOpenTrade(tradeId, updates) {
  const trades = await readTrades();
  const idx = trades.findIndex((trade) => trade.tradeId === tradeId);

  if (idx < 0) {
    throw new Error(`Open trade not found by tradeId: ${tradeId}`);
  }

  trades[idx] = { ...trades[idx], ...updates, updatedAt: new Date().toISOString() };
  await writeTrades(trades);
  return trades[idx];
}

export async function removeOpenTrade(symbol) {
  const key = normalizeSymbol(symbol);
  const trades = (await readTrades()).filter((trade) => trade.normalizedSymbol !== key);
  await writeTrades(trades);
}

export async function removeOpenTradeById(tradeId) {
  const trades = (await readTrades()).filter((trade) => trade.tradeId !== tradeId);
  await writeTrades(trades);
}

export async function findOpenTrade(symbol) {
  const key = normalizeSymbol(symbol);
  return (await readTrades()).find((trade) => trade.normalizedSymbol === key) ?? null;
}

export async function findOpenTradeBySymbol(symbol) {
  return findOpenTrade(symbol);
}

export async function findOpenTradeByTradeId(tradeId) {
  return (await readTrades()).find((trade) => trade.tradeId === tradeId) ?? null;
}
