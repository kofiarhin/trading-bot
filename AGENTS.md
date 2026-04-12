# AGENTS.md

## Overview
This repository contains a **two-part trading system**:

- **Backend (`src/`)** — Autopilot trading engine + Express API (ES Modules)
- **Frontend (`client/`)** — React (Vite) dashboard polling live data every 15s

Agents should treat:
- Backend = **state + execution**
- Frontend = **read-only visualization**

---

## Core Commands

### Development
```bash
npm run dev        # Server (5000) + Client (5173)
npm run server     # Backend only
npm run client     # Frontend only
```

### Autopilot Engine
```bash
npm run autopilot          # Full cycle: scan → strategy → risk → execute
npm run autopilot:dry      # Safe mode (no trades)
npm run worker:15m         # Continuous loop (15m candles)
npm run strategy:simulate  # Strategy only
npm run monitor            # Open positions
```

### Database
```bash
npm run db:migrate         # JSON → MongoDB migration
```

### Testing
```bash
npm test
npm run test:watch
npx jest tests/risk/
npx jest tests/strategies/breakoutStrategy.test.js
```

### Build (Frontend)
```bash
cd client && npm run build
cd client && npm run lint
```

---

## System Architecture

### Autopilot Pipeline (`src/autopilot.js`)
Execution flow per symbol:

1. Sync open trades with broker
2. Evaluate exits (SL/TP)
3. Fetch 60 × 15m candles
4. Compute indicators:
   - ATR (14)
   - Highest High (20)
   - Avg Volume (20)
5. Run strategy → store `Decision`
6. Apply risk guards
7. Execute trade → persist state

---

## Module Boundaries

| Module | Responsibility |
|------|----------------|
| `strategies/` | Signal generation only |
| `risk/` | Execution blockers (limits, cooldowns) |
| `execution/` | Alpaca API + order placement |
| `journal/` | Trade lifecycle state |
| `market/` | Symbols + candle data |
| `indicators/` | Pure math functions |
| `models/` | Mongoose schemas |
| `repositories/` | DB access layer |
| `positions/` | Exit logic |
| `server/` | Read-only API |
| `db/` | Mongo connection + migration |

---

## Data Storage (MongoDB)

Collections:

- `OpenTrade`, `ClosedTrade`, `TradeEvent`
- `Decision`
- `CycleLog`, `CycleRun`
- `RiskState` (singleton: "risk-state")
- `JournalRecord`

⚠️ Legacy JSON exists in `/storage`  
Run migration once.

---

## API Design (Read-Only)

Routes:

- `/api/dashboard/*` → cycle + risk summaries
- `/api/trades/*` → trade history
- `/api/positions/*` → live Alpaca positions
- `/api/health`

❗ Server must NEVER:
- Place trades
- Mutate state

---

## Frontend Data Layer

Structure:

- `lib/api.js` → Axios client (`VITE_API_URL`)
- `services/` → API wrappers
- `hooks/queries/` → React Query hooks

Rules:
- No API calls in components
- Polling: 15s
- Stale time: 10s

---

## Environment Rules

### Backend (`.env`)
- Alpaca credentials
- MongoDB URI
- Trading config

### Frontend (`client/.env`)
```
VITE_API_URL=
```

### Enforcement
- `env.js` validates required vars
- Hard fail if NOT using Alpaca paper trading

---

## ES Modules

- `"type": "module"` enforced
- Use `import/export`
- `loadEnv.cjs` exists for preloading env
- Jest runs with `--experimental-vm-modules`

---

## Symbol Universe

### Stocks (market hours)
```
AAPL MSFT NVDA AMZN META TSLA AMD GOOGL
```

### Crypto (24/7)
```
BTC/USD ETH/USD SOL/USD BNB/USD XRP/USD ...
```

### Notes
- Controlled via env flags:
  - `ENABLE_STOCKS`
  - `ENABLE_CRYPTO`
- Normalization:
  BTC/USD → BTCUSD

---

## Risk Defaults

- Trade risk: 0.5% equity
- Daily loss limit: 2%
- Max positions: 5
- Cooldowns:
  - Stocks: 1 day
  - Crypto: 6 hours

---

## Agent Constraints

### DO
- Respect module boundaries
- Use repositories for DB access
- Keep strategies pure (no side effects)
- Validate all inputs
- Follow existing patterns

### DO NOT
- Place trades from API layer
- Bypass risk guards
- Access DB directly outside repositories
- Call APIs from React components

---

## Testing Rules

- Backend: Jest only
- Some tests are `.skip` → do NOT remove blindly
- Tests import directly from `src/`
- No implicit mocks

---

## Execution Mental Model

Agents should think in this order:

Market Data → Strategy → Risk → Execution → Journal → API → UI

Each step is isolated. Never mix concerns.

---

## Safety Guarantees

- Risk layer is authoritative
- API layer is read-only
- Env validation is strict
- Paper trading enforced

---

## Priority for Changes

1. Preserve trading safety
2. Maintain data integrity
3. Respect architecture boundaries
4. Keep frontend passive
