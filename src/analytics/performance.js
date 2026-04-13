/**
 * Pure performance analytics — no DB calls.
 * Takes an array of ClosedTrade documents and returns a performance report.
 */

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Computes the R multiple for a closed trade.
 * R = (exitPrice - entryPrice) / riskPerUnit  (handles long direction)
 */
function computeRMultiple(trade) {
  const entry = toNumber(trade.entryPrice, 0);
  const exit = toNumber(trade.exitPrice, 0);
  const stop = toNumber(trade.stopLoss, 0);

  if (!entry || !exit || !stop || entry <= stop) return null;

  const riskPerUnit = entry - stop;
  return (exit - entry) / riskPerUnit;
}

/**
 * Computes comprehensive performance statistics from an array of closed trades.
 *
 * @param {object[]} closedTrades
 * @returns {{
 *   totalTrades: number,
 *   wins: number,
 *   losses: number,
 *   winRate: number,
 *   avgWinR: number,
 *   avgLossR: number,
 *   expectancy: number,
 *   profitFactor: number,
 *   grossProfit: number,
 *   grossLoss: number,
 *   netPnl: number,
 *   bySymbol: object,
 *   bySession: object,
 *   byGrade: object,
 * }}
 */
export function computePerformance(closedTrades) {
  if (!Array.isArray(closedTrades) || closedTrades.length === 0) {
    return {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      avgWinR: 0,
      avgLossR: 0,
      expectancy: 0,
      profitFactor: 0,
      grossProfit: 0,
      grossLoss: 0,
      netPnl: 0,
      bySymbol: {},
      bySession: {},
      byGrade: { A: emptyGroup(), B: emptyGroup(), C: emptyGroup() },
    };
  }

  let wins = 0;
  let losses = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let winRSum = 0;
  let lossRSum = 0;

  const bySymbol = {};
  const bySession = {};
  const byGrade = { A: emptyGroup(), B: emptyGroup(), C: emptyGroup() };

  for (const trade of closedTrades) {
    const pnl = toNumber(trade.pnl, 0);
    const rMultiple = trade.rMultiple != null ? toNumber(trade.rMultiple, 0) : computeRMultiple(trade);
    const isWin = pnl > 0;

    if (isWin) {
      wins++;
      grossProfit += pnl;
      if (rMultiple !== null) winRSum += rMultiple;
    } else {
      losses++;
      grossLoss += Math.abs(pnl);
      if (rMultiple !== null) lossRSum += Math.abs(rMultiple);
    }

    // By symbol
    const sym = trade.symbol ?? 'unknown';
    if (!bySymbol[sym]) bySymbol[sym] = emptyGroup();
    accumulate(bySymbol[sym], pnl, isWin);

    // By session
    const sess = trade.session ?? trade.context?.session ?? 'unknown';
    if (!bySession[sess]) bySession[sess] = emptyGroup();
    accumulate(bySession[sess], pnl, isWin);

    // By grade
    const grade = trade.setupGrade;
    if (grade && byGrade[grade]) {
      accumulate(byGrade[grade], pnl, isWin);
    }
  }

  const totalTrades = closedTrades.length;
  const winRate = totalTrades > 0 ? wins / totalTrades : 0;
  const avgWinR = wins > 0 ? winRSum / wins : 0;
  const avgLossR = losses > 0 ? lossRSum / losses : 0;
  const expectancy = winRate * avgWinR - (1 - winRate) * avgLossR;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Finalize group win rates
  finalizeGroup(byGrade.A);
  finalizeGroup(byGrade.B);
  finalizeGroup(byGrade.C);
  Object.values(bySymbol).forEach(finalizeGroup);
  Object.values(bySession).forEach(finalizeGroup);

  return {
    totalTrades,
    wins,
    losses,
    winRate: round(winRate, 4),
    avgWinR: round(avgWinR, 4),
    avgLossR: round(avgLossR, 4),
    expectancy: round(expectancy, 4),
    profitFactor: round(profitFactor, 4),
    grossProfit: round(grossProfit, 2),
    grossLoss: round(grossLoss, 2),
    netPnl: round(grossProfit - grossLoss, 2),
    bySymbol,
    bySession,
    byGrade,
  };
}

function emptyGroup() {
  return { wins: 0, losses: 0, netPnl: 0, winRate: 0 };
}

function accumulate(group, pnl, isWin) {
  if (isWin) group.wins++;
  else group.losses++;
  group.netPnl += pnl;
}

function finalizeGroup(group) {
  const total = group.wins + group.losses;
  group.winRate = total > 0 ? round(group.wins / total, 4) : 0;
  group.netPnl = round(group.netPnl, 2);
}

function round(value, decimals) {
  if (!Number.isFinite(value)) return value;
  return Number(value.toFixed(decimals));
}
