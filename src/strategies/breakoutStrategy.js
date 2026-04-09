// Momentum Breakout + ATR Risk Strategy — v1 built-in strategy.
//
// Entry conditions (long only):
//   1. Latest close > highest high of last N completed candles (breakout)
//   2. Current volume > average volume of last N candles × minVolRatio
//   3. ATR is valid (> 0)
//   4. stopLoss < entryPrice (valid stop distance)
//   5. quantity >= 1
//
// Outputs a structured decision object (see spec §7.9).

import { calcATR } from "../indicators/atr.js";
import { calcHighestHigh } from "../indicators/highestHigh.js";
import { calcAverageVolume } from "../indicators/averageVolume.js";

const STRATEGY_NAME = "momentum_breakout_atr_v1";

const DEFAULTS = {
  breakoutLookback: 20,
  volumeLookback: 20,
  atrPeriod: 14,
  atrMultiplier: 1.5,
  targetMultiple: 2,    // 2R
  minVolRatio: 1.0,     // current vol must exceed avg (≥1.0x)
};

/**
 * Evaluates a symbol against the breakout strategy.
 *
 * @param {{
 *   symbol: string,
 *   assetClass: "stock"|"crypto",
 *   bars: Array<{ t: string, o: number, h: number, l: number, c: number, v: number }>,
 *   accountEquity: number,
 *   riskPercent: number,
 *   timeframe?: string,
 * }} params
 * @returns {{
 *   approved: boolean,
 *   symbol: string,
 *   reason: string,
 *   timestamp: string,
 *   [key: string]: any
 * }}
 */
export function evaluateBreakout({
  symbol,
  assetClass = "stock",
  bars,
  accountEquity,
  riskPercent,
  timeframe = "15Min",
  options = {},
}) {
  const opts = { ...DEFAULTS, ...options };
  const timestamp = new Date().toISOString();

  // Metrics accumulated as we compute them — included in every decision return.
  let closePrice = null;
  let breakoutLevel = null;
  let atr = null;
  let volumeRatio = null;
  let distanceToBreakoutPct = null;

  function toMetric(value) {
    return Number.isFinite(value) ? parseFloat(value.toFixed(4)) : null;
  }

  function reject(reason) {
    return {
      approved: false,
      symbol,
      assetClass,
      timeframe,
      strategyName: STRATEGY_NAME,
      reason,
      timestamp,
      closePrice,
      breakoutLevel,
      atr,
      volumeRatio,
      distanceToBreakoutPct,
      entryPrice: null,
      stopLoss: null,
      takeProfit: null,
      quantity: null,
      riskAmount: null,
    };
  }

  if (!Array.isArray(bars) || bars.length < opts.breakoutLookback + 2) {
    return reject("insufficient bar history");
  }

  const latestBar = bars[bars.length - 1];
  closePrice = latestBar.c;
  const entryPrice = closePrice;
  const currentVolume = latestBar.v;

  // --- Highest high (breakout level) ---
  const rawBreakoutLevel = calcHighestHigh(bars, opts.breakoutLookback);
  if (rawBreakoutLevel === null) return reject("could not compute breakout level");
  breakoutLevel = toMetric(rawBreakoutLevel);

  // --- Volume confirmation metric ---
  const avgVolume = calcAverageVolume(bars, opts.volumeLookback);
  if (avgVolume !== null && avgVolume !== 0) {
    volumeRatio = toMetric(currentVolume / avgVolume);
  }

  // --- ATR metric ---
  const rawAtr = calcATR(bars, opts.atrPeriod);
  if (rawAtr !== null && rawAtr > 0) {
    atr = toMetric(rawAtr);
  }

  distanceToBreakoutPct = breakoutLevel
    ? toMetric(((breakoutLevel - entryPrice) / breakoutLevel) * 100)
    : null;

  if (entryPrice <= rawBreakoutLevel) {
    const reasonStr =
      distanceToBreakoutPct !== null
        ? `no breakout (${distanceToBreakoutPct.toFixed(2)}% below level)`
        : "no breakout";
    return reject(reasonStr);
  }

  // --- Volume confirmation ---
  if (avgVolume === null || avgVolume === 0) return reject("could not compute average volume");
  if (volumeRatio < opts.minVolRatio) {
    return reject(
      `volume confirmation failed: ratio ${volumeRatio.toFixed(2)} < ${opts.minVolRatio}`
    );
  }

  // --- ATR ---
  if (rawAtr === null || rawAtr <= 0) return reject("invalid ATR");

  // --- Stop-loss ---
  const stopLoss = entryPrice - opts.atrMultiplier * atr;
  const riskPerUnit = entryPrice - stopLoss;
  if (riskPerUnit <= 0) return reject("invalid stop-loss distance");

  // --- Take-profit ---
  const takeProfit = entryPrice + opts.targetMultiple * riskPerUnit;

  // --- Position sizing ---
  const riskAmount = accountEquity * riskPercent;
  if (riskAmount <= 0) return reject("invalid risk amount");
  const quantity = Math.floor(riskAmount / riskPerUnit);
  if (quantity < 1) return reject("position size rounds to zero");

  return {
    approved: true,
    symbol,
    assetClass,
    timeframe,
    strategyName: STRATEGY_NAME,
    closePrice,
    entryPrice,
    stopLoss: toMetric(stopLoss),
    takeProfit: toMetric(takeProfit),
    atr,
    breakoutLevel,
    volumeRatio,
    distanceToBreakoutPct,
    riskPerUnit: toMetric(riskPerUnit),
    quantity,
    riskAmount: toMetric(riskAmount),
    reason: "15m breakout confirmed by volume",
    timestamp,
  };
}
