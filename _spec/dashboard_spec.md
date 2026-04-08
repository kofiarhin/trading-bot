# Trading Bot Dashboard — Full Implementation Spec

## 1. Objective

Build a frontend dashboard for the trading bot that allows users to:

- monitor autopilot activity in real time
- understand strategy decisions (approve/reject)
- track open positions and performance
- debug and improve trading behavior

This dashboard transforms the bot from a CLI tool into a visual trading system.

---

## 2. Core Questions the Dashboard Must Answer

1. Is the bot running?
2. What did it scan?
3. Why were trades approved or rejected?
4. What positions are open?
5. How is performance over time?

---

## 3. Architecture Overview

Frontend:
- React (Vite)
- Tailwind CSS
- TanStack Query
- Recharts

Backend:
- Node.js (existing)
- Express APIs

---

## 4. Pages Structure

### 4.1 Dashboard Overview (MVP)

Sections:

1. Summary Cards
- Bot Status
- Last Cycle Time
- Symbols Scanned
- Approved Signals
- Orders Placed Today
- Open Positions
- Daily PnL

2. Last Cycle Panel
- start time
- end time
- scanned
- approved
- rejected
- errors

3. Recent Signals Table
- Symbol
- Asset Class
- Decision
- Reason
- Close Price
- Breakout Level
- ATR
- Volume Ratio

4. Open Positions Table
- Symbol
- Entry Price
- Current Price
- Quantity
- Stop Loss
- Take Profit
- Unrealized PnL

5. Activity Feed
- cycle start
- bars fetched
- strategy decisions
- orders

---

### 4.2 Signals Page

Full decision history with filters.

---

### 4.3 Positions Page

Open + Closed positions.

---

### 4.4 Performance Page

Metrics + charts.

---

### 4.5 Settings Page

Read-only config view.

---

## 5. Backend API Requirements

GET /api/dashboard/status  
GET /api/dashboard/summary  
GET /api/dashboard/cycles/latest  
GET /api/dashboard/signals  
GET /api/dashboard/positions/open  
GET /api/dashboard/positions/closed  
GET /api/dashboard/performance  

---

## 6. Frontend Structure

client/src/
  components/
  pages/
  hooks/queries/
  services/

---

## 7. MVP Scope

Build:
- Overview page
- Summary cards
- Signals table
- Open positions
- Activity feed

---

## 8. UI Guidelines

- Dark mode
- Compact layout
- Color-coded status

---

## 9. Next Steps

- Add charts
- Add filters
- Add controls

---

## 10. Final Goal

A real-time trading control panel that provides visibility, control, and insight.
