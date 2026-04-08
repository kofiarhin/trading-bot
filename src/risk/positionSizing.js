/**
 * Validates position sizing fields from a strategy decision.
 * Returns { valid: boolean, reason?: string }.
 *
 * @param {{ riskPerUnit: number, riskAmount: number, quantity: number }} decision
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validatePositionSize({ riskPerUnit, riskAmount, quantity }) {
  if (!riskPerUnit || riskPerUnit <= 0) {
    return { valid: false, reason: "riskPerUnit must be > 0" };
  }
  if (!riskAmount || riskAmount <= 0) {
    return { valid: false, reason: "riskAmount must be > 0" };
  }
  if (!quantity || quantity < 1) {
    return { valid: false, reason: "quantity must be >= 1" };
  }
  return { valid: true };
}
