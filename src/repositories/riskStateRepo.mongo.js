/**
 * MongoDB repository for risk state.
 * Singleton document keyed by `key`. Resets daily counters when the ET day changes.
 */
import RiskState from '../models/RiskState.js';
import { etDateString } from '../utils/time.js';

const RISK_STATE_KEY = 'risk-state';

function nowIso() {
  return new Date().toISOString();
}

function defaultState(date) {
  return {
    key: RISK_STATE_KEY,
    date,
    halted: false,
    dailyLossPct: 0,
    dailyRealizedLoss: 0,
    cooldowns: {},
    updatedAt: nowIso(),
  };
}

function docToPlain(doc) {
  if (!doc) return null;
  const plain = doc.toObject ? doc.toObject() : { ...doc };
  // Convert Map to plain object for cooldowns
  if (plain.cooldowns instanceof Map) {
    plain.cooldowns = Object.fromEntries(plain.cooldowns);
  }
  delete plain._id;
  delete plain.__v;
  return plain;
}

// ─── Load ─────────────────────────────────────────────────────────────────────

export async function loadRiskState() {
  const today = etDateString();
  let doc = await RiskState.findOne({ key: RISK_STATE_KEY });

  if (!doc) {
    doc = await RiskState.findOneAndUpdate(
      { key: RISK_STATE_KEY },
      { $setOnInsert: defaultState(today) },
      { upsert: true, returnDocument: 'after' },
    );
  } else if (doc.date !== today) {
    doc = await RiskState.findOneAndUpdate(
      { key: RISK_STATE_KEY },
      {
        $set: {
          date: today,
          halted: false,
          dailyLossPct: 0,
          dailyRealizedLoss: 0,
          cooldowns: {},
          updatedAt: nowIso(),
        },
      },
      { returnDocument: 'after' },
    );
  }

  return docToPlain(doc);
}

// ─── Save ─────────────────────────────────────────────────────────────────────

export async function saveRiskState(state) {
  const today = etDateString();
  const doc = await RiskState.findOneAndUpdate(
    { key: RISK_STATE_KEY },
    {
      key: RISK_STATE_KEY,
      date: state.date ?? today,
      halted: Boolean(state.halted ?? false),
      dailyLossPct: state.dailyLossPct ?? 0,
      dailyRealizedLoss: state.dailyRealizedLoss ?? 0,
      cooldowns: state.cooldowns ?? {},
      updatedAt: state.updatedAt ?? nowIso(),
    },
    { upsert: true, returnDocument: 'after' },
  );
  return docToPlain(doc);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export async function recordDailyLoss(lossAmount) {
  const currentState = await loadRiskState();
  const doc = await RiskState.findOneAndUpdate(
    { key: RISK_STATE_KEY },
    {
      $set: {
        date: currentState.date,
        halted: Boolean(currentState.halted ?? false),
        updatedAt: nowIso(),
      },
      $inc: { dailyRealizedLoss: lossAmount },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  return docToPlain(doc);
}

export async function getDailyLoss() {
  const state = await loadRiskState();
  return state.dailyRealizedLoss;
}

export async function setCooldown(symbol, assetClass) {
  const cooldownMs = assetClass === 'crypto'
    ? 6 * 60 * 60 * 1000
    : 24 * 60 * 60 * 1000;
  const expiry = new Date(Date.now() + cooldownMs).toISOString();
  const state = await loadRiskState();

  await RiskState.findOneAndUpdate(
    { key: RISK_STATE_KEY },
    {
      $set: {
        date: state.date,
        updatedAt: nowIso(),
        [`cooldowns.${symbol}`]: expiry,
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
}

export async function isInCooldown(symbol) {
  const state = await loadRiskState();
  const expiry = state.cooldowns?.[symbol];
  if (!expiry) return false;
  return new Date(expiry) > new Date();
}
