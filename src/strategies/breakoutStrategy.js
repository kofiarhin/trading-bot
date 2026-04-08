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

  function reject(reason) {
    return { approved: false, symbol, reason, timestamp };
  }

  if (!Array.isArray(bars) || bars.length < opts.breakoutLookback + 2) {
    return reject("insufficient bar history");
  }

  const latestBar = bars[bars.length - 1];
  const entryPrice = latestBar.c;
  const currentVolume = latestBar.v;

  // --- Highest high (breakout level) ---
  const breakoutLevel = calcHighestHigh(bars, opts.breakoutLookback);
  if (breakoutLevel === null) return reject("could not compute breakout level");
  if (entryPrice <= breakoutLevel) {
    return reject(
      `no breakout: close ${entryPrice} ≤ highest high ${breakoutLevel.toFixed(4)}`
    );
  }

  // --- Volume confirmation ---
  const avgVolume = calcAverageVolume(bars, opts.volumeLookback);
  if (avgVolume === null || avgVolume === 0) return reject("could not compute average volume");
  const volumeRatio = currentVolume / avgVolume;
  if (volumeRatio < opts.minVolRatio) {
    return reject(
      `volume confirmation failed: ratio ${volumeRatio.toFixed(2)} < ${opts.minVolRatio}`
    );
  }

  // --- ATR ---
  const atr = calcATR(bars, opts.atrPeriod);
  if (atr === null || atr <= 0) return reject("invalid ATR");

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
    entryPrice,
    stopLoss: parseFloat(stopLoss.toFixed(4)),
    takeProfit: parseFloat(takeProfit.toFixed(4)),
    atr: parseFloat(atr.toFixed(4)),
    breakoutLevel: parseFloat(breakoutLevel.toFixed(4)),
    volumeRatio: parseFloat(volumeRatio.toFixed(4)),
    riskPerUnit: parseFloat(riskPerUnit.toFixed(4)),
    quantity,
    riskAmount: parseFloat(riskAmount.toFixed(4)),
    reason: "15m breakout confirmed by volume",
    timestamp,
  };
}
