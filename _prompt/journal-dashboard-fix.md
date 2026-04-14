# Claude Code Prompt — Fix Dashboard vs Journal Open Trade Mismatch

## Problem
Dashboard shows broker-based open positions while Journal shows only internal trades, causing mismatch.

## Goal
Make distinction explicit without corrupting performance metrics.

## Backend Changes

### Add fields to /api/journal/summary:
- journalOpenTrades
- brokerSyncOpenTrades
- liveOpenPositions

### Definitions
- journalOpenTrades: internal trades excluding broker_sync
- brokerSyncOpenTrades: trades from broker reconciliation
- liveOpenPositions: broker reality

### Refactor
Extract shared helper for merged open positions and reuse across:
- dashboard summary
- dashboard positions
- journal summary

### Keep performance clean
Do NOT include broker_sync in:
- win rate
- pnl
- total trades

## Frontend Changes

### Update Journal UI
Replace:
- Open

With:
- Journal Open
- Live Positions

Optional:
- sublabel: "broker-synced"

### Use new fields

## Constraints
- Do not break dashboard
- Do not merge meanings
- Prefer shared logic
- Keep minimal changes

## Tests

### Backend
- summary returns new fields
- live positions match dashboard
- performance excludes broker_sync

### Frontend
- renders correct labels
- uses correct fields

## Expected Result

Dashboard: 1 open position  
Journal:
- Journal Open: 0  
- Live Positions: 1  

Clear and correct.

## Output
- summary
- changed files
- notes
- tests
