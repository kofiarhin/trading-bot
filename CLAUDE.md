# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
npm run monitor:dry        # View open positions (dry-run mode)
```

### Manual Trading CLI
```bash
npm run trade -- "buy 1 share of apple"
npm run trade -- 'buy $100 of tesla'
npm run trade -- "sell apple stock"
npm run trade -- "close my btc position"
npm run trade:dry -- "buy 2 shares of nvidia"  # Preview without executing
```
Wrap dollar-amount commands in single quotes to avoid shell `$` expansion.

### Database
```bash
npm run db:migrate         # Migrate legacy JSON storage files → MongoDB
```

### Testing
```bash
npm test                   # Run all Jest tests
npm run test:watch         # Watch mode
npx jest tests/risk/       # Run a single test directory
npx jest tests/strategies/breakoutStrategy.test.js  # Single test file
```

### Build
```bash
cd client && npm run build   # Build React dashboard to client/dist/
cd client && npm run lint    # ESLint on client code
```

## Architecture

This is a two-part application:

**Backend (`src/`)** — Autopilot trading engine + Express API. Uses ES Modules (`"type": "module"` in root `package.json`).

**Frontend (`client/`)** — React + Vite dashboard. Polls the Express API every 15 seconds to display live trading data.

### Autopilot Pipeline (`src/autopilot.js`)
The core loop runs per-symbol in sequence, tracking progress via `CycleRuntime` (see `src/autopilot/cycleStages.js`):
1. Sync open trades against live broker positions/orders (`SYNCING_BROKER`)
2. Check open trades for exit conditions — stop-loss / take-profit (`MONITORING_POSITIONS`)
3. Fetch 60 bars of 15-min candle data from Alpaca (`FETCHING_MARKET_DATA`)
4. Compute indicators: ATR (14-period), highest high (20-candle), average volume (20-candle)
5. Run breakout strategy → save `Decision` document to MongoDB (`EVALUATING_SIGNALS`)
6. Rank candidates by signal strength (`RANKING_CANDIDATES`)
7. Pass risk guards — daily loss lockout, duplicate positions, cooldown, max positions (`APPLYING_RISK_GUARDS`)
8. Place order via Alpaca API → save trade and cycle events to MongoDB (`PLACING_ORDERS`)
9. Final broker sync to confirm fills (`FINAL_SYNC`)

### Key Module Boundaries
| Directory | Responsibility |
|-----------|---------------|
| `src/strategies/` | Signal generation only — returns approved/rejected with metrics; `breakoutStrategy.js` is the live strategy, `forceTrade.js` for manual overrides |
| `src/risk/` | Guards that block execution — reads risk state from MongoDB for daily loss/cooldowns |
| `src/execution/` | Alpaca API wrappers and order placement |
| `src/journal/` | Trade state management (open/closed trades, decisions, cycle logs) |
| `src/market/` | Symbol universe, bar fetching, market hours filtering |
| `src/indicators/` | Pure calculation functions (ATR, highest high, average volume) |
| `src/analytics/` | Pure analytics functions with no DB calls — `performance.js` (R-multiples, win rate, expectancy) and `exposure.js` (open risk, unrealized P&L by asset class) |
| `src/autopilot/` | Cycle stage constants and progress mapping (`cycleStages.js`) |
| `src/models/` | Mongoose schemas — see Storage section below |
| `src/repositories/` | MongoDB read/write operations — used by journal and risk modules |
| `src/repos/` | Legacy storage repo (`storageRepo.mongo.js`) — distinct from `src/repositories/` |
| `src/positions/` | Exit logic — checks open trades against current price for stop/target hits |
| `src/server/` | Express app + API routes (read-only, no order placement) |
| `src/db/` | MongoDB connection (`connectMongo.js`) and migration (`migrate.js`) |

### Storage (MongoDB)
All state is persisted in MongoDB. The Mongoose models map to these collections:
- `OpenTrade` / `ClosedTrade` / `TradeEvent` — trade lifecycle
- `Decision` — per-symbol strategy decisions per cycle
- `CycleLog` / `CycleRun` — cycle event streams and summaries
- `CycleRuntime` — **singleton** (key `"cycle-runtime"`) tracking live cycle status, stage, progress percentage, and per-symbol metrics; stale after `CYCLE_RUNTIME_STALE_MINUTES` (default 5)
- `RiskState` — **singleton** (key `"risk-state"`) with daily loss and cooldowns
- `JournalRecord` — raw journal payloads

Legacy JSON files under `storage/` may still exist from before the MongoDB migration. Run `npm run db:migrate` once to import them.

### Server API (`src/server/`)
The Express server is read-only — it reads from MongoDB and queries Alpaca directly. It never writes state or places orders. Route groups:
- `/api/dashboard/*` — cycle/decision/risk summaries
- `/api/trades/*` — open and closed trade queries
- `/api/positions/*` — live position data from Alpaca
- `/api/journal/*` — raw journal records
- `/api/cycle/*` — live `CycleRuntime` status (stage, progress, current symbol)
- `/api/performance/*` — closed-trade analytics (win rate, R-multiples, expectancy)
- `/api/exposure/*` — open portfolio exposure and unrealized P&L
- `/api/expectancy/*` — expectancy metrics derived from closed trades
- `/api/candidates/*` — ranked signal candidates from the last cycle
- `/api/rejections/*` — rejection breakdown by risk guard
- `/api/health` — liveness check

CORS is restricted to `CLIENT_URL` env var (defaults to `http://localhost:5173`).

### Frontend API Layer (`client/src/`)
- Shared Axios client: `client/src/lib/api.js` (base URL from `VITE_API_URL` env var)
- Service functions: `client/src/services/dashboard.js`
- React Query hooks: `client/src/hooks/queries/` — `useDashboard.js`, `useJournal.js`, `useCycleRuntime.js`, `useAnalytics.js`
- All queries have 15-second refresh intervals; stale time is 10 seconds
- Do not call API endpoints directly from components — always go through the hook layer

### Environment Configuration
- Root `.env` — Alpaca credentials, MongoDB URI, and all trading parameters (see `.env.example`)
- `client/.env` — `VITE_API_URL` for the dashboard API base URL
- `src/config/env.js` — validates required Alpaca vars and exports typed config
- `src/db/connectMongo.js` — requires `MONGO_URI`; optionally `MONGO_DB_NAME` (falls back to the DB name embedded in the URI)
- **Safety check:** `src/config/env.js` hard-fails if `ALPACA_BASE_URL` is not a paper-trading URL (`paper-api.alpaca.markets`)

### ES Module Specifics
- Root package uses `"type": "module"` — use `import/export` throughout `src/`
- `src/config/loadEnv.cjs` is CommonJS (`.cjs` extension) so it can be required via `-r` flag before ES module scripts load
- Jest uses `--experimental-vm-modules` (set in root `package.json` test config)

## Symbol Universe
**Stocks (market hours only):** `AAPL`, `MSFT`, `NVDA`, `AMZN`, `META`, `TSLA`, `AMD`, `GOOGL`
**Crypto (24/7):** `BTC/USD`, `ETH/USD`, `SOL/USD`, `BNB/USD`, `XRP/USD`, `AVAX/USD`, `ADA/USD`, `LINK/USD`, `MATIC/USD`, `DOT/USD`, `LTC/USD`, `DOGE/USD`, `BCH/USD`, `UNI/USD`, `ATOM/USD`, `NEAR/USD`, `AAVE/USD`, `ETC/USD`, `FIL/USD`, `ALGO/USD`

Controlled by `ENABLE_STOCKS` and `ENABLE_CRYPTO` env vars. The symbol list can also be overridden at runtime via `AUTOPILOT_SYMBOLS` (comma-separated, takes precedence over the universe). Crypto symbols normalized from `BTC/USD` → `BTCUSD` for Alpaca API calls (`src/utils/symbolNorm.js`).

## Breakout Strategy Parameters (`src/strategies/breakoutStrategy.js`)
All configurable via env vars; defaults shown:
- `BREAKOUT_LOOKBACK=20` — candles to look back for highest high
- `VOLUME_LOOKBACK=20` / `ATR_PERIOD=14`
- `ATR_MULTIPLIER=1.5` — stop distance below entry
- `TARGET_MULTIPLE=2` — take-profit as ATR multiple
- `MIN_VOL_RATIO=1.2` — required volume vs. average
- `MAX_DISTANCE_TO_BREAKOUT_PCT=1.0` — max overextension allowed
- `MIN_RISK_REWARD=1.5`

## Risk Parameters (defaults from `.env.example`)
- Per-trade risk: 0.5% of equity
- Daily loss limit: 2% of equity
- Max open positions: 5
- Stock cooldown: 1 trading day after a trade
- Crypto cooldown: 6 hours after a trade

## Testing Notes
- Four test files are excluded via `testPathIgnorePatterns` in `package.json` (not `.skip`): `parser.test.js`, `tradePlanner.test.js`, `tradePlanner.crypto.test.js`, `alpaca.crypto.test.js` — do not remove these exclusions without checking why
- Backend tests use Jest (`tests/`); there are no frontend tests currently
- Test files directly import from `src/` — no mock of the file system unless explicitly set up in the test
- `mongodb-memory-server` is available for in-process MongoDB in tests

## Deployment
- Backend API + worker → Heroku (`Procfile` defines `web` and `worker` dynos)
- Frontend → Vercel (static Vite build)
- Database → MongoDB Atlas
- `CLIENT_URL` Heroku config var must be set to the Vercel frontend URL for CORS to work
