// Position monitor — fetches and normalises open positions from Alpaca.
import { getOpenPositions } from "../execution/alpacaTrading.js";
import { getOpenTrades } from "../journal/tradeJournal.js";
import { normalizeSymbol } from "../utils/symbolNorm.js";
import { logger } from "../utils/logger.js";
import { evaluateExits } from "./exitEngine.js";

/**
 * Returns all open position symbols as an array of strings.
 * @returns {Promise<string[]>}
 */
export async function getOpenSymbols() {
  try {
    const positions = await getOpenPositions();
    return positions.map((p) => p.symbol);
  } catch (err) {
    logger.error("Failed to fetch open positions", { error: err.message });
    return [];
  }
}

/**
 * Returns a map of symbol → position details for all open positions.
 * @returns {Promise<Record<string, object>>}
 */
export async function getPositionMap() {
  try {
    const positions = await getOpenPositions();
    const map = {};
    for (const p of positions) {
      map[p.symbol] = {
        symbol: p.symbol,
        qty: parseFloat(p.qty),
        entryPrice: parseFloat(p.avg_entry_price),
        currentPrice: parseFloat(p.current_price),
        unrealizedPnl: parseFloat(p.unrealized_pl),
        marketValue: parseFloat(p.market_value),
      };
    }
    return map;
  } catch (err) {
    logger.error("Failed to build position map", { error: err.message });
    return {};
  }
}

/**
 * Checks all open trades for exit conditions.
 * Delegates to exitEngine.js for full logic (stop, take-profit, breakeven, trailing, time).
 *
 * @param {Array} [openTrades] Optional pre-fetched trades
 * @returns {Promise<Array<{ tradeId, symbol, shouldExit, reason, currentPrice, updatedTrade }>>}
 */
export async function checkOpenTradesForExit(openTrades) {
  return evaluateExits(openTrades);
}
