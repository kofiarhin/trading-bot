// Journal utilities — the internal source of truth for trade context.
// Manages the full lifecycle: pending → open → closed.
// All writes go through these functions to ensure schema validity and event logging.
import { randomUUID } from "crypto";
import {
  getOpenTrades,
  upsertOpenTrade,
  updateOpenTrade,
  findOpenTradeByTradeId,
  findOpenTradeBySymbol,
  removeOpenTradeById,
  removeOpenTrade,
} from "./openTradesStore.js";
import { appendClosedTrade } from "./closedTradesStore.js";
import { appendTradeEvent } from "./tradeEventsStore.js";
import { normalizeSymbol } from "../utils/symbolNorm.js";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const ALLOWED_STATUSES = ["pending", "open", "closed", "canceled", "orphaned"];
const ALLOWED_EXIT_REASONS = [
  "stop_hit",
  "target_hit",
  "manual_close",
  "risk_rule_close",
  "broker_sync_close",
  "canceled",
  "unknown",
];

/**
 * Validates a trade record before it is written to the store.
 * Returns { valid: boolean, errors: string[] }.
 */
export function validateTradeRecord(record) {
  const errors = [];

  if (!record.tradeId) errors.push("tradeId is required");
  if (!record.symbol || typeof record.symbol !== "string") errors.push("symbol is required");
  if (!record.assetClass) errors.push("assetClass is required");
  if (!record.strategyName) errors.push("strategyName is required");
  if (!record.openedAt && !record.decisionTimestamp) {
    errors.push("openedAt or decisionTimestamp is required");
  }

  if (!Number.isFinite(record.entryPrice) || record.entryPrice <= 0) {
    errors.push("entryPrice must be a positive finite number");
  }
  if (!Number.isFinite(record.quantity) || record.quantity <= 0) {
    errors.push("quantity must be a positive finite number");
  }
  if (!Number.isFinite(record.stopLoss) || record.stopLoss <= 0) {
    errors.push("stopLoss must be a positive finite number");
  }
  if (!Number.isFinite(record.takeProfit) || record.takeProfit <= 0) {
    errors.push("takeProfit must be a positive finite number");
  }
  if (!Number.isFinite(record.plannedRiskAmount) || record.plannedRiskAmount <= 0) {
    errors.push("plannedRiskAmount must be a positive finite number");
  }

  // Long position sanity checks
  if (record.side === "long") {
    if (
      Number.isFinite(record.stopLoss) &&
      Number.isFinite(record.entryPrice) &&
      record.stopLoss >= record.entryPrice
    ) {
      errors.push("stop must be below entry for a long position");
    }
    if (
      Number.isFinite(record.takeProfit) &&
      Number.isFinite(record.entryPrice) &&
      record.takeProfit <= record.entryPrice
    ) {
      errors.push("target must be above entry for a long position");
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Lifecycle functions
// ---------------------------------------------------------------------------

/**
 * Creates a pending trade record from an approved decision.
 * Call this before the broker order is submitted.
 *
 * @param {{
 *   symbol: string,
 *   assetClass: string,
 *   side?: string,
 *   strategyName: string,
 *   entryPrice: number,
 *   stopLoss: number,
 *   takeProfit: number,
 *   quantity: number,
 *   riskAmount: number,
 *   riskPerUnit?: number,
 *   timeframe?: string,
 *   decisionTimestamp?: string,
 *   entryReason?: string,
 *   reason?: string,
 *   metrics?: object,
 * }} tradeInput
 * @returns {object} The persisted pending trade record
 */
export function createPendingTrade(tradeInput) {
  const tradeId = randomUUID();
  const now = new Date().toISOString();

  const riskPerUnit =
    tradeInput.riskPerUnit ??
    (Number.isFinite(tradeInput.entryPrice) && Number.isFinite(tradeInput.stopLoss)
      ? Math.abs(tradeInput.entryPrice - tradeInput.stopLoss)
      : null);

  const record = {
    tradeId,
    symbol: tradeInput.symbol,
    normalizedSymbol: normalizeSymbol(tradeInput.symbol),
    assetClass: tradeInput.assetClass,
    side: tradeInput.side ?? "long",
    strategyName: tradeInput.strategyName,
    status: "pending",
    decisionTimestamp: tradeInput.decisionTimestamp ?? now,
    openedAt: null,
    entryReason: tradeInput.entryReason ?? tradeInput.reason ?? null,
    entryPrice: tradeInput.entryPrice,
    quantity: tradeInput.quantity,
    stopLoss: tradeInput.stopLoss,
    takeProfit: tradeInput.takeProfit,
    riskPerUnit,
    plannedRiskAmount: tradeInput.plannedRiskAmount ?? tradeInput.riskAmount ?? null,
    brokerOrderId: null,
    timeframe: tradeInput.timeframe ?? null,
    metrics: tradeInput.metrics ?? null,
    notes: [],
    createdAt: now,
    updatedAt: now,
  };

  const validation = validateTradeRecord(record);
  if (!validation.valid) {
    throw new Error(`Invalid trade record: ${validation.errors.join(", ")}`);
  }

  upsertOpenTrade(record);

  try {
    appendTradeEvent({
      tradeId,
      symbol: record.symbol,
      type: "decision_approved",
      message: `Trade plan created for ${record.symbol} ${record.strategyName}`,
      data: {
        entryPrice: record.entryPrice,
        stopLoss: record.stopLoss,
        takeProfit: record.takeProfit,
        quantity: record.quantity,
      },
    });
  } catch (err) {
    logger.warn("Failed to append trade event (non-fatal)", { tradeId, error: err.message });
  }

  logger.info("Pending trade created", { tradeId, symbol: record.symbol, strategyName: record.strategyName });
  return record;
}

/**
 * Transitions a pending trade to open after order fill confirmation.
 *
 * @param {string} tradeId
 * @param {{
 *   openedAt?: string,
 *   entryPrice?: number,
 *   quantity?: number,
 *   brokerOrderId?: string,
 * }} fillData
 * @returns {object} The updated record
 */
export function markTradeOpen(tradeId, fillData) {
  const trade = findOpenTradeByTradeId(tradeId);
  if (!trade) throw new Error(`Trade not found for markTradeOpen: ${tradeId}`);

  const now = new Date().toISOString();
  const updated = updateOpenTrade(tradeId, {
    status: "open",
    openedAt: fillData.openedAt ?? now,
    entryPrice: fillData.entryPrice ?? trade.entryPrice,
    quantity: fillData.quantity ?? trade.quantity,
    brokerOrderId: fillData.brokerOrderId ?? trade.brokerOrderId ?? null,
  });

  try {
    appendTradeEvent({
      tradeId,
      symbol: updated.symbol,
      type: "trade_opened",
      message: `Trade opened for ${updated.symbol}`,
      data: {
        entryPrice: updated.entryPrice,
        stopLoss: updated.stopLoss,
        takeProfit: updated.takeProfit,
        quantity: updated.quantity,
      },
    });
  } catch (err) {
    logger.warn("Failed to append trade event (non-fatal)", { tradeId, error: err.message });
  }

  logger.info("Trade marked open", { tradeId, symbol: updated.symbol, brokerOrderId: updated.brokerOrderId });
  return updated;
}

/**
 * Transitions an open trade to closed.
 * Removes from open store, appends to closed store, logs event.
 *
 * @param {string} tradeId
 * @param {{
 *   exitPrice: number|null,
 *   exitReason: string,
 *   closedAt?: string,
 *   realizedPnl?: number,
 *   realizedPnlPct?: number,
 *   brokerExitOrderId?: string,
 * }} closeData
 * @returns {object} The closed trade record
 */
export function markTradeClosed(tradeId, closeData) {
  const trade = findOpenTradeByTradeId(tradeId);
  if (!trade) throw new Error(`Trade not found for markTradeClosed: ${tradeId}`);

  const now = new Date().toISOString();
  const exitPrice = closeData.exitPrice ?? null;

  let realizedPnl = closeData.realizedPnl ?? null;
  let realizedPnlPct = closeData.realizedPnlPct ?? null;

  if (realizedPnl == null && exitPrice != null && trade.entryPrice && trade.quantity) {
    realizedPnl = (exitPrice - trade.entryPrice) * trade.quantity;
    realizedPnlPct = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
  }

  const normalizedExitReason = ALLOWED_EXIT_REASONS.includes(closeData.exitReason)
    ? closeData.exitReason
    : "unknown";

  const closedRecord = {
    ...trade,
    status: "closed",
    closedAt: closeData.closedAt ?? now,
    exitPrice,
    exitReason: normalizedExitReason,
    realizedPnl,
    realizedPnlPct,
    brokerExitOrderId: closeData.brokerExitOrderId ?? null,
    // backward-compatible field names for existing dashboard/routes
    pnl: realizedPnl,
    pnlPct: realizedPnlPct,
    updatedAt: now,
  };

  appendClosedTrade(closedRecord);

  if (trade.tradeId) {
    removeOpenTradeById(trade.tradeId);
  } else {
    removeOpenTrade(trade.symbol);
  }

  try {
    appendTradeEvent({
      tradeId,
      symbol: trade.symbol,
      type: "trade_closed",
      message: `Trade closed for ${trade.symbol}: ${normalizedExitReason}`,
      data: { exitPrice, realizedPnl, exitReason: normalizedExitReason },
    });
  } catch (err) {
    logger.warn("Failed to append trade event (non-fatal)", { tradeId, error: err.message });
  }

  logger.info("Trade marked closed and archived", {
    tradeId,
    symbol: trade.symbol,
    exitReason: normalizedExitReason,
    realizedPnl,
  });
  return closedRecord;
}

/**
 * Marks a trade as canceled. Leaves it in open store with status=canceled.
 * @param {string} tradeId
 * @param {string} [reason]
 */
export function markTradeCanceled(tradeId, reason) {
  const trade = findOpenTradeByTradeId(tradeId);
  if (!trade) return; // may have never been saved — safe to ignore

  const updated = updateOpenTrade(tradeId, { status: "canceled" });

  try {
    appendTradeEvent({
      tradeId,
      symbol: trade.symbol,
      type: "order_submitted",
      message: `Order canceled for ${trade.symbol}: ${reason ?? "unknown"}`,
      data: { reason },
    });
  } catch (err) {
    logger.warn("Failed to append trade event (non-fatal)", { tradeId, error: err.message });
  }

  logger.info("Trade marked canceled", { tradeId, symbol: trade.symbol, reason });
  return updated;
}

// ---------------------------------------------------------------------------
// Broker reconciliation
// ---------------------------------------------------------------------------

/**
 * Reconciles open journal trades against live broker positions.
 * - Journal open but no broker position → mark as broker_sync_close
 * Returns a list of sync actions taken.
 *
 * @param {Array<{ symbol: string }>} brokerPositions
 * @returns {{ synced: Array<object> }}
 */
export function syncBrokerPositionsToJournal(brokerPositions) {
  const openTrades = getOpenTrades();
  const now = new Date().toISOString();
  const synced = [];

  const brokerKeys = new Set(brokerPositions.map((p) => normalizeSymbol(p.symbol)));

  for (const trade of openTrades) {
    if (trade.status === "pending" || trade.status === "canceled") continue;

    const isInBroker = brokerKeys.has(trade.normalizedSymbol);
    if (!isInBroker) {
      logger.warn("Broker sync: journal trade has no matching broker position — closing", {
        symbol: trade.symbol,
        tradeId: trade.tradeId ?? null,
      });

      if (trade.tradeId) {
        try {
          markTradeClosed(trade.tradeId, {
            exitReason: "broker_sync_close",
            exitPrice: null,
            closedAt: now,
          });
          synced.push({ action: "broker_sync_close", tradeId: trade.tradeId, symbol: trade.symbol });
        } catch (err) {
          logger.error("Failed to sync-close stale journal trade", {
            tradeId: trade.tradeId,
            error: err.message,
          });
        }
      } else {
        // Legacy record without tradeId — remove from open store
        removeOpenTrade(trade.symbol);
        synced.push({ action: "broker_sync_remove_legacy", symbol: trade.symbol });
        logger.warn("Removed legacy open trade (no tradeId) with no broker position", {
          symbol: trade.symbol,
        });
      }
    }
  }

  return { synced };
}
