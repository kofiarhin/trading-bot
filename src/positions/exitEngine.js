/**
 * Exit engine — evaluates all open trades against current prices for exit conditions.
 *
 * Exit reasons:
 *   "stop_loss"      — price hit the stop level
 *   "take_profit"    — price hit the take-profit level
 *   "breakeven_stop" — price moved to breakeven, stop updated (no exit yet)
 *   "trailing_stop"  — trailing stop hit after breakeven trigger
 *   "time_exit"      — trade held longer than maxHoldBars
 *
 * Returns an array of exit decisions. Each item has:
 *   { tradeId, symbol, shouldExit, reason, currentPrice, updatedTrade }
 *
 * `updatedTrade` is non-null when the trade record was mutated (e.g. breakeven
 * triggered, trailing stop level updated) but no exit is required yet.
 */

import { getPositionMap } from './positionMonitor.js';
import { getOpenTrades } from '../journal/tradeJournal.js';
import { upsertOpenTrade, appendTradeEvent } from '../repositories/tradeJournalRepo.mongo.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { normalizeSymbol } from '../utils/symbolNorm.js';

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isValid(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Evaluates exit conditions for all open trades.
 *
 * @param {object[]} [openTrades] Pre-fetched open trades (defaults to reading from journal).
 * @returns {Promise<Array<{
 *   tradeId: string,
 *   symbol: string,
 *   shouldExit: boolean,
 *   reason: string|null,
 *   currentPrice: number,
 *   updatedTrade: object|null,
 * }>>}
 */
export async function evaluateExits(openTrades) {
  const trades = openTrades ?? (await getOpenTrades());
  if (!trades.length) return [];

  let positionMap;
  try {
    positionMap = await getPositionMap();
  } catch (err) {
    logger.error('evaluateExits: failed to load positions', { error: err.message });
    return [];
  }

  const atrMultiplier = config.trading.trailingAtrMultiplier;
  const maxHoldBarsDefault = config.trading.maxHoldBars;

  const results = [];

  for (const trade of trades) {
    if (trade.status === 'pending' || trade.status === 'canceled') continue;

    const key = normalizeSymbol(trade.normalizedSymbol ?? trade.symbol);
    const position = positionMap[key];
    if (!position) continue;

    const currentPrice = toNumber(position.currentPrice, 0);
    if (!currentPrice) continue;

    const stopLoss = trade.stopLoss ?? trade.stop ?? null;
    const takeProfit = trade.takeProfit ?? trade.target ?? null;
    const entryPrice = toNumber(trade.entryPrice, 0);
    const atr = toNumber(trade.metrics?.atr, 0);
    const riskPerUnit = entryPrice && stopLoss ? entryPrice - toNumber(stopLoss, 0) : 0;

    // ── 1. Hard stop loss ────────────────────────────────────────────────────
    if (isValid(stopLoss) && currentPrice <= stopLoss) {
      logger.info('Stop loss hit', { symbol: key, currentPrice, stopLoss });
      results.push({ tradeId: trade.tradeId, symbol: trade.symbol, shouldExit: true, reason: 'stop_loss', currentPrice, updatedTrade: null });
      continue;
    }

    // ── 2. Take profit ───────────────────────────────────────────────────────
    if (isValid(takeProfit) && currentPrice >= takeProfit) {
      logger.info('Take profit hit', { symbol: key, currentPrice, takeProfit });
      results.push({ tradeId: trade.tradeId, symbol: trade.symbol, shouldExit: true, reason: 'take_profit', currentPrice, updatedTrade: null });
      continue;
    }

    // ── 3. Trailing stop exit (if already triggered) ─────────────────────────
    const trailingStopPrice = toNumber(trade.trailingStopPrice, 0);
    if (trade.breakevenTriggered && trailingStopPrice > 0 && currentPrice <= trailingStopPrice) {
      logger.info('Trailing stop hit', { symbol: key, currentPrice, trailingStopPrice });
      results.push({ tradeId: trade.tradeId, symbol: trade.symbol, shouldExit: true, reason: 'trailing_stop', currentPrice, updatedTrade: null });
      continue;
    }

    // ── 4. Time-based exit ───────────────────────────────────────────────────
    const maxHoldBars = toNumber(trade.maxHoldBars, maxHoldBarsDefault);
    const barsHeld = toNumber(trade.barsHeld, 0) + 1;
    if (barsHeld >= maxHoldBars) {
      logger.info('Time exit', { symbol: key, barsHeld, maxHoldBars });
      // Persist barsHeld increment
      const updated = { ...trade, barsHeld };
      try { await upsertOpenTrade(updated); } catch { /* best effort */ }
      results.push({ tradeId: trade.tradeId, symbol: trade.symbol, shouldExit: true, reason: 'time_exit', currentPrice, updatedTrade: updated });
      continue;
    }

    // ── 5. Breakeven trigger / trailing stop update (no exit yet) ────────────
    let updatedTrade = null;

    if (!trade.breakevenTriggered && riskPerUnit > 0 && entryPrice > 0 &&
        currentPrice >= entryPrice + riskPerUnit) {
      // Move stop to breakeven + small buffer
      const buffer = atr > 0 ? 0.1 * atr : 0;
      const newStop = entryPrice + buffer;
      updatedTrade = {
        ...trade,
        stopLoss: newStop,
        breakevenTriggered: true,
        trailingStopPrice: currentPrice - atrMultiplier * (atr || riskPerUnit),
        barsHeld,
      };
      logger.info('Breakeven triggered', { symbol: key, newStop, currentPrice });
      try { await upsertOpenTrade(updatedTrade); } catch { /* best effort */ }
      try {
        await appendTradeEvent({
          type: 'trade_stop_updated',
          tradeId: trade.tradeId,
          symbol: trade.symbol,
          timestamp: new Date().toISOString(),
          reason: 'breakeven_stop',
          payload: {
            oldStop: toNumber(stopLoss, 0),
            newStop,
            trailingStopPrice: updatedTrade.trailingStopPrice,
            currentPrice,
          },
        });
      } catch { /* best effort */ }
      results.push({ tradeId: trade.tradeId, symbol: trade.symbol, shouldExit: false, reason: 'breakeven_stop', currentPrice, updatedTrade });
      continue;
    }

    if (trade.breakevenTriggered && atr > 0) {
      const newTrailingStop = currentPrice - atrMultiplier * atr;
      if (newTrailingStop > trailingStopPrice) {
        updatedTrade = { ...trade, trailingStopPrice: newTrailingStop, barsHeld };
        try { await upsertOpenTrade(updatedTrade); } catch { /* best effort */ }
        try {
          await appendTradeEvent({
            type: 'trade_stop_updated',
            tradeId: trade.tradeId,
            symbol: trade.symbol,
            timestamp: new Date().toISOString(),
            reason: 'stop_trailed',
            payload: {
              oldTrailingStop: trailingStopPrice,
              newTrailingStop,
              currentPrice,
            },
          });
        } catch { /* best effort */ }
        results.push({ tradeId: trade.tradeId, symbol: trade.symbol, shouldExit: false, reason: 'trailing_stop', currentPrice, updatedTrade });
        continue;
      }
    }

    // Increment barsHeld even when no exit condition triggered
    if (barsHeld !== toNumber(trade.barsHeld, 0)) {
      try { await upsertOpenTrade({ ...trade, barsHeld }); } catch { /* best effort */ }
    }
  }

  return results;
}
