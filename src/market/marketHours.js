// Market-hours eligibility checks per asset class.
import { isStockMarketOpen } from "../utils/time.js";

/**
 * Returns true if the given asset can be scanned right now.
 * Stocks: only during regular market hours (Mon–Fri 9:45 AM–4:00 PM ET).
 * Crypto: always eligible (24/7).
 *
 * @param {"stock"|"crypto"} assetClass
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isEligibleNow(assetClass, now = new Date()) {
  if (assetClass === "crypto") return true;
  return isStockMarketOpen(now);
}

/**
 * Filters a universe array to symbols eligible for scanning right now.
 * @param {Array<{ symbol: string, assetClass: string }>} universe
 * @param {Date} [now]
 * @returns {Array<{ symbol: string, assetClass: string }>}
 */
export function filterEligible(universe, now = new Date()) {
  return universe.filter(({ assetClass }) => isEligibleNow(assetClass, now));
}
