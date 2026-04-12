# Trade Journal Implementation Plan (Updated with UI & Navigation)

## Objective
Implement Trade Journal with full UI navigation and scalable layout.

---

## Phase 0 — App Shell (NEW)

### Tasks
- Create Layout component
- Add header + navigation
- Add route structure

### Routes
- /dashboard
- /journal
- /journal/:tradeId

### Acceptance
- Navigation works
- Layout consistent across pages

---

## Phase 1 — Journal UI (V1)

### Tasks
- TradeJournalPage
- TradeDetailPage
- Tables + filters
- Use existing APIs

### Acceptance
- Open/closed trades visible
- Detail page works

---

## Phase 2 — Backend Enhancements

### Tasks
- Add /api/journal/summary
- Add /api/journal/trades
- Add filtering + pagination

---

## Phase 3 — UX Improvements

### Tasks
- Persist filters
- Improve table UX
- Improve timeline UI

---

## Phase 4 — Analytics

### Tasks
- Win rate
- Avg win/loss
- PnL metrics

---

## UI Requirements

- Consistent styling with dashboard
- Clear navigation separation
- Responsive tables
- Loading/empty/error states

---

## Risks

- UI inconsistency → solved via shared layout
- complexity → build in phases

---

## Definition of Done

- Navigation implemented
- Journal pages live
- Filters working
- Trade detail page complete
- No dashboard regression

---

## Summary

Build in layers:

1. App shell + navigation
2. Journal UI
3. Backend optimization
4. Analytics

Result:
A scalable multi-page trading application.
