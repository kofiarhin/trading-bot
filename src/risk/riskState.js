// MongoDB-backed risk state. Tracks daily loss and per-symbol cooldowns.
// Resets daily loss counter when a new trading day starts (ET date).
import {
  loadRiskState as repoLoad,
  saveRiskState as repoSave,
  recordDailyLoss as repoRecordLoss,
  getDailyLoss as repoGetDailyLoss,
  setCooldown as repoSetCooldown,
  isInCooldown as repoIsInCooldown,
} from '../repositories/riskStateRepo.mongo.js';

export async function loadRiskState() {
  return repoLoad();
}

export async function saveRiskState(state) {
  return repoSave(state);
}

/**
 * Records a realized loss (positive number = loss, negative = profit).
 * @param {number} lossAmount
 */
export async function recordDailyLoss(lossAmount) {
  return repoRecordLoss(lossAmount);
}

/**
 * Returns the accumulated daily realized loss.
 * @returns {Promise<number>}
 */
export async function getDailyLoss() {
  return repoGetDailyLoss();
}

/**
 * Sets a cooldown for a symbol after closing a trade.
 * @param {string} symbol
 * @param {"stock"|"crypto"} assetClass
 */
export async function setCooldown(symbol, assetClass) {
  return repoSetCooldown(symbol, assetClass);
}

/**
 * Returns true if a symbol is in cooldown.
 * @param {string} symbol
 * @returns {Promise<boolean>}
 */
export async function isInCooldown(symbol) {
  return repoIsInCooldown(symbol);
}
