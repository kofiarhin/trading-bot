/**
 * One-time migration: reads all existing JSON files from storage/ and upserts them into MongoDB.
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   node -r ./src/config/loadEnv.cjs src/db/migrateJsonToMongo.js
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { connectMongo } from './connectMongo.js';
import OpenTrade from '../models/OpenTrade.js';
import ClosedTrade from '../models/ClosedTrade.js';
import TradeEvent from '../models/TradeEvent.js';
import Decision from '../models/Decision.js';
import CycleRun from '../models/CycleRun.js';
import RiskState from '../models/RiskState.js';
import { normalizeTradeForRead, normalizeTradeForWrite } from '../journal/normalizeTrade.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE = path.resolve(__dirname, '../../storage');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJsonFile(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function listJsonFiles(dir) {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
  } catch {
    return [];
  }
}

function dateFromFilename(filename) {
  return filename.replace(/\.json$/, '');
}

function log(msg) {
  console.log(`[migrate] ${msg}`);
}

// ─── Migrate open trades ───────────────────────────────────────────────────────

async function migrateOpenTrades() {
  const filePath = path.join(STORAGE, 'trades', 'open.json');
  const records = readJsonFile(filePath, []);
  if (!Array.isArray(records) || !records.length) {
    log('open trades: no data');
    return;
  }

  let count = 0;
  for (const raw of records) {
    const trade = normalizeTradeForWrite(normalizeTradeForRead(raw));
    if (!trade?.tradeId) continue;
    await OpenTrade.findOneAndUpdate(
      { tradeId: trade.tradeId },
      trade,
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    count++;
  }
  log(`open trades: migrated ${count}`);
}

// ─── Migrate closed trades ─────────────────────────────────────────────────────

async function migrateClosedTrades() {
  const filePath = path.join(STORAGE, 'trades', 'closed.json');
  const records = readJsonFile(filePath, []);
  if (!Array.isArray(records) || !records.length) {
    log('closed trades: no data');
    return;
  }

  let count = 0;
  for (const raw of records) {
    const trade = normalizeTradeForWrite(normalizeTradeForRead(raw));
    if (!trade?.tradeId) continue;
    await ClosedTrade.findOneAndUpdate(
      { tradeId: trade.tradeId },
      trade,
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    count++;
  }
  log(`closed trades: migrated ${count}`);
}

// ─── Migrate trade events ──────────────────────────────────────────────────────

async function migrateTradeEvents() {
  // events.json (all-time)
  const eventsPath = path.join(STORAGE, 'trades', 'events.json');
  const allEvents = readJsonFile(eventsPath, []);

  // journal daily files (may overlap — dedupe by id)
  const journalDir = path.join(STORAGE, 'journal');
  const journalFiles = listJsonFiles(journalDir);
  const journalEvents = [];
  for (const file of journalFiles) {
    const date = dateFromFilename(file);
    const records = readJsonFile(path.join(journalDir, file), []);
    if (!Array.isArray(records)) continue;
    for (const r of records) {
      journalEvents.push({ ...r, date });
    }
  }

  // Merge, prefer events.json version, dedupe by id
  const byId = new Map();
  for (const e of [...allEvents, ...journalEvents]) {
    if (!e?.id) continue;
    if (!byId.has(e.id)) byId.set(e.id, e);
  }

  let count = 0;
  for (const event of byId.values()) {
    const date = event.date ?? (event.timestamp ?? '').slice(0, 10) ?? null;
    await TradeEvent.findOneAndUpdate(
      { id: event.id },
      { ...event, date },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    count++;
  }
  log(`trade events: migrated ${count}`);
}

// ─── Migrate decisions ─────────────────────────────────────────────────────────

async function migrateDecisions() {
  const decisionsDir = path.join(STORAGE, 'decisions');
  const files = listJsonFiles(decisionsDir);
  let count = 0;

  for (const file of files) {
    const date = dateFromFilename(file);
    const records = readJsonFile(path.join(decisionsDir, file), []);
    if (!Array.isArray(records)) continue;

    for (const record of records) {
      if (!record?.symbol) continue;
      // Use timestamp + symbol as natural key (no unique id in original schema)
      await Decision.findOneAndUpdate(
        { date, symbol: record.symbol, timestamp: record.timestamp },
        { ...record, date },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      count++;
    }
  }
  log(`decisions: migrated ${count}`);
}

// ─── Migrate cycle runs ────────────────────────────────────────────────────────

async function migrateCycleRuns() {
  const logsDir = path.join(STORAGE, 'logs');
  const files = listJsonFiles(logsDir);
  let count = 0;

  for (const file of files) {
    const date = dateFromFilename(file);
    const records = readJsonFile(path.join(logsDir, file), []);
    if (!Array.isArray(records)) continue;

    for (const record of records) {
      // Natural key: date + type + timestamp
      await CycleRun.findOneAndUpdate(
        { date, type: record.type, timestamp: record.timestamp, recordedAt: record.recordedAt },
        { ...record, date },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      count++;
    }
  }
  log(`cycle runs: migrated ${count}`);
}

// ─── Migrate risk state ────────────────────────────────────────────────────────

async function migrateRiskState() {
  const filePath = path.join(STORAGE, 'riskState.json');
  const state = readJsonFile(filePath, null);
  if (!state?.date) {
    log('risk state: no data');
    return;
  }

  await RiskState.findOneAndUpdate(
    { date: state.date },
    {
      date: state.date,
      dailyRealizedLoss: state.dailyRealizedLoss ?? 0,
      cooldowns: state.cooldowns ?? {},
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  log(`risk state: migrated for date ${state.date}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log('Connecting to MongoDB...');
  await connectMongo();
  log('Connected. Starting migration...');

  await migrateOpenTrades();
  await migrateClosedTrades();
  await migrateTradeEvents();
  await migrateDecisions();
  await migrateCycleRuns();
  await migrateRiskState();

  log('Migration complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] Fatal error:', err.message);
  process.exit(1);
});
