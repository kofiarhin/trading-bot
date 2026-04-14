/**
 * positionEnricher.js
 *
 * Shared canonical enrichment for open/live positions.
 *
 * Every merged position record gets:
 *   origin           — "strategy" | "broker_sync"
 *   managementStatus — "managed" | "derived" | "unmanaged"
 *   riskSource       — "journal" | "derived" | "none"
 *   exitCoverage     — "full" | "partial" | "none"
 *   stopLoss         — number | null
 *   takeProfit       — number | null
 *   riskPerUnit      — number | null
 *
 * For broker_sync positions where a journal trade exists, risk fields
 * are inherited from the journal record. When not available, ATR-based
 * or fixed-% derivation is attempted (controlled by env config).
 *
 * managementStatus semantics:
 *   managed   — stop AND target present, sourced from journal
 *   derived   — stop/target computed by this module (ATR or fixed %)
 *   unmanaged — no stop, no target, no derivation possible
 */

import { logger } from '../utils/logger.js';
import { appendTradeEvent } from '../repositories/tradeJournalRepo.mongo.js';

// Read broker-sync config lazily from process.env so this module can be loaded
// in test environments that don't have Alpaca credentials set (those are only
// required by env.js which validates them at startup).
function getBrokerSyncConfig() {
  const enableDerivedRisk = process.env.BROKER_SYNC_ENABLE_DERIVED_RISK !== 'false';
  const stopPct = parseFloat(process.env.BROKER_SYNC_STOP_PCT ?? '0.02');
  const targetRMultiple = parseFloat(process.env.BROKER_SYNC_TARGET_R_MULTIPLE ?? '2');
  const trailingAtrMultiplier = parseFloat(process.env.TRAILING_ATR_MULTIPLIER ?? '1.5');
  return {
    enableDerivedRisk,
    stopPct: Number.isFinite(stopPct) ? stopPct : 0.02,
    targetRMultiple: Number.isFinite(targetRMultiple) ? targetRMultiple : 2,
    trailingAtrMultiplier: Number.isFinite(trailingAtrMultiplier) ? trailingAtrMultiplier : 1.5,
  };
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Enriches a single merged position record with management metadata.
 *
 * @param {{
 *   tradeId?: string,
 *   symbol: string,
 *   strategyName?: string,
 *   stopLoss?: number|null,
 *   takeProfit?: number|null,
 *   riskAmount?: number|null,
 *   entryPrice?: number|null,
 *   avgEntryPrice?: number|null,
 *   metrics?: { atr?: number },
 * }} journalTrade  — journal OpenTrade record (may be null for orphaned positions)
 * @param {{
 *   avg_entry_price?: string|number,
 *   current_price?: string|number,
 * }} [brokerPosition]  — raw Alpaca broker position (optional)
 * @returns {object}  — enrichment fields to spread into the merged position
 */
export function enrichPosition(journalTrade, brokerPosition = null) {
  const isBrokerSync =
    !journalTrade || (journalTrade.strategyName ?? '') === 'broker_sync';

  const origin = isBrokerSync ? 'broker_sync' : 'strategy';

  // ── For strategy-originated trades: management is fully journal-backed ──────
  if (!isBrokerSync) {
    const hasStop = journalTrade.stopLoss != null && toNumber(journalTrade.stopLoss, 0) > 0;
    const hasTarget = journalTrade.takeProfit != null && toNumber(journalTrade.takeProfit, 0) > 0;
    const entryPrice = toNumber(journalTrade.entryPrice, 0);
    const stopLoss = hasStop ? toNumber(journalTrade.stopLoss, 0) : null;
    const riskPerUnit = (entryPrice > 0 && stopLoss) ? round2(entryPrice - stopLoss) : null;

    return {
      origin,
      managementStatus: 'managed',
      riskSource: 'journal',
      exitCoverage: hasStop && hasTarget ? 'full' : hasStop ? 'partial' : 'none',
      stopLoss: hasStop ? journalTrade.stopLoss : null,
      takeProfit: hasTarget ? journalTrade.takeProfit : null,
      riskPerUnit,
    };
  }

  // ── Broker-sync: attempt to populate risk state ───────────────────────────
  const { enableDerivedRisk, stopPct, targetRMultiple, trailingAtrMultiplier } = getBrokerSyncConfig();

  // 1. Journal stop/target if available (non-null, non-zero)
  const journalStop = journalTrade
    ? toNumber(journalTrade.stopLoss, 0) || null
    : null;
  const journalTarget = journalTrade
    ? toNumber(journalTrade.takeProfit, 0) || null
    : null;

  if (journalStop || journalTarget) {
    const entry = toNumber(journalTrade?.entryPrice, 0) ||
      toNumber(brokerPosition?.avg_entry_price, 0);
    const riskPerUnit = (entry > 0 && journalStop) ? round2(entry - journalStop) : null;
    return {
      origin,
      managementStatus: 'managed',
      riskSource: 'journal',
      exitCoverage: journalStop && journalTarget ? 'full' : journalStop ? 'partial' : 'none',
      stopLoss: journalStop,
      takeProfit: journalTarget,
      riskPerUnit,
    };
  }

  if (!enableDerivedRisk) {
    _emitUnmanaged(journalTrade, 'derived_risk_disabled');
    return _unmanagedResult(origin);
  }

  // 2. ATR-derived stop if ATR/metrics are available
  const atr = toNumber(journalTrade?.metrics?.atr, 0);
  const entry =
    toNumber(journalTrade?.entryPrice, 0) ||
    toNumber(brokerPosition?.avg_entry_price, 0);

  if (atr > 0 && entry > 0) {
    const derivedStop = round2(entry - trailingAtrMultiplier * atr);
    const riskPerUnit = round2(entry - derivedStop);
    const derivedTarget = round2(entry + targetRMultiple * riskPerUnit);

    return {
      origin,
      managementStatus: 'derived',
      riskSource: 'derived',
      exitCoverage: 'full',
      stopLoss: derivedStop,
      takeProfit: derivedTarget,
      riskPerUnit,
    };
  }

  // 3. Fixed-percent stop
  if (entry > 0 && stopPct > 0) {
    const derivedStop = round2(entry * (1 - stopPct));
    const riskPerUnit = round2(entry - derivedStop);
    const derivedTarget = round2(entry + targetRMultiple * riskPerUnit);

    return {
      origin,
      managementStatus: 'derived',
      riskSource: 'derived',
      exitCoverage: 'full',
      stopLoss: derivedStop,
      takeProfit: derivedTarget,
      riskPerUnit,
    };
  }

  // 4. Truly unmanaged
  _emitUnmanaged(journalTrade, 'no_entry_price_or_atr');
  return _unmanagedResult(origin);
}

function _unmanagedResult(origin) {
  return {
    origin,
    managementStatus: 'unmanaged',
    riskSource: 'none',
    exitCoverage: 'none',
    stopLoss: null,
    takeProfit: null,
    riskPerUnit: null,
  };
}

function _emitUnmanaged(journalTrade, reason) {
  if (!journalTrade?.tradeId) return;
  const event = {
    type: 'unmanaged_position_detected',
    tradeId: journalTrade.tradeId,
    symbol: journalTrade.symbol,
    timestamp: new Date().toISOString(),
    reason,
  };
  logger.warn('Unmanaged broker-sync position detected', event);
  // best-effort persist
  appendTradeEvent(event).catch(() => {});
}
