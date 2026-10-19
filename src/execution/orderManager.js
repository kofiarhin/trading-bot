// Order manager — canonical execution layer for both entry and exit.
//
// All trade execution flows through placeOrder() and closeTrade() in this
// module. They share the same canonical trade contract and both write canonical
// records to the journal (legacy aliases like `stop`, `target`, `qty`, `risk`,
// `strategy` are never persisted by this layer).
import { submitOrder, closePosition } from "./alpacaTrading.js";
import { isDryRunEnabled } from "../lib/alpaca.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/env.js";
import {
  createPendingTrade,
  markTradeOpen,
  markTradeCanceled,
  getOpenTradeById,
  addOpenTrade,
  removeOpenTrade,
  addClosedTrade,
} from "../journal/tradeJournal.js";
import { normalizeSymbol } from "../utils/symbolNorm.js";
import { normalizeTradeForWrite } from "../journal/normalizeTrade.js";
import { BOT_ORDER_PREFIX, cancelBotStop, restoreProtectiveStop } from "./protectiveStops.js";
import { recordTradeOutcome } from "../risk/riskState.js";
import { isEligibleNow } from "../market/marketHours.js";

import { EXIT_FAILURE_ALERT_THRESHOLD } from "../journal/tradeStatus.js";

const PROTECTED_STATUSES = new Set(["active", "partial", "unfilled"]);

function pickFirstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

/**
 * Throws if any required entry field is missing or logically invalid.
 * Called after canonical field extraction, before any broker or storage op.
 */
function validateEntryFields({ entryPrice, stopLoss, takeProfit, quantity }) {
  if (!entryPrice || entryPrice <= 0) throw new Error('entryPrice must be > 0');
  if (!stopLoss || stopLoss <= 0) throw new Error('stopLoss must be > 0');
  if (!takeProfit || takeProfit <= 0) throw new Error('takeProfit must be > 0');
  if (!quantity || quantity <= 0) throw new Error('quantity must be > 0');
  if (stopLoss >= entryPrice) throw new Error('stopLoss must be < entryPrice');
  if (takeProfit <= entryPrice) throw new Error('takeProfit must be > entryPrice');
}

/**
 * Reads a (possibly legacy-shaped) decision and returns the canonical entry
 * fields needed by both the journal and the broker submission step.
 */
function extractCanonicalDecisionFields(decision = {}) {
  const symbol = decision.symbol;
  const normalizedSymbol = symbol ? normalizeSymbol(symbol) : null;
  const quantity = pickFirstDefined(decision.quantity, decision.qty);
  const stopLoss = pickFirstDefined(decision.stopLoss, decision.stop);
  const takeProfit = pickFirstDefined(decision.takeProfit, decision.target);
  const riskAmount = pickFirstDefined(decision.riskAmount, decision.risk);
  const strategyName = pickFirstDefined(
    decision.strategyName,
    decision.strategy,
  );
  const entryPrice = pickFirstDefined(decision.entryPrice, decision.close);
  const assetClass = decision.assetClass ?? "stock";
  const side = decision.side ?? "buy";

  return {
    symbol,
    normalizedSymbol,
    assetClass,
    strategyName: strategyName ?? "breakout",
    entryPrice: entryPrice ?? null,
    stopLoss: stopLoss ?? null,
    takeProfit: takeProfit ?? null,
    quantity,
    riskAmount: riskAmount ?? null,
    side,
  };
}

/**
 * Submits a paper trade order with pre-flight safety checks.
 *
 * Canonical entry path used by autopilot and any other caller. Creates a
 * pending trade journal record before submission, then transitions to open on
 * fill confirmation. The journal record is written in canonical shape only
 * (legacy aliases such as `stop`/`target`/`qty`/`risk`/`strategy` are never
 * persisted).
 *
 * Returns:
 *   {
 *     placed,        // boolean — did the order actually go to the broker
 *     submitted,     // alias for `placed` (back-compat)
 *     dryRun,        // boolean — was this a dry-run pass-through
 *     tradeId?,      // canonical journal id if a pending record was created
 *     orderId?,      // broker order id
 *     orderStatus?,  // broker order status
 *     order?,        // broker response payload
 *     payload,       // canonical fields used for the submission attempt
 *     message?,      // human-readable status / skip reason
 *     error?,
 *   }
 *
 * @param {{ decision: object, dryRun?: boolean }} params
 */
export async function placeOrder({ decision, dryRun = false }) {
  if (!decision || typeof decision !== "object") {
    return { placed: false, submitted: false, dryRun: false, message: "Decision missing" };
  }

  if (!decision.symbol) {
    return { placed: false, submitted: false, dryRun: false, message: "Decision missing symbol" };
  }

  // Approval check is preserved for back-compat with the old placeOrder.js
  // contract — autopilot already filters on `approved`, but other callers may
  // not.
  if (decision.approved === false) {
    return {
      placed: false,
      submitted: false,
      dryRun: false,
      message: "Decision not approved",
    };
  }

  const fields = extractCanonicalDecisionFields(decision);

  validateEntryFields(fields);

  const payload = {
    symbol: fields.symbol,
    normalizedSymbol: fields.normalizedSymbol,
    quantity: fields.quantity,
    side: fields.side,
    assetClass: fields.assetClass,
    entryPrice: fields.entryPrice,
    stopLoss: fields.stopLoss,
    takeProfit: fields.takeProfit,
    strategyName: fields.strategyName,
    riskAmount: fields.riskAmount,
  };

  // Safety: paper mode only.
  if (config.trading.runMode !== "paper") {
    const error = "live trading mode is disabled in v1";
    logger.error("Order blocked — live mode", { symbol: fields.symbol, error });
    return { placed: false, submitted: false, dryRun: false, error, message: error, payload };
  }

  // Safety: quantity must be a positive number.
  // Crypto supports fractional quantities; stocks require whole shares (>= 1).
  const minQty = fields.assetClass === 'crypto' ? 0.000001 : 1;
  if (!fields.quantity || Number(fields.quantity) < minQty) {
    const error = fields.assetClass === 'crypto' ? 'quantity must be > 0 for crypto' : 'quantity must be >= 1';
    logger.error("Order blocked — invalid quantity", { symbol: fields.symbol, qty: fields.quantity });
    return { placed: false, submitted: false, dryRun: false, error, message: error, payload };
  }

  if (dryRun || isDryRunEnabled({ dryRun })) {
    logger.info("[DRY RUN] Would submit order", payload);
    return {
      placed: false,
      submitted: false,
      dryRun: true,
      payload,
      message: "Dry-run mode prevented order submission",
    };
  }

  // Create canonical pending trade record before order submission.
  let pendingTrade = null;
  try {
    // Build a clean canonical decision — never spread legacy aliases into the journal.
    const canonicalDecision = {
      symbol: fields.symbol,
      normalizedSymbol: fields.normalizedSymbol,
      assetClass: fields.assetClass,
      strategyName: fields.strategyName,
      entryPrice: fields.entryPrice,
      stopLoss: fields.stopLoss,
      takeProfit: fields.takeProfit,
      quantity: fields.quantity,
      riskAmount: fields.riskAmount,
      side: fields.side,
    };
    // Preserve non-legacy auxiliary fields from the original decision.
    if (decision.id != null) canonicalDecision.id = decision.id;
    if (decision.timestamp != null) canonicalDecision.timestamp = decision.timestamp;
    if (decision.metrics != null) canonicalDecision.metrics = decision.metrics;
    if (decision.approved != null) canonicalDecision.approved = decision.approved;

    pendingTrade = await createPendingTrade({
      decision: canonicalDecision,
      source: "autopilot",
    });
  } catch (journalErr) {
    logger.error("Failed to create pending trade — aborting order", {
      symbol: fields.symbol,
      error: journalErr.message,
    });
    return {
      placed: false,
      submitted: false,
      dryRun: false,
      error: journalErr.message,
      message: journalErr.message,
      payload,
    };
  }

  const tradeId = pendingTrade.tradeId;
  logger.info("Submitting order", {
    symbol: fields.symbol,
    qty: fields.quantity,
    entryPrice: fields.entryPrice,
    tradeId,
  });

  let response;
  try {
    // Entry is a market order; the broker-side protective stop is placed by
    // the broker sync once the fill shows up as a position (see autopilot).
    response = await submitOrder({
      symbol: fields.normalizedSymbol,
      qty: fields.quantity,
      side: fields.side,
      assetClass: fields.assetClass,
      clientOrderId: `${BOT_ORDER_PREFIX}entry-${tradeId}`,
    });
  } catch (err) {
    logger.error("Order failed", { symbol: fields.symbol, tradeId, error: err.message });

    try {
      await markTradeCanceled({ tradeId, reason: err.message });
    } catch (cancelErr) {
      logger.warn("Failed to cancel pending trade after order failure (non-fatal)", {
        tradeId,
        error: cancelErr.message,
      });
    }

    return {
      placed: false,
      submitted: false,
      dryRun: false,
      tradeId,
      error: err.message,
      message: err.message,
      payload,
    };
  }

  logger.info("Order accepted", {
    symbol: fields.symbol,
    orderId: response.id,
    status: response.status,
    tradeId,
  });

  const isFilled =
    response.status === "filled" ||
    (response.filled_avg_price != null && parseFloat(response.filled_avg_price) > 0);

  if (isFilled) {
    try {
      await markTradeOpen({
        tradeId,
        order: response,
        source: "autopilot",
      });
    } catch (openErr) {
      logger.error("Failed to mark trade open after fill", {
        symbol: fields.symbol,
        tradeId,
        error: openErr.message,
      });
    }
  } else {
    // Order accepted but not yet filled — record the broker order id on the
    // pending journal record so subsequent broker syncs can match it.
    try {
      const existingTrade = await getOpenTradeById(tradeId);
      if (existingTrade) {
        await addOpenTrade({ ...existingTrade, brokerOrderId: response.id ?? null });
      }
    } catch (updateErr) {
      logger.warn("Failed to update brokerOrderId on pending trade (non-fatal)", {
        tradeId,
        error: updateErr.message,
      });
    }
  }

  return {
    placed: true,
    submitted: true,
    dryRun: false,
    tradeId,
    orderId: response.id,
    orderStatus: response.status,
    order: response,
    payload,
    response,
  };
}

/**
 * Closes an open trade at the broker.
 *
 * Safety order of operations:
 *   1. Never act on a trade whose exit is already working ("closing"), on a
 *      position protected by an external stop, or on a stock outside market
 *      hours (a queued market order would leave the position unprotected).
 *   2. Cancel the bot's own protective stop (ownership verified at the broker)
 *      so its reserved quantity is released.
 *   3. Submit the close. If it fails, count the attempt and re-place the stop
 *      immediately.
 *   4. Archive as closed only on a confirmed fill, at the broker fill price.
 *      An accepted-but-unfilled close marks the trade "closing"; the broker
 *      sync settles it later.
 *
 * @param {{
 *   tradeId: string,
 *   symbol: string,
 *   exitPrice: number,
 *   reason: string,
 *   dryRun?: boolean,
 * }} params
 */
export async function closeTrade({ tradeId, symbol, exitPrice: currentPrice, reason, dryRun = false }) {
  const normalizedSym = normalizeSymbol(symbol);

  if (dryRun || isDryRunEnabled({})) {
    logger.info("[DRY RUN] Would close trade", { symbol: normalizedSym, reason, currentPrice });
    return { closed: false, dryRun: true, exitReason: reason };
  }

  let trade = null;
  try {
    trade = await getOpenTradeById(tradeId);
  } catch (err) {
    logger.warn("closeTrade: could not read trade before close", { tradeId, error: err.message });
  }
  const protection = trade?.protection;

  if (trade?.status === "closing") {
    return { closed: false, pending: true, error: "exit_in_progress", orderId: trade.exitOrderId ?? null, exitReason: reason };
  }

  if (protection?.owner === "external" && PROTECTED_STATUSES.has(protection.status)) {
    logger.warn("Close skipped — position protected by an external stop order", { symbol: normalizedSym, reason });
    return { closed: false, error: "externally_protected", exitReason: reason };
  }

  const isCrypto = (trade?.assetClass ?? "") === "crypto" || String(trade?.symbol ?? symbol).includes("/");
  if (!isCrypto && !isEligibleNow("stock")) {
    logger.warn("Close deferred — stock market closed", { symbol: normalizedSym, reason });
    return { closed: false, error: "market_closed", exitReason: reason };
  }

  let canceledOwnStop = false;
  if (protection?.owner === "bot" && protection.orderId && PROTECTED_STATUSES.has(protection.status)) {
    try {
      const cancel = await cancelBotStop({ orderId: protection.orderId });
      if (!cancel.canceled) {
        logger.error("Close skipped — protective stop cancel not confirmed", { symbol: normalizedSym, reason: cancel.reason });
        return { closed: false, error: "protective_stop_cancel_unconfirmed", exitReason: reason };
      }
      canceledOwnStop = true;
    } catch (err) {
      logger.error("Close skipped — protective stop cancel failed", { symbol: normalizedSym, error: err.message });
      return { closed: false, error: err.message, exitReason: reason };
    }
  }

  logger.info("Closing position", { symbol: normalizedSym, reason, currentPrice });

  let response;
  try {
    response = await closePosition(normalizedSym);
  } catch (err) {
    logger.error("Close position failed at broker", { symbol: normalizedSym, reason, error: err.message });
    const restored = canceledOwnStop ? await restoreAfterFailedExit(trade, normalizedSym) : null;
    const exitAttempts = await recordExitFailure(trade, err.message, restored);
    return {
      closed: false,
      error: err.message,
      exitReason: reason,
      exitAttempts,
      stopRestored: restored?.action === "placed",
    };
  }

  const orderId = response?.id ?? null;
  const orderStatus = response?.status ?? null;
  const filledAvg = parseFloat(response?.filled_avg_price);
  const isFilled = orderStatus === "filled" && Number.isFinite(filledAvg) && filledAvg > 0;

  if (!isFilled) {
    // Accepted but not filled yet: never archive on an assumed price.
    if (trade) {
      try {
        await addOpenTrade({
          ...trade,
          status: "closing",
          exitOrderId: orderId,
          closingAt: new Date().toISOString(),
          closingReason: reason,
          ...(canceledOwnStop ? { protection: { ...protection, status: "missing", lastOrderStatus: "canceled_for_exit" } } : {}),
        });
      } catch (err) {
        logger.error("Failed to mark trade closing", { tradeId, error: err.message });
      }
    }
    logger.warn("Exit order accepted but not filled — trade marked closing", { symbol: normalizedSym, orderId, orderStatus });
    return { closed: false, pending: true, orderId, orderStatus, exitReason: reason };
  }

  const fillPrice = filledAvg;
  logger.info("Position closed at broker", { symbol: normalizedSym, fillPrice, orderId });

  // Archive in journal — read normalises legacy aliases, write enforces
  // canonical only.
  try {
    const archived = trade ?? (await getOpenTradeById(tradeId));
    if (!archived) {
      logger.warn("closeTrade: trade not found in journal, skipping archive", { tradeId, symbol });
      return { closed: true, exitPrice: fillPrice, orderId, orderStatus, exitReason: reason };
    }

    const quantity = archived.quantity ?? 0;
    const entry = archived.entryPrice ?? 0;
    const pnl = entry && quantity ? (fillPrice - entry) * quantity : null;
    const pnlPct = entry && pnl != null ? ((fillPrice - entry) / entry) * 100 : null;

    const closedTrade = normalizeTradeForWrite({
      ...archived,
      status: "closed",
      exitPrice: fillPrice,
      pnl: pnl != null ? Number(pnl.toFixed(2)) : null,
      pnlPct: pnlPct != null ? Number(pnlPct.toFixed(4)) : null,
      exitReason: reason,
      closedAt: new Date().toISOString(),
    });

    await removeOpenTrade(tradeId);
    await addClosedTrade(closedTrade);

    logger.info("Trade archived as closed", { tradeId, symbol, exitReason: reason, pnl: closedTrade.pnl });

    try {
      await recordTradeOutcome(closedTrade);
    } catch (err) {
      logger.error("Failed to record trade outcome (daily loss / cooldown)", { tradeId, error: err.message });
    }
  } catch (journalErr) {
    logger.error("Failed to archive closed trade in journal (broker close already submitted)", {
      tradeId,
      symbol,
      error: journalErr.message,
    });
  }

  return {
    closed: true,
    exitPrice: fillPrice,
    orderId,
    orderStatus,
    exitReason: reason,
  };
}

async function restoreAfterFailedExit(trade, normalizedSym) {
  if (!trade) return null;
  const bufferPct = (config.risk?.cryptoStopLimitBufferPct ?? 2) / 100;
  const restored = await restoreProtectiveStop({ trade, symbol: normalizedSym, bufferPct });
  if (restored.action !== "placed") {
    logger.error("Protective stop NOT restored after failed exit — position may be unprotected", {
      symbol: normalizedSym,
      tradeId: trade.tradeId,
      action: restored.action,
      error: restored.error ?? null,
    });
  }
  return restored;
}

async function recordExitFailure(trade, message, restored) {
  if (!trade) return null;
  const exitAttempts = Number(trade.exitAttempts ?? 0) + 1;
  const next = { ...trade, exitAttempts, lastExitError: message };
  if (restored?.protection) {
    next.protection = restored.protection;
  } else if (restored) {
    next.protection = { ...(trade.protection ?? {}), status: "missing", lastOrderStatus: "canceled_for_exit" };
  }
  try {
    await addOpenTrade(next);
  } catch (err) {
    logger.error("Failed to record exit failure", { tradeId: trade.tradeId, error: err.message });
  }
  if (exitAttempts >= EXIT_FAILURE_ALERT_THRESHOLD) {
    logger.error("Exit failing repeatedly — manual attention needed", {
      symbol: trade.symbol,
      tradeId: trade.tradeId,
      exitAttempts,
      lastExitError: message,
    });
  }
  return exitAttempts;
}

export default {
  placeOrder,
  closeTrade,
};
