// Resolves a verified entry price for a broker position.
//
// Alpaca paper accounts can report a zero or negative avg_entry_price after
// repeated round trips in the same crypto asset (fee residue skews the cost
// basis). In that case the entry is rebuilt from the account's own fills:
// the weighted average of buy fills since the most recent sell, accepted only
// when those buys cover the current position. Anything else is "unverified"
// — the bot never guesses an entry price.
import { normalizeSymbol } from '../utils/symbolNorm.js';

export const DEFAULT_FILL_COVERAGE = 0.99;

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function isValidPrice(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function filledAtMs(order) {
  const ms = new Date(order.filled_at ?? order.updated_at ?? order.submitted_at ?? 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Rebuilds an entry price from fill history.
 *
 * @param {{
 *   fills: object[],          Alpaca orders (any status; non-fills are ignored)
 *   symbol: string,
 *   positionQty: number,
 *   coverage?: number,        fraction of positionQty the buys must cover
 * }} params
 * @returns {{ price: number, source: 'fill_history', fillCount: number, coveredQty: number } | null}
 */
export function resolveEntryFromFills({ fills = [], symbol, positionQty, coverage = DEFAULT_FILL_COVERAGE }) {
  const qtyNeeded = Math.abs(toNumber(positionQty, 0));
  if (!symbol || qtyNeeded <= 0) return null;

  const key = normalizeSymbol(symbol);
  const relevant = (fills ?? [])
    .filter((o) => o && normalizeSymbol(String(o.symbol ?? '')) === key)
    .filter((o) => toNumber(o.filled_qty, 0) > 0 && isValidPrice(o.filled_avg_price))
    .sort((a, b) => filledAtMs(b) - filledAtMs(a));

  let qty = 0;
  let notional = 0;
  let fillCount = 0;

  for (const order of relevant) {
    if (order.side === 'sell') break;
    if (order.side !== 'buy') continue;
    const filledQty = toNumber(order.filled_qty, 0);
    qty += filledQty;
    notional += filledQty * toNumber(order.filled_avg_price, 0);
    fillCount += 1;
  }

  if (qty <= 0 || qty < qtyNeeded * coverage) return null;

  return {
    price: Number((notional / qty).toFixed(6)),
    source: 'fill_history',
    fillCount,
    coveredQty: qty,
  };
}

/**
 * Picks the entry price for a broker position: the broker's average when valid,
 * otherwise a fill-history reconstruction, otherwise unverified (null).
 *
 * @param {{ brokerPosition: object, fills?: object[] }} params
 * @returns {{ price: number|null, source: 'broker'|'fill_history'|'unverified' }}
 */
export function resolveEntryPrice({ brokerPosition, fills = [] }) {
  if (isValidPrice(brokerPosition?.avg_entry_price)) {
    return { price: toNumber(brokerPosition.avg_entry_price), source: 'broker' };
  }
  const resolved = resolveEntryFromFills({
    fills,
    symbol: brokerPosition?.symbol,
    positionQty: brokerPosition?.qty,
  });
  if (resolved) return { price: resolved.price, source: resolved.source };
  return { price: null, source: 'unverified' };
}
