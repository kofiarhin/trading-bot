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
  removeOpenTrade,
  addClosedTrade,
} from "../journal/tradeJournal.js";
import { normalizeSymbol } from "../utils/symbolNorm.js";
import { normalizeTradeForWrite } from "../journal/normalizeTrade.js";

function pickFirstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
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
  if (!fields.quantity || Number(fields.quantity) < 1) {
    const error = "quantity must be >= 1";
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
    pendingTrade = await createPendingTrade({
      decision: {
        ...decision,
        // Pass canonical field names so the journal record never picks up the
        // legacy aliases from the original decision shape.
        symbol: fields.symbol,
        assetClass: fields.assetClass,
        strategyName: fields.strategyName,
        entryPrice: fields.entryPrice,
        stopLoss: fields.stopLoss,
        takeProfit: fields.takeProfit,
        quantity: fields.quantity,
        riskAmount: fields.riskAmount,
      },
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
    response = await submitOrder({
      symbol: fields.symbol,
      qty: fields.quantity,
      side: fields.side,
      assetClass: fields.assetClass,
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
      const { updateOpenTrade } = await import("../journal/openTradesStore.js");
      updateOpenTrade(tradeId, { brokerOrderId: response.id ?? null });
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
 * Closes an open trade: submits market close to broker, calculates pnl,
 * archives in journal as a canonical closed-trade record. Reads the open trade
 * record via the journal accessor (which normalizes any legacy fields), so
 * legacy-shaped open records are still closeable but the closed record always
 * goes back to disk in canonical shape.
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

  if (dryRun || isDryRunEnabled({ dryRun })) {
    logger.info("[DRY RUN] Would close trade", { symbol: normalizedSym, reason, currentPrice });
    return { closed: false, dryRun: true, exitReason: reason };
  }

  logger.info("Closing position", { symbol: normalizedSym, reason, currentPrice });

  let fillPrice = currentPrice;
  let orderId = null;
  let orderStatus = null;

  try {
    const response = await closePosition(normalizedSym);
    fillPrice = response.filled_avg_price ? parseFloat(response.filled_avg_price) : currentPrice;
    orderId = response.id ?? null;
    orderStatus = response.status ?? null;
    logger.info("Position closed at broker", { symbol: normalizedSym, fillPrice, orderId });
  } catch (err) {
    logger.error("Close position failed at broker", { symbol: normalizedSym, reason, error: err.message });
    return { closed: false, error: err.message, exitReason: reason };
  }

  // Archive in journal — read normalises legacy aliases, write enforces
  // canonical only.
  try {
    const trade = await getOpenTradeById(tradeId);
    if (!trade) {
      logger.warn("closeTrade: trade not found in journal, skipping archive", { tradeId, symbol });
      return { closed: true, exitPrice: fillPrice, orderId, orderStatus, exitReason: reason };
    }

    const quantity = trade.quantity ?? 0;
    const entry = trade.entryPrice ?? 0;
    const pnl = entry && quantity ? (fillPrice - entry) * quantity : null;
    const pnlPct = entry && pnl != null ? ((fillPrice - entry) / entry) * 100 : null;

    const closedTrade = normalizeTradeForWrite({
      ...trade,
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

export default {
  placeOrder,
  closeTrade,
};
