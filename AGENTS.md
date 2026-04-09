# Agents.md

## Overview
This document defines how agents (automation, AI, or scripts) should interact with this codebase. It consolidates development commands, architecture, and execution rules.

---

## Commands

### Development
```bash
npm run dev           # Run server (port 5000) + client (port 5173) concurrently
npm run server        # Express API server only
npm run client        # Vite React dashboard only
```

### Autopilot Engine
```bash
npm run autopilot          # One full cycle: scan → strategy → risk → execute
npm run autopilot:dry      # Same, no orders placed (safe for testing)
npm run worker:15m         # Long-running process, triggers on 15-min candles
npm run strategy:simulate  # Strategy-only evaluation, no execution
npm run monitor            # View open positions
```

### Testing
```bash
npm test
npm run test:watch
npx jest tests/risk/
npx jest tests/strategies/breakoutStrategy.test.js
```

### Build
```bash
cd client && npm run build
cd client && npm run lint
```

---

## Architecture

### Backend (`src/`)
Autopilot trading engine + Express API (ES Modules)

### Frontend (`client/`)
React + Vite dashboard (polls every 15 seconds)

---

## Autopilot Pipeline

1. Fetch market data (Alpaca)
2. Compute indicators (ATR, highs, volume)
3. Run strategy
4. Apply risk guards
5. Execute trades
6. Persist logs

---

## Module Responsibilities

- strategies → signal generation
- risk → execution guards
- execution → order placement
- journal → persistence
- market → data fetching
- indicators → calculations
- server → API only (read-only)

---

## Storage

All state is JSON-based under `/storage`:

- riskState.json
- logs/YYYY-MM-DD.json
- journal/YYYY-MM-DD.json
- decisions/YYYY-MM-DD.json

---

## API Rules

- Express server is read-only
- No state mutation from API
- Dashboard reads from storage + Alpaca

---

## Frontend Rules

- Use shared API client
- Use service layer
- Use React Query hooks
- No direct API calls in components

---

## Environment

- Root `.env` → backend config
- `client/.env` → frontend config
- Env validation enforced
- Only paper trading allowed

---

## Risk Defaults

- 0.5% risk per trade
- 2% daily loss limit
- Max 3 positions
- Cooldowns enforced

---

## Testing

- Jest backend only
- Some tests intentionally skipped
- Do not remove `.skip` blindly

---

## Agent Rules

- Never bypass risk module
- Never write outside storage/
- Never execute trades in dry mode
- Always validate env before running
- Always log decisions + executions
