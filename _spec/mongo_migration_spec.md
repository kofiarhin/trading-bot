# MongoDB Migration Spec for Trading Bot Codebase

## Objective
Replace file-based storage with MongoDB for all durable bot state and activity, while preserving the current execution flow.

---

## Current File-Based Storage
The bot currently uses JSON files for:
- Open trades
- Closed trades
- Trade events
- Decisions
- Cycle logs
- Risk state

This breaks on Heroku due to ephemeral filesystem.

---

## Migration Target
MongoDB will store:
- open_trades
- closed_trades
- trade_events
- decisions
- cycle_runs
- risk_state

Alpaca remains source of truth for live broker state.

---

## Design Principle
Do NOT rewrite the bot.
Replace storage layer only.

---

## New Dependencies
```
npm install mongoose
```

---

## Environment Variables
```
MONGO_URI=mongodb://localhost:27017/trading-bot
MONGO_DB_NAME=trading-bot
```

---

## New Structure
```
src/db/connectMongo.js
src/models/*
src/repositories/*
```

---

## Models Overview

### OpenTrade
Stores active/pending trades.

### ClosedTrade
Stores archived trades.

### TradeEvent
Stores activity logs.

### Decision
Stores trade decisions.

### CycleRun
Stores bot cycle summaries.

### RiskState
Stores global risk guard.

---

## Repository Layer
Create Mongo repositories:
- tradeJournalRepo.mongo.js
- decisionRepo.mongo.js
- cycleRepo.mongo.js
- riskStateRepo.mongo.js

These mirror existing journal functions.

---

## Refactor Plan

### tradeJournal.js
- Replace file IO with Mongo repo calls
- Keep function names unchanged

### autopilot.js
- Replace:
  - appendDailyRecord → Mongo decisions
  - appendLogEvent → Mongo cycle/events
  - riskState file → Mongo risk state

### decisionLogger.js / cycleLogger.js
- Wrap Mongo repos instead of writing files

### dashboard.js
- Continue using journal functions
- Gradually remove file-based reads

---

## Migration Script
Create:
```
src/db/migrateJsonToMongo.js
```

Must:
- read JSON files
- normalize data
- upsert into Mongo
- be idempotent

---

## Validation Rules
- Mongo required in production
- Fail fast if not connected
- Validate required fields on write

---

## Testing Plan
Test:
- Mongo connection
- trade journal repo
- decision repo
- cycle repo
- risk state repo
- migration script

---

## Deployment Architecture

### Heroku
- API (web dyno)
- Bot worker (clock dyno)

### Vercel
- frontend dashboard

### MongoDB Atlas
- shared persistent storage

---

## Success Criteria
- No JSON file dependency
- All journal functions use Mongo
- Dashboard works unchanged
- Bot survives restarts
- Migration script works
- Tests pass

---

## Implementation Order
1. Add Mongo connection
2. Add models
3. Add repositories
4. Refactor tradeJournal
5. Refactor autopilot logging/state
6. Wire Mongo into server + worker
7. Add migration script
8. Add tests
9. Verify dashboard
10. Remove file usage
