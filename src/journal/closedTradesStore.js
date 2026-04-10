import { getStoragePath, readJson, writeJson } from '../lib/storage.js';

const CLOSED_TRADES_PATH = getStoragePath('trades', 'closed.json');

async function readTrades() {
  const parsed = await readJson(CLOSED_TRADES_PATH, []);
  return Array.isArray(parsed) ? parsed : [];
}

export async function getClosedTrades() {
  return readTrades();
}

export async function appendClosedTrade(trade) {
  const trades = await readTrades();
  trades.push(trade);
  await writeJson(CLOSED_TRADES_PATH, trades);
}
