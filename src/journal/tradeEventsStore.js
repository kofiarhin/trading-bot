// LEGACY — no active runtime callers.
// tradeJournal.js appends trade events directly via
// repositories/tradeJournalRepo.mongo.js (appendTradeEvent).
// This module is kept for reference only.  Do not add new callers.
import { randomUUID } from 'crypto';

import { getStoragePath, readJson, writeJson } from '../lib/storage.js';

const EVENTS_PATH = getStoragePath('trades', 'events.json');

async function readEvents() {
  const parsed = await readJson(EVENTS_PATH, []);
  return Array.isArray(parsed) ? parsed : [];
}

export async function getTradeEvents() {
  return readEvents();
}

export async function appendTradeEvent(event) {
  const events = await readEvents();
  const generatedId = event.eventId ?? event.id ?? randomUUID();
  const record = {
    eventId: generatedId,
    id: event.id ?? generatedId,
    tradeId: event.tradeId,
    symbol: event.symbol,
    type: event.type,
    message: event.message ?? '',
    timestamp: event.timestamp ?? new Date().toISOString(),
    data: event.data ?? null,
    payload: event.payload ?? event.data ?? null,
  };

  events.push(record);
  await writeJson(EVENTS_PATH, events);
  return record;
}
