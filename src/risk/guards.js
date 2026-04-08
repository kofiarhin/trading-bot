// Risk guards — all must pass before an order is submitted.
// Each guard returns { pass: boolean, reason?: string }.
import { validatePositionSize } from "./positionSizing.js";
import { getDailyLoss, isInCooldown } from "./riskState.js";

/**
 * Runs all risk guards for a strategy decision.
 *
 * @param {{
 *   decision: object,           strategy output
 *   openPositions: string[],    list of currently open symbol strings
 *   accountEquity: number,
 *   maxDailyLossPercent: number,
 *   maxOpenPositions: number,
 * }} params
 * @returns {{ pass: boolean, reason?: string }}
 */
export function runRiskGuards({
  decision,
  openPositions,
  accountEquity,
  maxDailyLossPercent,
  maxOpenPositions,
}) {
  const { symbol, entryPrice, stopLoss, takeProfit, riskAmount, quantity, riskPerUnit } = decision;

  // 1. Required fields
  if (!entryPrice || !stopLoss || !takeProfit || !riskAmount || !quantity) {
    return { pass: false, reason: "missing required order fields" };
  }

  // 2. Position sizing
  const sizeCheck = validatePositionSize({ riskPerUnit, riskAmount, quantity });
  if (!sizeCheck.valid) return { pass: false, reason: sizeCheck.reason };

  // 3. Daily loss lockout
  const dailyLoss = getDailyLoss();
  const maxLoss = accountEquity * maxDailyLossPercent;
  if (dailyLoss >= maxLoss) {
    return {
      pass: false,
      reason: `daily loss lockout: realized loss $${dailyLoss.toFixed(2)} ≥ max $${maxLoss.toFixed(2)}`,
    };
  }

  // 4. Duplicate symbol prevention
  if (openPositions.includes(symbol)) {
    return { pass: false, reason: `already have an open position in ${symbol}` };
  }

  // 5. Max open positions
  if (openPositions.length >= maxOpenPositions) {
    return {
      pass: false,
      reason: `max open positions reached (${openPositions.length}/${maxOpenPositions})`,
    };
  }

  // 6. Symbol cooldown
  if (isInCooldown(symbol)) {
    return { pass: false, reason: `${symbol} is in cooldown` };
  }

  return { pass: true };
}

/**
 * Minimum liquidity check for stocks (pre-data fetch filter).
 * @param {{ avgVolume: number, avgPrice: number }} params
 * @param {{ minPrice?: number, minAvgVolume?: number, minDollarVolume?: number }} limits
 * @returns {{ pass: boolean, reason?: string }}
 */
export function checkLiquidity(
  { avgVolume, avgPrice },
  { minPrice = 5, minAvgVolume = 500_000, minDollarVolume = 10_000_000 } = {}
) {
  if (avgPrice < minPrice) {
    return { pass: false, reason: `price $${avgPrice} below floor $${minPrice}` };
  }
  if (avgVolume < minAvgVolume) {
    return { pass: false, reason: `avg volume ${avgVolume} below minimum ${minAvgVolume}` };
  }
  if (avgPrice * avgVolume < minDollarVolume) {
    return { pass: false, reason: "insufficient average dollar volume" };
  }
  return { pass: true };
}
