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
 * barsHeld is derived from openedAt and the bar timeframe, so it survives
 * restarts and is not inflated by extra (manual) cycles. Adopted broker_sync
 * positions never time-exit — their real open time is unknown.
 *
 * With a bot-owned broker stop at or above the trade's stop, the broker order
 * is the stop loss: no software stop_loss exit runs. A triggered-but-unfilled stop-limit is
 * either alerted only (STOP_LIMIT_FALLBACK=alert, default) or exited at market
 * ("stop_limit_unfilled", STOP_LIMIT_FALLBACK=market_bot_only).
 *
 * Positions protected by an external broker-side stop (one the bot did not
 * place) are never exited by the bot. Positions whose quantity is reserved by
 * an order the bot does not own are skipped — selling them would fail.
 *
 * Returns an array of exit decisions. Each item has:
 *   { tradeId, symbol, shouldExit, reason, currentPrice, updatedTrade }
 *
 * `updatedTrade` is non-null when the trade record was mutated (e.g. breakeven
 * triggered, trailing stop level updated) but no exit is required yet.
 */

import { getPositionMap } from './positionMonitor.js';
import { getOpenTrades } from '../journal/tradeJournal.js';
import { enrichPosition } from '../journal/positionEnricher.js';
import { upsertOpenTrade, appendTradeEvent } from '../repositories/tradeJournalRepo.mongo.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { normalizeSymbol } from '../utils/symbolNorm.js';

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const PROTECTED_STATUSES = new Set(['active', 'partial', 'unfilled']);
const QTY_TOLERANCE = 0.999;

function barMinutes(timeframe) {
  const match = /^(\d+)\s*(Min|T|Hour|H|Day|D)$/i.exec(String(timeframe ?? '15Min').trim());
  if (!match) return 15;
  const n = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === 'hour' || unit === 'h') return n * 60;
  if (unit === 'day' || unit === 'd') return n * 1440;
  return n;
}

/** Whole bars elapsed since openedAt, or null when openedAt is unknown. */
export function computeBarsHeld(trade, nowMs, timeframe) {
  const openedMs = Date.parse(trade?.openedAt ?? '');
  if (!Number.isFinite(openedMs)) return null;
  return Math.max(0, Math.floor((nowMs - openedMs) / (barMinutes(timeframe) * 60_000)));
}

function isBotProtected(trade) {
  return trade.protection?.owner === 'bot' && PROTECTED_STATUSES.has(trade.protection?.status);
}

function isExternallyProtected(trade) {
  return trade.protection?.owner === 'external' && PROTECTED_STATUSES.has(trade.protection?.status);
}

function isReservedByForeignOrder(trade, position) {
  if (trade.protection?.owner === 'bot') return false; // the bot cancels its own stop before exiting
  const qty = Math.abs(toNumber(position.qty, 0));
  const available = Math.abs(toNumber(position.qtyAvailable ?? position.qty, 0));
  return qty > 0 && available < qty * QTY_TOLERANCE;
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
export async function evaluateExits(openTrades, { now = Date.now() } = {}) {
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
  const timeframe = config.trading.timeframe ?? '15Min';
  const stopLimitFallback = config.risk?.stopLimitFallback ?? 'alert';

  const results = [];

  for (const trade of trades) {
    // closing: an exit order is already working at the broker.
    if (trade.status === 'pending' || trade.status === 'canceled' || trade.status === 'closing') continue;

    const key = normalizeSymbol(trade.normalizedSymbol ?? trade.symbol);
    const position = positionMap[key];
    if (!position) continue;

    const currentPrice = toNumber(position.currentPrice, 0);
    if (!currentPrice) continue;

    if (isExternallyProtected(trade)) {
      logger.debug('exitEngine: externally protected position — no bot exits', { symbol: key });
      continue;
    }
    if (isReservedByForeignOrder(trade, position)) {
      logger.warn('exitEngine: position quantity reserved by another order — exits skipped', { symbol: key });
      try {
        await appendTradeEvent({
          type: 'exit_skipped_reserved',
          tradeId: trade.tradeId,
          symbol: trade.symbol,
          timestamp: new Date().toISOString(),
          payload: { qty: position.qty, qtyAvailable: position.qtyAvailable },
        });
      } catch { /* best effort */ }
      continue;
    }

    // For broker-sync positions without journal risk, derive stop/target so exit
    // conditions are never silently skipped on unmanaged exposure.
    const isBrokerSync = (trade.strategyName ?? '') === 'broker_sync';
    let effectiveStop = trade.stopLoss ?? trade.stop ?? null;
    let effectiveTarget = trade.takeProfit ?? trade.target ?? null;
    if (isBrokerSync && (!effectiveStop || !effectiveTarget)) {
      const enriched = enrichPosition(trade, null);
      if (enriched.managementStatus !== 'unmanaged') {
        effectiveStop = effectiveStop ?? enriched.stopLoss;
        effectiveTarget = effectiveTarget ?? enriched.takeProfit;
        logger.debug('exitEngine: using derived risk for broker_sync trade', {
          symbol: trade.symbol, managementStatus: enriched.managementStatus,
          effectiveStop, effectiveTarget,
        });
      }
    }
    const stopLoss = effectiveStop;
    const takeProfit = effectiveTarget;
    const entryPrice = toNumber(trade.entryPrice, 0);
    const atr = toNumber(trade.metrics?.atr, 0);
    const riskPerUnit = entryPrice && stopLoss ? entryPrice - toNumber(stopLoss, 0) : 0;
    const botProtected = isBotProtected(trade);
    // The broker order covers the stop only while it sits at or above the
    // trade's current stop. After breakeven raises the stop, the software stop
    // takes over again (the bot cancels its own lower stop before exiting).
    const brokerCoversStop =
      botProtected && toNumber(trade.protection.stopPrice, 0) >= toNumber(stopLoss, 0) - 1e-9;

    // ── 0. Bot-owned stop-limit triggered but not filled ─────────────────────
    if (botProtected && trade.protection.status === 'unfilled') {
      if (stopLimitFallback === 'market_bot_only') {
        logger.error('Stop-limit unfilled — exiting at market (STOP_LIMIT_FALLBACK=market_bot_only)', { symbol: key, currentPrice });
        results.push({ tradeId: trade.tradeId, symbol: trade.symbol, shouldExit: true, reason: 'stop_limit_unfilled', currentPrice, updatedTrade: null });
      } else {
        logger.error('Stop-limit unfilled — alert only (STOP_LIMIT_FALLBACK=alert)', { symbol: key, currentPrice });
      }
      continue;
    }

    // ── 1. Hard stop loss (software) — skipped when the bot's broker stop covers it
    if (!brokerCoversStop && isValid(stopLoss) && currentPrice <= stopLoss) {
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
    const computedBars = computeBarsHeld(trade, now, timeframe);
    const barsHeld = computedBars ?? toNumber(trade.barsHeld, 0);
    const canTimeExit = computedBars !== null && !isBrokerSync;
    if (canTimeExit && barsHeld >= maxHoldBars) {
      logger.info('Time exit', { symbol: key, barsHeld, maxHoldBars });
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

    // Persist the derived barsHeld for display even when nothing triggered
    if (barsHeld !== toNumber(trade.barsHeld, 0)) {
      try { await upsertOpenTrade({ ...trade, barsHeld }); } catch { /* best effort */ }
    }
  }

  return results;
}
