// Market-hours eligibility checks per asset class.
import { resolveSession } from "../utils/time.js";

/**
 * Returns true if the given asset can be scanned right now.
 * Crypto: always eligible (24/7).
 * Stocks: only when the New York session is active (NEW_YORK or LONDON_NEW_YORK_OVERLAP).
 *
 * @param {"stock"|"crypto"} assetClass
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isEligibleNow(assetClass, now = new Date()) {
  if (assetClass === "crypto") return true;
  const { allowStocks } = resolveSession(now);
  return allowStocks;
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
