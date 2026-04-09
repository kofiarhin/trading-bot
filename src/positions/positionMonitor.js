// Position monitor — fetches and normalises open positions from Alpaca.
import { getOpenPositions } from "../execution/alpacaTrading.js";
import { getOpenTrades } from "../journal/openTradesStore.js";
import { normalizeSymbol } from "../utils/symbolNorm.js";
import { logger } from "../utils/logger.js";

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
 * Checks all open trades against current Alpaca prices and returns
 * those that have hit their stop loss or take profit.
 *
 * @returns {Promise<Array<{ trade: object, exitReason: string, currentPrice: number }>>}
 */
export async function checkOpenTradesForExit() {
  const openTrades = getOpenTrades();
  if (!openTrades.length) return [];

  let positionMap;
  try {
    positionMap = await getPositionMap();
  } catch (err) {
    logger.error("checkOpenTradesForExit: failed to load positions", { error: err.message });
    return [];
  }

  const exits = [];

  for (const trade of openTrades) {
    const key = normalizeSymbol(trade.normalizedSymbol ?? trade.symbol);
    const position = positionMap[key];

    if (!position) {
      // Position no longer exists in Alpaca — skip (may have been closed externally)
      logger.warn("Open trade has no matching Alpaca position", { symbol: key });
      continue;
    }

    const currentPrice = position.currentPrice;
    const { stopLoss, takeProfit } = trade;

    if (stopLoss != null && currentPrice <= stopLoss) {
      logger.info("Stop loss hit", { symbol: key, currentPrice, stopLoss });
      exits.push({ trade, exitReason: "stopLoss", currentPrice });
    } else if (takeProfit != null && currentPrice >= takeProfit) {
      logger.info("Take profit hit", { symbol: key, currentPrice, takeProfit });
      exits.push({ trade, exitReason: "takeProfit", currentPrice });
    }
  }

  return exits;
}
