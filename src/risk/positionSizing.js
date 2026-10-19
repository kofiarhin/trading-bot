/**
 * Validates position sizing fields from a strategy decision.
 * Returns { valid: boolean, reason?: string }.
 *
 * Stocks need whole shares (quantity >= 1). Crypto is fractional: any
 * quantity > 0 at or above minQty (the asset's minimum order size) passes.
 *
 * @param {{
 *   riskPerUnit: number,
 *   riskAmount: number,
 *   quantity: number,
 *   assetClass?: "stock"|"crypto",
 *   minQty?: number,
 * }} decision
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validatePositionSize({ riskPerUnit, riskAmount, quantity, assetClass = "stock", minQty }) {
  if (!riskPerUnit || riskPerUnit <= 0) {
    return { valid: false, reason: "riskPerUnit must be > 0" };
  }
  if (!riskAmount || riskAmount <= 0) {
    return { valid: false, reason: "riskAmount must be > 0" };
  }
  if (assetClass === "crypto") {
    if (!quantity || quantity <= 0) {
      return { valid: false, reason: "quantity must be > 0" };
    }
    if (minQty != null && quantity < minQty) {
      return { valid: false, reason: `quantity must be >= minimum order size ${minQty}` };
    }
    return { valid: true };
  }
  if (!quantity || quantity < 1) {
    return { valid: false, reason: "quantity must be >= 1" };
  }
  return { valid: true };
}
