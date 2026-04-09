// Order manager — safety checks + submission + logging.
import { submitOrder } from "./alpacaTrading.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/env.js";
import { saveOpenTrade } from "../journal/openTradesStore.js";
import { normalizeSymbol } from "../utils/symbolNorm.js";

/**
 * Submits a paper trade order with pre-flight safety checks.
 * Returns { submitted: boolean, orderId?: string, error?: string, payload: object }
 *
 * @param {{
 *   decision: object,   approved strategy decision
 *   dryRun: boolean,
 * }} params
 */
export async function placeOrder({ decision, dryRun = false }) {
  const { symbol, quantity, assetClass, entryPrice, stopLoss, takeProfit } = decision;

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

  logger.info("Submitting order", { symbol, qty: quantity, entryPrice });

  try {
    const response = await submitOrder({
      symbol,
      qty: quantity,
      side: "buy",
      assetClass,
    });

    logger.info("Order accepted", { symbol, orderId: response.id, status: response.status });

    try {
      saveOpenTrade({
        symbol,
        normalizedSymbol: normalizeSymbol(symbol),
        assetClass,
        strategyName: decision.strategyName ?? "momentum_breakout_atr_v1",
        source: "autopilot",
        openedAt: new Date().toISOString(),
        entryPrice: response.filled_avg_price
          ? parseFloat(response.filled_avg_price)
          : entryPrice,
        stopLoss,
        takeProfit,
        riskAmount: decision.riskAmount ?? null,
        quantity,
        orderId: response.id ?? null,
      });
    } catch (storeErr) {
      logger.error("Failed to persist open trade", {
        symbol,
        orderId: response.id ?? null,
        error: storeErr.message,
      });
    }

    return {
      submitted: true,
      orderId: response.id,
      orderStatus: response.status,
      payload,
      response,
    };
  } catch (err) {
    logger.error("Order failed", { symbol, error: err.message });
    return { submitted: false, error: err.message, payload };
  }
}
