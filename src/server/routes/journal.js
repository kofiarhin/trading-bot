// Journal API — aggregate and filtered trade data for the Trade Journal UI.
import { Router } from "express";
import { getOpenTrades, getClosedTrades } from "../../journal/tradeJournal.js";
import { getOpenPositions } from "../../execution/alpacaTrading.js";

const router = Router();

// Strategies that represent broker reconciliation/import artifacts rather than
// real strategy signals. Extend this list to exclude additional sources.
const NON_PERFORMANCE_STRATEGIES = new Set(["broker_sync"]);

/**
 * Returns true if the trade should be counted in performance summary metrics.
 * Trades from broker reconciliation/import flows are excluded by default.
 */
function isStrategyPerformanceTrade(trade) {
  const name = trade.strategyName ?? trade.strategy ?? trade.source ?? "";
  return !NON_PERFORMANCE_STRATEGIES.has(name);
}

function formatAssetClass(raw) {
  if (!raw) return raw;
  const lower = raw.toLowerCase();
  if (lower === "us_equity" || lower === "stock") return "Stock";
  if (lower === "crypto") return "Crypto";
  return raw;
}

// GET /api/journal/summary
// Returns aggregate stats across all closed trades.
//
// Query params:
//   includeBrokerSync — "true" to include broker_sync trades in summary metrics (default: excluded)
router.get("/summary", async (req, res) => {
  try {
    const includeBrokerSync = req.query.includeBrokerSync === "true";

    const [rawClosed, rawOpen, brokerPositions] = await Promise.all([
      getClosedTrades(),
      getOpenTrades(),
      getOpenPositions().catch(() => []),
    ]);

    const closed = includeBrokerSync
      ? rawClosed
      : rawClosed.filter(isStrategyPerformanceTrade);

    const activeOpen = rawOpen.filter((t) => t.status !== "canceled");
    const filteredOpen = includeBrokerSync
      ? activeOpen
      : activeOpen.filter(isStrategyPerformanceTrade);

    // Breakdown for the journal UI: internal strategy trades vs broker-reconciled
    const journalOpenTrades = activeOpen.filter(isStrategyPerformanceTrade).length;
    const brokerSyncOpenTrades = activeOpen.filter((t) => !isStrategyPerformanceTrade(t)).length;
    const liveOpenPositions = brokerPositions.length;

    const wins = closed.filter((t) => (t.pnl ?? 0) > 0);
    const losses = closed.filter((t) => (t.pnl ?? 0) < 0);
    const totalPnl = closed.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : null;
    const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : null;

    const sortedByPnl = [...closed].sort((a, b) => (b.pnl ?? 0) - (a.pnl ?? 0));
    const bestTrade = sortedByPnl[0] ?? null;
    const worstTrade = sortedByPnl[sortedByPnl.length - 1] ?? null;

    res.json({
      totalTrades: closed.length + filteredOpen.length,
      closedTrades: closed.length,
      openTrades: filteredOpen.length,
      journalOpenTrades,
      brokerSyncOpenTrades,
      liveOpenPositions,
      wins: wins.length,
      losses: losses.length,
      winRate: closed.length ? Number(((wins.length / closed.length) * 100).toFixed(1)) : null,
      totalPnl: Number(totalPnl.toFixed(2)),
      avgWin: avgWin != null ? Number(avgWin.toFixed(2)) : null,
      avgLoss: avgLoss != null ? Number(avgLoss.toFixed(2)) : null,
      bestTrade: bestTrade
        ? { tradeId: bestTrade.tradeId, symbol: bestTrade.symbol, pnl: bestTrade.pnl }
        : null,
      worstTrade: worstTrade
        ? { tradeId: worstTrade.tradeId, symbol: worstTrade.symbol, pnl: worstTrade.pnl }
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/journal/trades
// Returns combined open + closed trades with optional filtering and pagination.
//
// Query params:
//   status      — "open" | "closed" (omit for all)
//   assetClass  — e.g. "crypto", "us_equity", "Stock", "Crypto"
//   strategy    — e.g. "breakout"
//   symbol      — substring match (case-insensitive)
//   dateFrom    — ISO date string (inclusive)
//   dateTo      — ISO date string (inclusive)
//   page        — page number (default 1)
//   limit       — page size (default 50, max 200)
router.get("/trades", async (req, res) => {
  try {
    const { status, assetClass, strategy, symbol, dateFrom, dateTo } = req.query;
    const page = Math.max(1, parseInt(req.query.page ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit ?? "50", 10)));

    const [rawOpen, rawClosed] = await Promise.all([getOpenTrades(), getClosedTrades()]);

    // Tag each trade with its collection source
    const openTagged = rawOpen
      .filter((t) => t.status !== "canceled")
      .map((t) => ({ ...t, _collection: "open" }));
    const closedTagged = rawClosed.map((t) => ({ ...t, _collection: "closed" }));

    let trades;
    if (status === "open") {
      trades = openTagged;
    } else if (status === "closed") {
      trades = closedTagged;
    } else {
      trades = [...openTagged, ...closedTagged];
    }

    // Normalize assetClass for comparison
    const normalizeAsset = (raw) => {
      if (!raw) return "";
      const l = raw.toLowerCase();
      if (l === "us_equity" || l === "stock") return "stock";
      if (l === "crypto") return "crypto";
      return l;
    };

    if (assetClass) {
      const target = normalizeAsset(assetClass);
      trades = trades.filter((t) => normalizeAsset(t.assetClass) === target);
    }

    if (strategy) {
      trades = trades.filter(
        (t) => (t.strategyName ?? "").toLowerCase().includes(strategy.toLowerCase())
      );
    }

    if (symbol) {
      trades = trades.filter((t) =>
        (t.symbol ?? "").toLowerCase().includes(symbol.toLowerCase())
      );
    }

    if (dateFrom) {
      const from = new Date(dateFrom).getTime();
      trades = trades.filter((t) => {
        const d = t.openedAt ?? t.pendingAt;
        return d ? new Date(d).getTime() >= from : true;
      });
    }

    if (dateTo) {
      const to = new Date(dateTo).getTime() + 86400000; // inclusive end of day
      trades = trades.filter((t) => {
        const d = t.openedAt ?? t.pendingAt;
        return d ? new Date(d).getTime() <= to : true;
      });
    }

    // Sort: open trades first (by pendingAt desc), then closed (by closedAt desc)
    trades.sort((a, b) => {
      const aIsOpen = a._collection === "open";
      const bIsOpen = b._collection === "open";
      if (aIsOpen !== bIsOpen) return aIsOpen ? -1 : 1;
      const aDate = a.closedAt ?? a.openedAt ?? a.pendingAt ?? "";
      const bDate = b.closedAt ?? b.openedAt ?? b.pendingAt ?? "";
      return bDate.localeCompare(aDate);
    });

    const total = trades.length;
    const offset = (page - 1) * limit;
    const paged = trades.slice(offset, offset + limit).map((t) => ({
      ...t,
      assetClassLabel: formatAssetClass(t.assetClass),
    }));

    res.json({ trades: paged, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
