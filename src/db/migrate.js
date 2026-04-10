import 'dotenv/config';

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { connectMongo, disconnectMongo } from './connectMongo.js';
import OpenTrade from '../models/OpenTrade.js';
import ClosedTrade from '../models/ClosedTrade.js';
import TradeEvent from '../models/TradeEvent.js';
import Decision from '../models/Decision.js';
import CycleLog from '../models/CycleLog.js';
import JournalRecord from '../models/JournalRecord.js';
import RiskState from '../models/RiskState.js';
import { normalizeTradeForRead, normalizeTradeForWrite } from '../journal/normalizeTrade.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STORAGE_ROOT = path.resolve(__dirname, '../../storage');
const RISK_STATE_KEY = 'risk-state';

function log(message) {
  console.log(`[migrate:mongo] ${message}`);
}

function readJsonFile(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function listDatedJsonFiles(directoryPath) {
  if (!fs.existsSync(directoryPath)) return [];
  return fs.readdirSync(directoryPath)
    .filter((fileName) => /^\d{4}-\d{2}-\d{2}\.json$/u.test(fileName))
    .sort();
}

function dateFromFilename(fileName) {
  return fileName.replace(/\.json$/u, '');
}

function normalizeTrade(rawTrade) {
  return normalizeTradeForWrite(normalizeTradeForRead(rawTrade));
}

async function migrateOpenTrades(storageRoot) {
  const filePath = path.join(storageRoot, 'trades', 'open.json');
  const records = readJsonFile(filePath, []);
  let count = 0;

  for (const record of Array.isArray(records) ? records : []) {
    const trade = normalizeTrade(record);
    if (!trade?.tradeId) continue;

    await OpenTrade.findOneAndUpdate(
      { tradeId: trade.tradeId },
      trade,
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    count += 1;
  }

  log(`open trades migrated: ${count}`);
}

async function migrateClosedTrades(storageRoot) {
  const filePath = path.join(storageRoot, 'trades', 'closed.json');
  const records = readJsonFile(filePath, []);
  let count = 0;

  for (const record of Array.isArray(records) ? records : []) {
    const trade = normalizeTrade(record);
    if (!trade?.tradeId) continue;

    await ClosedTrade.findOneAndUpdate(
      { tradeId: trade.tradeId },
      trade,
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    count += 1;
  }

  log(`closed trades migrated: ${count}`);
}

async function migrateTradeEvents(storageRoot) {
  const filePath = path.join(storageRoot, 'trades', 'events.json');
  const records = readJsonFile(filePath, []);
  let count = 0;

  for (const record of Array.isArray(records) ? records : []) {
    const eventId = record.eventId
      ?? record.id
      ?? createHash('sha1').update(JSON.stringify(record)).digest('hex');

    await TradeEvent.findOneAndUpdate(
      { eventId },
      {
        ...record,
        eventId,
        id: record.id ?? eventId,
        date: record.date ?? (record.timestamp ? String(record.timestamp).slice(0, 10) : undefined),
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    count += 1;
  }

  log(`trade events migrated: ${count}`);
}

async function migrateDecisions(storageRoot) {
  const directoryPath = path.join(storageRoot, 'decisions');
  const files = listDatedJsonFiles(directoryPath);
  let count = 0;

  for (const fileName of files) {
    const date = dateFromFilename(fileName);
    const records = readJsonFile(path.join(directoryPath, fileName), []);

    for (const record of Array.isArray(records) ? records : []) {
      if (!record?.symbol) continue;

      await Decision.findOneAndUpdate(
        { date, symbol: record.symbol, timestamp: record.timestamp, decisionId: record.decisionId ?? null },
        { ...record, date },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      );
      count += 1;
    }
  }

  log(`decisions migrated: ${count}`);
}

async function migrateCycleLogs(storageRoot) {
  const directoryPath = path.join(storageRoot, 'logs');
  const files = listDatedJsonFiles(directoryPath);
  let count = 0;

  for (const fileName of files) {
    const date = dateFromFilename(fileName);
    const records = readJsonFile(path.join(directoryPath, fileName), []);

    for (const record of Array.isArray(records) ? records : []) {
      await CycleLog.findOneAndUpdate(
        {
          date,
          cycleId: record.cycleId ?? null,
          type: record.type ?? null,
          timestamp: record.timestamp ?? null,
          recordedAt: record.recordedAt ?? null,
        },
        { ...record, date },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      );
      count += 1;
    }
  }

  log(`cycle logs migrated: ${count}`);
}

async function migrateJournalRecords(storageRoot) {
  const directoryPath = path.join(storageRoot, 'journal');
  const files = listDatedJsonFiles(directoryPath);
  let count = 0;

  for (const fileName of files) {
    const date = dateFromFilename(fileName);
    const records = readJsonFile(path.join(directoryPath, fileName), []);

    for (const record of Array.isArray(records) ? records : []) {
      await JournalRecord.findOneAndUpdate(
        {
          date,
          recordType: record.recordType ?? record.type ?? 'journal',
          timestamp: record.timestamp ?? null,
          payload: record,
        },
        {
          date,
          recordType: record.recordType ?? record.type ?? 'journal',
          timestamp: record.timestamp ?? new Date().toISOString(),
          payload: record,
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      );
      count += 1;
    }
  }

  log(`journal records migrated: ${count}`);
}

async function migrateRiskState(storageRoot) {
  const filePath = path.join(storageRoot, 'riskState.json');
  const riskState = readJsonFile(filePath, null);

  if (!riskState || typeof riskState !== 'object') {
    log('risk state migrated: 0');
    return;
  }

  await RiskState.findOneAndUpdate(
    { key: RISK_STATE_KEY },
    {
      key: RISK_STATE_KEY,
      date: riskState.date,
      halted: Boolean(riskState.halted ?? false),
      dailyLossPct: Number(riskState.dailyLossPct ?? 0),
      dailyRealizedLoss: Number(riskState.dailyRealizedLoss ?? 0),
      cooldowns: riskState.cooldowns ?? {},
      updatedAt: riskState.updatedAt ?? new Date().toISOString(),
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );

  log('risk state migrated: 1');
}

export async function migrateStorageToMongo({ storageRoot = DEFAULT_STORAGE_ROOT } = {}) {
  await connectMongo();
  await migrateOpenTrades(storageRoot);
  await migrateClosedTrades(storageRoot);
  await migrateTradeEvents(storageRoot);
  await migrateDecisions(storageRoot);
  await migrateCycleLogs(storageRoot);
  await migrateJournalRecords(storageRoot);
  await migrateRiskState(storageRoot);
}

export async function main() {
  try {
    await migrateStorageToMongo();
    log('migration complete');
  } finally {
    await disconnectMongo();
  }
}

const executedFile = process.argv[1]?.replace(/\\/g, '/');
if (executedFile?.endsWith('/src/db/migrate.js')) {
  main().catch((error) => {
    console.error('[migrate:mongo] Fatal error:', error.message);
    process.exit(1);
  });
}
