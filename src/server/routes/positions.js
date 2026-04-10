// Positions API — formatted open/closed position views for the dashboard.
import { Router } from "express";
import { getOpenTrades, getClosedTrades } from "../../journal/tradeJournal.js";

const router = Router();

// GET /api/positions/open
// Returns open positions with dashboard-relevant fields.
router.get("/open", async (req, res) => {
  try {
    const trades = await getOpenTrades();
    const open = trades
      .filter((t) => t.status !== "canceled")
      .map((t) => ({
        tradeId: t.tradeId,
        symbol: t.symbol,
        normalizedSymbol: t.normalizedSymbol ?? null,
        assetClass: t.assetClass ?? null,
        strategyName: t.strategyName ?? null,
        entryPrice: t.entryPrice ?? null,
        stopLoss: t.stopLoss ?? null,
        takeProfit: t.takeProfit ?? null,
        quantity: t.quantity ?? null,
        riskAmount: t.riskAmount ?? null,
        pnl: t.pnl ?? null,
        openedAt: t.openedAt ?? null,
        status: t.status,
        metrics: t.metrics ?? {},
      }));
    res.json(open);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/positions/closed
// Returns closed trade history with dashboard-relevant fields.
router.get("/closed", async (req, res) => {
  try {
    const trades = await getClosedTrades();
    const limit = parseInt(req.query.limit ?? "200", 10);
    const closed = trades
      .sort((a, b) => new Date(b.closedAt ?? 0) - new Date(a.closedAt ?? 0))
      .slice(0, limit)
      .map((t) => ({
        tradeId: t.tradeId,
        symbol: t.symbol,
        normalizedSymbol: t.normalizedSymbol ?? null,
        assetClass: t.assetClass ?? null,
        strategyName: t.strategyName ?? null,
        quantity: t.quantity ?? null,
        entryPrice: t.entryPrice ?? null,
        exitPrice: t.exitPrice ?? null,
        stopLoss: t.stopLoss ?? null,
        takeProfit: t.takeProfit ?? null,
        riskAmount: t.riskAmount ?? null,
        pnl: t.pnl ?? null,
        pnlPct: t.pnlPct ?? null,
        exitReason: t.exitReason ?? null,
        openedAt: t.openedAt ?? null,
        closedAt: t.closedAt ?? null,
        status: t.status ?? "closed",
        metrics: t.metrics ?? {},
      }));
    res.json(closed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
