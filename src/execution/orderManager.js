// Order manager — safety checks + submission + journal lifecycle.
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

/**
 * Submits a paper trade order with pre-flight safety checks.
 * Creates a pending trade journal record before submission,
 * then transitions to open on fill confirmation.
 *
 * Returns { submitted, tradeId, orderId?, orderStatus?, dryRun?, error?, payload, response? }
 *
 * @param {{
 *   decision: object,   approved strategy decision
 *   dryRun: boolean,
 * }} params
 */
export async function placeOrder({ decision, dryRun = false }) {
  const {
    symbol,
    quantity,
    qty,
    assetClass,
    entryPrice,
    stopLoss,
    stop,
    takeProfit,
    target,
    riskAmount,
    strategyName,
    strategy,
  } = decision;

  const resolvedQty = quantity ?? qty;
  const resolvedStopLoss = stopLoss ?? stop;
  const resolvedTakeProfit = takeProfit ?? target;

  const payload = {
    symbol,
    qty: resolvedQty,
    side: "buy",
    assetClass,
    entryPrice,
    stopLoss: resolvedStopLoss,
    takeProfit: resolvedTakeProfit,
  };

  // Safety: paper mode only
  if (config.trading.runMode !== "paper") {
    const error = "live trading mode is disabled in v1";
    logger.error("Order blocked — live mode", { symbol, error });
    return { submitted: false, error, payload };
  }

  // Safety: quantity > 0
  if (!resolvedQty || resolvedQty < 1) {
    const error = "quantity must be >= 1";
    logger.error("Order blocked — invalid quantity", { symbol, qty: resolvedQty });
    return { submitted: false, error, payload };
  }

  if (dryRun) {
    logger.info("[DRY RUN] Would submit order", payload);
    return { submitted: false, dryRun: true, payload };
  }

  // Create pending trade record before order submission
  let pendingTrade = null;
  try {
    pendingTrade = await createPendingTrade({
      decision: {
        ...decision,
        qty: resolvedQty,
        stop: resolvedStopLoss,
        target: resolvedTakeProfit,
        strategy: strategyName ?? strategy ?? "momentum_breakout_atr_v1",
      },
      source: "autopilot",
    });
  } catch (journalErr) {
    logger.error("Failed to create pending trade — aborting order", {
      symbol,
      error: journalErr.message,
    });
    return { submitted: false, error: journalErr.message, payload };
  }

  const tradeId = pendingTrade.tradeId;
  logger.info("Submitting order", { symbol, qty: resolvedQty, entryPrice, tradeId });

  try {
    const response = await submitOrder({
      symbol,
      qty: resolvedQty,
      side: "buy",
      assetClass,
    });

    logger.info("Order accepted", { symbol, orderId: response.id, status: response.status, tradeId });

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
        logger.error("Failed to mark trade open after fill", { symbol, tradeId, error: openErr.message });
      }
    } else {
      // Order accepted but not yet filled — update brokerOrderId on pending record
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
      submitted: true,
      tradeId,
      orderId: response.id,
      orderStatus: response.status,
      payload,
      response,
    };
  } catch (err) {
    logger.error("Order failed", { symbol, tradeId, error: err.message });

    try {
      await markTradeCanceled({ tradeId, reason: err.message });
    } catch (cancelErr) {
      logger.warn("Failed to cancel pending trade after order failure (non-fatal)", {
        tradeId,
        error: cancelErr.message,
      });
    }

    return { submitted: false, tradeId, error: err.message, payload };
  }
}

/**
 * Closes an open trade: submits market close to broker, calculates PnL, archives in journal.
 * Returns { closed, exitPrice?, orderId?, orderStatus?, exitReason, error?, dryRun? }
 *
 * @param {{
 *   tradeId: string,
 *   symbol: string,
 *   exitPrice: number,    current market price (used as fallback if broker fill unavailable)
 *   reason: string,       "stop_loss" | "take_profit" | "manual"
 *   dryRun?: boolean,
 * }} params
 */
export async function closeTrade({ tradeId, symbol, exitPrice: currentPrice, reason, dryRun = false }) {
  const normalizedSym = normalizeSymbol(symbol);

  if (dryRun || isDryRunEnabled()) {
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

  // Archive in journal
  try {
    const trade = await getOpenTradeById(tradeId);
    if (!trade) {
      logger.warn("closeTrade: trade not found in journal, skipping archive", { tradeId, symbol });
      return { closed: true, exitPrice: fillPrice, orderId, orderStatus, exitReason: reason };
    }

    const qty = trade.quantity ?? trade.qty ?? 0;
    const entry = trade.entryPrice ?? 0;
    const pnl = entry && qty ? (fillPrice - entry) * qty : null;
    const pnlPct = entry && pnl != null ? ((fillPrice - entry) / entry) * 100 : null;

    const closedTrade = {
      ...trade,
      status: "closed",
      exitPrice: fillPrice,
      pnl: pnl != null ? Number(pnl.toFixed(2)) : null,
      pnlPct: pnlPct != null ? Number(pnlPct.toFixed(4)) : null,
      exitReason: reason,
      closedAt: new Date().toISOString(),
    };

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
