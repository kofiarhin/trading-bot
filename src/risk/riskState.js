// File-based risk state — persisted to storage/riskState.json.
// Tracks daily loss and per-symbol cooldowns.
// Resets daily loss counter when a new trading day starts (ET date).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { etDateString } from "../utils/time.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = resolve(__dirname, "../../storage/riskState.json");

function ensureDir() {
  const dir = dirname(STATE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function defaultState(date) {
  return { date, dailyRealizedLoss: 0, cooldowns: {} };
}

export function loadRiskState() {
  ensureDir();
  const today = etDateString();

  if (!existsSync(STATE_PATH)) {
    return defaultState(today);
  }

  try {
    const raw = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
    // Reset if a new day
    if (raw.date !== today) {
      return defaultState(today);
    }
    return raw;
  } catch {
    return defaultState(today);
  }
}

export function saveRiskState(state) {
  ensureDir();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Records a realized loss (positive number = loss, negative = profit).
 * Updates and persists the state.
 * @param {number} lossAmount  Negative means profit (reduces daily loss).
 */
export function recordDailyLoss(lossAmount) {
  const state = loadRiskState();
  state.dailyRealizedLoss += lossAmount;
  saveRiskState(state);
}

/**
 * Returns the accumulated daily realized loss.
 * @returns {number}
 */
export function getDailyLoss() {
  return loadRiskState().dailyRealizedLoss;
}

/**
 * Sets a cooldown for a symbol after closing a trade.
 * @param {string} symbol
 * @param {"stock"|"crypto"} assetClass
 */
export function setCooldown(symbol, assetClass) {
  const state = loadRiskState();
  const cooldownMs = assetClass === "crypto"
    ? 6 * 60 * 60 * 1000      // 6 hours for crypto
    : 24 * 60 * 60 * 1000;    // 1 trading day for stocks
  state.cooldowns[symbol] = new Date(Date.now() + cooldownMs).toISOString();
  saveRiskState(state);
}

/**
 * Returns true if a symbol is in cooldown.
 * @param {string} symbol
 * @returns {boolean}
 */
export function isInCooldown(symbol) {
  const state = loadRiskState();
  const expiry = state.cooldowns[symbol];
  if (!expiry) return false;
  return new Date(expiry) > new Date();
}
