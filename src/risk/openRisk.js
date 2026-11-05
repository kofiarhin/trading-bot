// Open risk of a single trade — pure, shared by portfolioRisk and riskGate.

const PROTECTED_STATUSES = new Set(['active', 'partial', 'unfilled']);

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Open risk of one trade. With an active broker-side stop the risk is the
 * distance from the current price to the worst expected fill (limit price for
 * stop-limit orders); otherwise the journal riskAmount.
 */
export function openRiskForTrade(trade, brokerPosition) {
  const protection = trade?.protection;
  if (protection && PROTECTED_STATUSES.has(protection.status) && brokerPosition) {
    const worstFill = toNumber(protection.limitPrice, 0) || toNumber(protection.stopPrice, 0);
    const currentPrice = toNumber(brokerPosition.current_price, 0);
    const qty = Math.abs(toNumber(brokerPosition.qty, 0));
    if (worstFill > 0 && currentPrice > 0 && qty > 0) {
      return Math.max(0, (currentPrice - worstFill) * qty);
    }
  }
  return toNumber(trade?.riskAmount, 0);
}
