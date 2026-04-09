// Order manager — safety checks + submission + journal lifecycle.
import { submitOrder, closePosition } from "./alpacaTrading.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/env.js";
import { createPendingTrade, markTradeOpen, markTradeCanceled } from "../journal/journalUtils.js";
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
    assetClass,
    entryPrice,
    stopLoss,
    takeProfit,
    riskAmount,
    riskPerUnit,
    strategyName,
    timeframe,
    reason,
    timestamp: decisionTimestamp,
    atr,
    breakoutLevel,
    volumeRatio,
    distanceToBreakoutPct,
    closePrice,
  } = decision;

  const payload = {
    symbol,
    qty: quantity,
    side: "buy",
    assetClass,
    entryPrice,
    stopLoss,
    takeProfit,
  };

  // Safety: paper mode only
  if (config.trading.runMode !== "paper") {
    const error = "live trading mode is disabled in v1";
    logger.error("Order blocked — live mode", { symbol, error });
    return { submitted: false, error, payload };
  }

  // Safety: quantity > 0
  if (!quantity || quantity < 1) {
    const error = "quantity must be >= 1";
    logger.error("Order blocked — invalid quantity", { symbol, quantity });
    return { submitted: false, error, payload };
  }

  if (dryRun) {
    logger.info("[DRY RUN] Would submit order", payload);
    return { submitted: false, dryRun: true, payload };
  }

  // Create pending trade record before order submission
  let tradeId = null;
  try {
    const pendingTrade = createPendingTrade({
      symbol,
      assetClass,
      side: "long",
      strategyName: strategyName ?? "momentum_breakout_atr_v1",
      entryPrice,
      stopLoss,
      takeProfit,
      quantity,
      riskAmount,
      riskPerUnit,
      timeframe,
      decisionTimestamp,
      entryReason: reason ?? null,
      metrics: {
        closePrice: closePrice ?? null,
        breakoutLevel: breakoutLevel ?? null,
        atr: atr ?? null,
        volumeRatio: volumeRatio ?? null,
        distanceToBreakoutPct: distanceToBreakoutPct ?? null,
      },
    });
    tradeId = pendingTrade.tradeId;
  } catch (journalErr) {
    logger.error("Failed to create pending trade — aborting order", {
      symbol,
      error: journalErr.message,
    });
    return { submitted: false, error: journalErr.message, payload };
  }

  logger.info("Submitting order", { symbol, qty: quantity, entryPrice, tradeId });

  try {
    const response = await submitOrder({
      symbol,
      qty: quantity,
      side: "buy",
      assetClass,
    });

    logger.info("Order accepted", { symbol, orderId: response.id, status: response.status, tradeId });

    const isFilled =
      response.status === "filled" ||
      (response.filled_avg_price != null && parseFloat(response.filled_avg_price) > 0);

    if (isFilled) {
      try {
        markTradeOpen(tradeId, {
          openedAt: new Date().toISOString(),
          entryPrice: response.filled_avg_price
            ? parseFloat(response.filled_avg_price)
            : entryPrice,
          quantity,
          brokerOrderId: response.id ?? null,
        });
      } catch (openErr) {
        logger.error("Failed to mark trade open after fill", {
          symbol,
          tradeId,
          error: openErr.message,
        });
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
      markTradeCanceled(tradeId, err.message);
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
 * Closes an open position at market price.
 * Returns { closed, exitPrice?, orderId?, orderStatus?, exitReason, error?, dryRun? }
 *
 * @param {{
 *   trade: object,       open trade record from openTradesStore
 *   exitReason: string,  "stopLoss" | "takeProfit" | "stop_hit" | "target_hit"
 *   currentPrice: number,
 *   dryRun: boolean,
 * }} params
 */
export async function closeTrade({ trade, exitReason, currentPrice, dryRun = false }) {
  const symbol = trade.normalizedSymbol ?? normalizeSymbol(trade.symbol);

  if (dryRun) {
    logger.info("[DRY RUN] Would close position", { symbol, exitReason, currentPrice });
    return { closed: false, dryRun: true, exitReason, currentPrice };
  }

  logger.info("Closing position", { symbol, exitReason, currentPrice });

  try {
    const response = await closePosition(symbol);
    const exitPrice = response.filled_avg_price
      ? parseFloat(response.filled_avg_price)
      : currentPrice;

    logger.info("Position closed", { symbol, exitReason, exitPrice, orderId: response.id });

    return {
      closed: true,
      exitPrice,
      orderId: response.id ?? null,
      orderStatus: response.status,
      exitReason,
    };
  } catch (err) {
    logger.error("Close position failed", { symbol, exitReason, error: err.message });
    return { closed: false, error: err.message, exitReason };
  }
}
