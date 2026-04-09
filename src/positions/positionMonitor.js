// Position monitor — fetches and normalises open positions from Alpaca.
import { getOpenPositions } from "../execution/alpacaTrading.js";
import { getOpenTrades } from "../journal/tradeJournal.js";
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
 * Contract: returns array of { tradeId, symbol, shouldExit, reason, currentPrice }
 * reason: "stop_loss" | "take_profit"
 *
 * @param {Array} [openTrades] Optional pre-fetched trades (defaults to reading from journal)
 * @returns {Promise<Array<{
 *   tradeId: string,
 *   symbol: string,
 *   shouldExit: boolean,
 *   reason: "stop_loss" | "take_profit",
 *   currentPrice: number,
 * }>>}
 */
export async function checkOpenTradesForExit(openTrades) {
  const trades = openTrades ?? await getOpenTrades();
  if (!trades.length) return [];

  let positionMap;
  try {
    positionMap = await getPositionMap();
  } catch (err) {
    logger.error("checkOpenTradesForExit: failed to load positions", { error: err.message });
    return [];
  }

  function isValidExitLevel(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  }

  const exits = [];

  for (const trade of trades) {
    if (trade.status === "pending" || trade.status === "canceled") continue;

    const key = normalizeSymbol(trade.normalizedSymbol ?? trade.symbol);
    const position = positionMap[key];

    if (!position) continue; // let syncTradesWithBroker handle orphans

    const currentPrice = position.currentPrice;
    // Support both field naming conventions (stop/stopLoss, target/takeProfit)
    const stopLoss = trade.stopLoss ?? trade.stop ?? null;
    const takeProfit = trade.takeProfit ?? trade.target ?? null;

    if (isValidExitLevel(stopLoss) && currentPrice <= stopLoss) {
      logger.info("Stop loss hit", { symbol: key, currentPrice, stopLoss });
      exits.push({ tradeId: trade.tradeId, symbol: trade.symbol, shouldExit: true, reason: "stop_loss", currentPrice });
    } else if (isValidExitLevel(takeProfit) && currentPrice >= takeProfit) {
      logger.info("Take profit hit", { symbol: key, currentPrice, takeProfit });
      exits.push({ tradeId: trade.tradeId, symbol: trade.symbol, shouldExit: true, reason: "take_profit", currentPrice });
    }
  }

  return exits;
}
