# Trade Journal Implementation Spec (Updated with UI & Navigation)

## Objective
Add a dedicated Trade Journal feature integrated with the existing backend and frontend, including a scalable UI/navigation system.

---

## UI & Navigation Architecture

### App Shell
Introduce a shared layout across the app:

- Header (app title + page title)
- Navigation (Dashboard, Trade Journal)
- Content container

### Routes
- /dashboard (or /)
- /journal
- /journal/:tradeId

Redirect:
- / → /dashboard

### Navigation Behavior
- Active route highlighting
- Persistent layout across pages
- Clean separation between summary (dashboard) and analysis (journal)

---

## Page Roles

### Dashboard
- Live system status
- Summary metrics
- Activity feed

### Trade Journal
- Historical trades
- Filters + search
- Trade lifecycle inspection
- Analytics

---

## Journal Page UX

### Layout Sections
- Summary cards
- Filters bar
- Tabs (Open, Closed, Events)
- Data tables

### Filters
- status
- assetClass
- strategy
- symbol search
- date range

### Tables
- sortable
- clickable rows → /journal/:tradeId

---

## Trade Detail Page

Sections:
- Overview
- Entry / Risk
- Exit / Result
- Metrics snapshot
- Event timeline

---

## Responsive Design

- Desktop: full tables
- Mobile: horizontal scroll (V1)
- Future: stacked cards

---

## State Handling

Must support:
- loading
- empty
- error
- retry

Preserve:
- filters
- pagination
- tab state

---

## Backend (unchanged core)

Reuse:
- /api/trades/open
- /api/trades/closed
- /api/trades/events
- /api/trades/:tradeId

Add:
- /api/journal/summary
- /api/journal/trades

---

## Summary

The Trade Journal becomes:
- diagnostic layer
- historical analysis tool
- performance insight system

With a scalable UI foundation.
