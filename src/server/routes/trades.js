// Trades API — read endpoints for raw journal trade data.
// Separate from dashboard routes to keep dashboard.js focused on UI aggregation.
import { Router } from "express";
import { getOpenTrades, getClosedTrades, getTradeEvents } from "../../journal/tradeJournal.js";

const router = Router();

// GET /api/trades/open
// Returns all active open trade journal records.
router.get("/open", async (req, res) => {
  const trades = (await getOpenTrades()).filter((t) => t.status !== "canceled");
  res.json(trades);
});

// GET /api/trades/closed
// Returns closed trade history.
router.get("/closed", async (req, res) => {
  const limit = parseInt(req.query.limit ?? "200", 10);
  const closed = (await getClosedTrades())
    .sort((a, b) => new Date(b.closedAt ?? 0) - new Date(a.closedAt ?? 0))
    .slice(0, limit);
  res.json(closed);
});

// GET /api/trades/events
// Returns recent trade lifecycle events.
router.get("/events", async (req, res) => {
  const limit = parseInt(req.query.limit ?? "200", 10);
  const events = (await getTradeEvents())
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);
  res.json(events);
});

// GET /api/trades/:tradeId
// Returns a single trade with full context (open or closed).
router.get("/:tradeId", async (req, res) => {
  const { tradeId } = req.params;
  const [openTrades, closedTrades, tradeEvents] = await Promise.all([
    getOpenTrades(),
    getClosedTrades(),
    getTradeEvents(),
  ]);

  const openTrade = openTrades.find((t) => t.tradeId === tradeId) ?? null;
  if (openTrade) {
    const events = tradeEvents.filter((e) => e.tradeId === tradeId);
    return res.json({ ...openTrade, events });
  }

  const closedTrade = closedTrades.find((t) => t.tradeId === tradeId) ?? null;
  if (closedTrade) {
    const events = tradeEvents.filter((e) => e.tradeId === tradeId);
    return res.json({ ...closedTrade, events });
  }

  res.status(404).json({ error: `Trade not found: ${tradeId}` });
});

export default router;
