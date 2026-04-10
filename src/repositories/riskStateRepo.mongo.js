/**
 * MongoDB repository for risk state.
 * Singleton document keyed by date (ET). Resets on new trading day.
 */
import RiskState from '../models/RiskState.js';
import { etDateString } from '../utils/time.js';

function defaultState(date) {
  return { date, dailyRealizedLoss: 0, cooldowns: {} };
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
  let doc = await RiskState.findOne({ date: today });

  if (!doc) {
    // New day — upsert a fresh state
    doc = await RiskState.findOneAndUpdate(
      { date: today },
      { $setOnInsert: defaultState(today) },
      { upsert: true, returnDocument: 'after' },
    );
  }

  return docToPlain(doc);
}

// ─── Save ─────────────────────────────────────────────────────────────────────

export async function saveRiskState(state) {
  const doc = await RiskState.findOneAndUpdate(
    { date: state.date },
    {
      dailyRealizedLoss: state.dailyRealizedLoss,
      cooldowns: state.cooldowns ?? {},
    },
    { upsert: true, returnDocument: 'after' },
  );
  return docToPlain(doc);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export async function recordDailyLoss(lossAmount) {
  const today = etDateString();
  const doc = await RiskState.findOneAndUpdate(
    { date: today },
    { $inc: { dailyRealizedLoss: lossAmount } },
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
  const today = etDateString();

  await RiskState.findOneAndUpdate(
    { date: today },
    { $set: { [`cooldowns.${symbol}`]: expiry } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
}

export async function isInCooldown(symbol) {
  const state = await loadRiskState();
  const expiry = state.cooldowns?.[symbol];
  if (!expiry) return false;
  return new Date(expiry) > new Date();
}
