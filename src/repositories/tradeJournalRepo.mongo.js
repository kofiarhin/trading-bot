/**
 * MongoDB repository for trade journal state.
 * Mirrors the function signatures used by tradeJournal.js.
 */
import { randomUUID } from 'node:crypto';
import OpenTrade from '../models/OpenTrade.js';
import ClosedTrade from '../models/ClosedTrade.js';
import TradeEvent from '../models/TradeEvent.js';
import { etDateString } from '../utils/time.js';

function nowIso() {
  return new Date().toISOString();
}

// ─── Open Trades ─────────────────────────────────────────────────────────────

export async function getOpenTrades() {
  const docs = await OpenTrade.find({}).sort({ openedAt: 1, pendingAt: 1 }).lean();
  return docs.map(stripMongo);
}

export async function getLatestOpenTrades(limit = 50) {
  const docs = await OpenTrade.find({ status: { $ne: 'canceled' } })
    .sort({ updatedAt: -1, pendingAt: -1 })
    .limit(limit)
    .lean();
  return docs.map(stripMongo);
}

export async function getOpenTradeById(tradeId) {
  const doc = await OpenTrade.findOne({ tradeId }).lean();
  return doc ? stripMongo(doc) : null;
}

export async function upsertOpenTrade(trade) {
  const doc = await OpenTrade.findOneAndUpdate(
    { tradeId: trade.tradeId },
    { ...trade, updatedAt: nowIso() },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean();
  return stripMongo(doc);
}

export async function removeOpenTrade(tradeId) {
  await OpenTrade.deleteOne({ tradeId });
}

// ─── Closed Trades ────────────────────────────────────────────────────────────

export async function getClosedTrades(limit = 200) {
  const docs = await ClosedTrade.find({}).sort({ closedAt: -1, openedAt: -1 }).limit(limit).lean();
  return docs.map(stripMongo);
}

/**
 * Returns closed trades whose closedAt ISO string falls within the given date (YYYY-MM-DD).
 * ISO strings sort lexicographically, so a string range query works correctly.
 */
export async function getClosedTradesForDate(date = etDateString()) {
  const nextDate = nextDateString(date);
  const docs = await ClosedTrade.find({
    closedAt: { $gte: date, $lt: nextDate },
  }).sort({ closedAt: -1 }).lean();
  return docs.map(stripMongo);
}

export async function upsertClosedTrade(trade) {
  const doc = await ClosedTrade.findOneAndUpdate(
    { tradeId: trade.tradeId },
    { ...trade, updatedAt: nowIso() },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean();
  return stripMongo(doc);
}

// ─── Trade Events ─────────────────────────────────────────────────────────────

export async function getTradeEvents() {
  const docs = await TradeEvent.find({}).sort({ timestamp: 1, eventId: 1 }).lean();
  return docs.map(stripMongo);
}

export async function appendTradeEvent(event) {
  const date = etDateString();
  const eventId = event.eventId ?? event.id ?? randomUUID();
  const doc = await TradeEvent.create({
    ...event,
    eventId,
    id: event.id ?? eventId,
    date,
  });
  return stripMongo(doc.toObject());
}

export async function getTradeEventsForDate(date = etDateString()) {
  const docs = await TradeEvent.find({ date }).sort({ timestamp: 1, eventId: 1 }).lean();
  return docs.map(stripMongo);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripMongo(doc) {
  if (!doc) return doc;
  const { _id, __v, ...rest } = doc;
  return rest;
}

/** Returns the YYYY-MM-DD string for the day after the given date string. */
function nextDateString(dateStr) {
  const d = new Date(dateStr + 'T12:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
