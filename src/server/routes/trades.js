// Trades API — read endpoints for raw journal trade data.
// Separate from dashboard routes to keep dashboard.js focused on UI aggregation.
import { Router } from "express";
import { getOpenTrades } from "../../journal/openTradesStore.js";
import { getClosedTrades } from "../../journal/closedTradesStore.js";
import { getTradeEvents } from "../../journal/tradeEventsStore.js";

const router = Router();

// GET /api/trades/open
// Returns all active open trade journal records.
router.get("/open", (req, res) => {
  const trades = getOpenTrades().filter((t) => t.status !== "canceled");
  res.json(trades);
});

// GET /api/trades/closed
// Returns closed trade history.
router.get("/closed", (req, res) => {
  const limit = parseInt(req.query.limit ?? "200", 10);
  const closed = getClosedTrades()
    .sort((a, b) => new Date(b.closedAt ?? 0) - new Date(a.closedAt ?? 0))
    .slice(0, limit);
  res.json(closed);
});

// GET /api/trades/events
// Returns recent trade lifecycle events.
router.get("/events", (req, res) => {
  const limit = parseInt(req.query.limit ?? "200", 10);
  const events = getTradeEvents()
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);
  res.json(events);
});

// GET /api/trades/:tradeId
// Returns a single trade with full context (open or closed).
router.get("/:tradeId", (req, res) => {
  const { tradeId } = req.params;

  const openTrade = getOpenTrades().find((t) => t.tradeId === tradeId) ?? null;
  if (openTrade) {
    const events = getTradeEvents().filter((e) => e.tradeId === tradeId);
    return res.json({ ...openTrade, events });
  }

  const closedTrade = getClosedTrades().find((t) => t.tradeId === tradeId) ?? null;
  if (closedTrade) {
    const events = getTradeEvents().filter((e) => e.tradeId === tradeId);
    return res.json({ ...closedTrade, events });
  }

  res.status(404).json({ error: `Trade not found: ${tradeId}` });
});

export default router;
