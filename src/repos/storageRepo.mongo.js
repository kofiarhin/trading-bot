import path from 'node:path';
import { createHash } from 'node:crypto';

import { connectMongo } from '../db/connectMongo.js';
import OpenTrade from '../models/OpenTrade.js';
import ClosedTrade from '../models/ClosedTrade.js';
import TradeEvent from '../models/TradeEvent.js';
import Decision from '../models/Decision.js';
import CycleLog from '../models/CycleLog.js';
import JournalRecord from '../models/JournalRecord.js';
import RiskState from '../models/RiskState.js';

const RISK_STATE_KEY = 'risk-state';

function normalizePath(filePath) {
  return path.normalize(filePath).replace(/\\/g, '/');
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stripMongo(doc) {
  if (!doc) return doc;
  const plain = doc.toObject ? doc.toObject() : { ...doc };
  delete plain._id;
  delete plain.__v;
  return plain;
}

function toDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function resolveTarget(filePath) {
  const normalized = normalizePath(filePath);

  if (/storage\/trades\/open\.json$/u.test(normalized) || /trades\/open\.json$/u.test(normalized)) {
    return { type: 'openTrades' };
  }

  if (/storage\/trades\/closed\.json$/u.test(normalized) || /trades\/closed\.json$/u.test(normalized)) {
    return { type: 'closedTrades' };
  }

  if (/storage\/trades\/events\.json$/u.test(normalized) || /trades\/events\.json$/u.test(normalized)) {
    return { type: 'tradeEvents' };
  }

  if (/storage\/riskState\.json$/u.test(normalized) || /riskState\.json$/u.test(normalized)) {
    return { type: 'riskState' };
  }

  const datedMatch = normalized.match(/(?:storage\/)?(decisions|logs|journal)\/(\d{4}-\d{2}-\d{2})\.json$/u);
  if (datedMatch) {
    return { type: datedMatch[1], date: datedMatch[2] };
  }

  throw new Error(`Unsupported storage path: ${filePath}`);
}

function mapTradeEventForWrite(item = {}) {
  const fallbackId = createHash('sha1')
    .update(JSON.stringify(item))
    .digest('hex');
  const eventId = item.eventId ?? item.id ?? fallbackId;
  return {
    ...item,
    eventId,
    id: item.id ?? eventId,
    date: item.date ?? (item.timestamp ? String(item.timestamp).slice(0, 10) : undefined),
  };
}

function mapJournalRecordForWrite(item = {}, date) {
  return {
    date,
    recordType: item.recordType ?? item.type ?? 'journal',
    timestamp: item.timestamp ?? new Date().toISOString(),
    payload: cloneValue(item),
  };
}

function mapJournalRecordForRead(doc) {
  return cloneValue(doc.payload ?? {});
}

function mapRiskStateForWrite(value = {}) {
  return {
    ...value,
    key: value.key ?? RISK_STATE_KEY,
    date: value.date ?? toDateKey(),
    halted: Boolean(value.halted ?? false),
    dailyLossPct: Number(value.dailyLossPct ?? 0),
    dailyRealizedLoss: Number(value.dailyRealizedLoss ?? 0),
    cooldowns: value.cooldowns ?? {},
    updatedAt: value.updatedAt ?? new Date().toISOString(),
  };
}

async function replaceCollection(Model, docs) {
  await Model.deleteMany({});
  if (!docs.length) return [];
  const inserted = await Model.insertMany(docs, { ordered: true });
  return inserted.map(stripMongo);
}

async function replaceDateScopedCollection(Model, date, docs) {
  await Model.deleteMany({ date });
  if (!docs.length) return [];
  const inserted = await Model.insertMany(docs, { ordered: true });
  return inserted.map(stripMongo);
}

export async function readStoragePath(filePath, defaultValue) {
  await connectMongo();
  const target = resolveTarget(filePath);

  switch (target.type) {
    case 'openTrades': {
      const docs = await OpenTrade.find({}).lean();
      return docs.map(stripMongo);
    }
    case 'closedTrades': {
      const docs = await ClosedTrade.find({}).lean();
      return docs.map(stripMongo);
    }
    case 'tradeEvents': {
      const docs = await TradeEvent.find({}).sort({ timestamp: 1, eventId: 1 }).lean();
      return docs.map(stripMongo);
    }
    case 'decisions': {
      const docs = await Decision.find({ date: target.date }).sort({ timestamp: 1 }).lean();
      return docs.map(stripMongo);
    }
    case 'logs': {
      const docs = await CycleLog.find({ date: target.date }).sort({ recordedAt: 1, timestamp: 1 }).lean();
      return docs.map(stripMongo);
    }
    case 'journal': {
      const docs = await JournalRecord.find({ date: target.date }).sort({ timestamp: 1 }).lean();
      return docs.map(mapJournalRecordForRead);
    }
    case 'riskState': {
      const doc = await RiskState.findOne({ key: RISK_STATE_KEY }).lean();
      return doc ? stripMongo(doc) : cloneValue(defaultValue);
    }
    default:
      return cloneValue(defaultValue);
  }
}

export async function writeStoragePath(filePath, value) {
  await connectMongo();
  const target = resolveTarget(filePath);

  switch (target.type) {
    case 'openTrades': {
      await replaceCollection(OpenTrade, Array.isArray(value) ? value : []);
      return value;
    }
    case 'closedTrades': {
      await replaceCollection(ClosedTrade, Array.isArray(value) ? value : []);
      return value;
    }
    case 'tradeEvents': {
      const docs = Array.isArray(value) ? value.map(mapTradeEventForWrite) : [];
      await replaceCollection(TradeEvent, docs);
      return value;
    }
    case 'decisions': {
      const docs = Array.isArray(value)
        ? value.map((item) => ({ ...item, date: target.date }))
        : [];
      await replaceDateScopedCollection(Decision, target.date, docs);
      return value;
    }
    case 'logs': {
      const docs = Array.isArray(value)
        ? value.map((item) => ({ ...item, date: target.date }))
        : [];
      await replaceDateScopedCollection(CycleLog, target.date, docs);
      return value;
    }
    case 'journal': {
      const docs = Array.isArray(value)
        ? value.map((item) => mapJournalRecordForWrite(item, target.date))
        : [];
      await replaceDateScopedCollection(JournalRecord, target.date, docs);
      return value;
    }
    case 'riskState': {
      await RiskState.findOneAndUpdate(
        { key: RISK_STATE_KEY },
        mapRiskStateForWrite(value ?? {}),
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      );
      return value;
    }
    default:
      return value;
  }
}

export async function appendStoragePath(filePath, item) {
  await connectMongo();
  const target = resolveTarget(filePath);

  switch (target.type) {
    case 'openTrades': {
      const doc = await OpenTrade.create(item);
      return stripMongo(doc);
    }
    case 'closedTrades': {
      const doc = await ClosedTrade.create(item);
      return stripMongo(doc);
    }
    case 'tradeEvents': {
      const doc = await TradeEvent.create(mapTradeEventForWrite(item));
      return stripMongo(doc);
    }
    case 'decisions': {
      const doc = await Decision.create({ ...item, date: target.date });
      return stripMongo(doc);
    }
    case 'logs': {
      const doc = await CycleLog.create({ ...item, date: target.date });
      return stripMongo(doc);
    }
    case 'journal': {
      const doc = await JournalRecord.create(mapJournalRecordForWrite(item, target.date));
      return mapJournalRecordForRead(stripMongo(doc));
    }
    case 'riskState': {
      const doc = await RiskState.findOneAndUpdate(
        { key: RISK_STATE_KEY },
        mapRiskStateForWrite(item ?? {}),
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      );
      return stripMongo(doc);
    }
    default:
      return cloneValue(item);
  }
}
