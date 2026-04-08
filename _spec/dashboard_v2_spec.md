# Trading Bot Dashboard — V2 Enhancement Spec

## 1. Objective

Enhance the existing dashboard from a basic monitoring UI into a **full operational trading control panel**.

The goal is to improve:
- decision visibility
- trade context
- system transparency
- usability for real trading operations

---

## 2. Current State (Baseline)

The dashboard already supports:

- Bot status display
- Last cycle summary
- Symbols scanned / approved / rejected
- Orders today
- Open positions count
- Daily PnL (basic)
- Activity feed (minimal)
- Open positions table
- Signals placeholder

This is a strong MVP foundation.

---

## 3. Core Problem

The dashboard shows **what happened**, but not **why it happened**.

Missing:
- structured decision visibility
- trade-level context
- risk information
- richer activity tracing

---

## 4. Enhancement Goals

The dashboard must evolve to:

1. Explain **why trades are rejected or approved**
2. Show **risk and strategy context**
3. Improve **operational clarity**
4. Provide **real-time trust signals**
5. Support **future trade management**

---

## 5. Feature Enhancements

## 5.1 Bot Status Upgrade

### Current:
- Idle

### Upgrade to:
- Running
- Waiting for next cycle
- Dry Run
- Paper Trading
- Error
- Paused

### UI Example:
```
Waiting for next 15m cycle
Paper trading • Dry run OFF
```

---

## 5.2 Last Cycle Panel Upgrade

### Add:
- Start time
- End time
- Duration

### Example:
```
Start: 12:47:00 AM
End:   12:47:15 AM
Duration: 15s
```

---

## 5.3 Signals Section Upgrade

### Problem:
Currently only shows approved signals (empty state).

### Fix:
Show **all decisions** (approved + rejected)

### Table Columns:
- Timestamp
- Symbol
- Asset Class
- Decision (Approved / Rejected)
- Reason
- Close Price
- Breakout Level
- ATR
- Volume Ratio

---

## 5.4 Recent Decisions Panel (NEW)

### Purpose:
Expose strategy reasoning.

### Fields:
- Time
- Symbol
- Asset
- Decision
- Reason
- Close
- Breakout Level
- ATR
- Volume Ratio

This is the **most important new component**.

---

## 5.5 Open Positions Enhancement

### Add fields:
- Stop Loss
- Take Profit
- Opened At
- Risk Amount
- Strategy Name

### Purpose:
Move from portfolio view → trade management view

---

## 5.6 Asset Label Cleanup

### Replace:
- Us_equity → Stock
- Crypto → Crypto

---

## 5.7 PnL Card Enhancement

### Split into:
- Realized PnL (today)
- Unrealized PnL
- Total Equity

### Example:
```
Realized Today: +$0.00
Unrealized: +$4,422.69
Equity: $104,415
```

---

## 5.8 Activity Feed Upgrade

### Current:
- Only cycle summary

### Upgrade:
Include granular events:

- Cycle started
- Bars fetched
- Strategy rejected (per symbol)
- Strategy approved
- Order placed
- Order failed
- Position opened
- Position closed
- Cycle complete

---

## 5.9 Auto Refresh Indicator

### Add:
- Last updated timestamp
- Refresh interval

### Example:
```
Last updated: 12:47:16 AM
Refresh: every 15s
```

---

## 5.10 Layout Improvements

### Current:
- Top cards
- Cycle + Activity side-by-side

### Improved layout:

Row 1:
- Summary cards

Row 2:
- Last Cycle (left)
- Activity Feed (right)

Row 3:
- Recent Decisions (full width)

Row 4:
- Open Positions (full width)

---

## 6. MVP → V2 Priority Order

### Priority 1
- Recent Decisions table

### Priority 2
- Last cycle start + duration

### Priority 3
- Activity feed upgrade

### Priority 4
- Open positions (stop/target/risk)

### Priority 5
- PnL breakdown

---

## 7. Backend Requirements

New or updated endpoints:

- GET /api/dashboard/decisions
- GET /api/dashboard/activity (enhanced)
- GET /api/dashboard/positions/open (extended fields)
- GET /api/dashboard/summary (PnL split)

---

## 8. Frontend Components to Add

- RecentDecisionsTable.jsx
- EnhancedActivityFeed.jsx
- PositionDetailsPanel.jsx
- PnlBreakdownCard.jsx
- StatusIndicator.jsx

---

## 9. Final Goal

Transform the dashboard into:

> A real-time trading control panel that explains system behavior, not just displays it.

---

## 10. Success Criteria

The dashboard is successful when a user can:

- understand why trades are rejected
- see current risk exposure
- track system activity clearly
- trust the bot’s decisions
- debug strategy behavior visually

---

## 11. Summary

The current dashboard is functional.

The next version must be:
- more transparent
- more data-rich
- more operational

Focus on **decision visibility and trade context** as the primary upgrade.
