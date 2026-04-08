# Alpaca Autopilot Trading App — Full Implementation Spec (v1)

## 1. Product Goal

Build a user-friendly trading app that:

1. scans the market using real-time and recent historical Alpaca data
2. evaluates a built-in strategy using current market conditions
3. applies hard risk controls
4. places paper trades automatically when a setup is approved
5. logs all decisions, orders, and exits
6. can run on autopilot every 15 minutes

The app is **market-data driven**, not driven by external political/news signals.

---

## 2. Core Product Definition

### Primary user experience

The main product experience should be centered on one command:

```bash
npm run autopilot
```

This command should perform the full pipeline:

```text
Load market universe
→ Fetch Alpaca data
→ Compute indicators
→ Evaluate strategy
→ Run risk guards
→ Place paper orders
→ Log results
→ Exit
```

### Safe mode

```bash
npm run autopilot:dry
```

This runs the same pipeline without placing any orders.

### Scheduler mode

```bash
npm run worker:15m
```

This repeatedly runs the same autopilot cycle every 15 minutes.

---

## 3. Product Scope

### In scope for v1

- Alpaca paper trading only
- Stocks during regular US market hours
- Optional crypto support
- 15-minute strategy cycle
- Real-time market-data-based decisions
- One built-in strategy
- Position sizing based on risk
- Stop-loss and take-profit rules
- Trade journaling
- Duplicate-trade prevention
- Daily loss guard
- Max-open-position guard

### Out of scope for v1

- live-money trading by default
- multiple advanced strategies
- options trading
- social/news/politician signals
- portfolio optimization
- user-created strategy builder
- mobile app
- advanced analytics dashboard

---

## 4. Supported Asset Classes

### Stocks
- Source: Alpaca stock market data + Alpaca paper trading
- Default runtime: regular market hours only
- Default market session: 9:30 AM to 4:00 PM ET
- Strategy timeframe: 15-minute bars

### Crypto
- Source: Alpaca crypto market data + Alpaca paper trading
- Runtime: 24/7
- Strategy timeframe: 15-minute bars
- Crypto should be configurable and optional in v1

---

## 5. User-Facing Modes

## 5.1 `npm run autopilot`

### Purpose
Run one full market scan and execution cycle.

### Behavior
- loads configured symbols
- fetches current and recent market data
- computes indicators
- evaluates each symbol against the strategy
- applies risk rules
- submits paper orders for approved trades
- writes logs and journal entries
- exits

### Side effects
- may place paper trades
- may create or update journal records
- may update risk state counters

---

## 5.2 `npm run autopilot:dry`

### Purpose
Run one full market scan and decision cycle without placing any trades.

### Behavior
- same as `autopilot`
- no order submission
- logs all simulated decisions

### Side effects
- creates journal/simulation logs only

---

## 5.3 `npm run worker:15m`

### Purpose
Run autopilot repeatedly every 15 minutes.

### Behavior
- starts a long-running worker
- waits for valid cycle times
- runs the same core autopilot pipeline
- respects market-hours guards for stocks
- continues until stopped

### Side effects
- may place multiple paper trades across cycles
- updates logs continuously

---

## 5.4 `npm run strategy:simulate`

### Purpose
Developer/test mode for strategy validation without execution.

### Behavior
- pulls configured test symbols
- computes indicators
- outputs detailed decisions
- writes simulation results
- never places orders

---

## 6. Market Hours and Scheduling

## 6.1 Stocks

Default behavior:
- only scan and trade during regular US market hours
- only evaluate on closed 15-minute candles

### Valid stock cycle times
Example:
- 9:45 AM ET
- 10:00 AM ET
- 10:15 AM ET
- ...
- 3:45 PM ET
- 4:00 PM ET

The system must not evaluate a partially formed candle.

### Stock market-hours guard
If current time is outside the configured stock session:
- skip scan
- log skip reason
- do not fetch unnecessary data
- do not place orders

## 6.2 Crypto

Default behavior:
- may run every 15 minutes, 24/7

### Crypto runtime rules
- still use closed 15-minute candles
- still enforce all risk controls
- crypto trading can be enabled or disabled by config

---

## 7. Strategy Definition

## 7.1 Strategy choice for v1

Use:

**Momentum Breakout + ATR Risk Strategy**

This is the built-in strategy for v1 because it is:
- simple
- data-driven
- compatible with Alpaca OHLCV data
- easy to automate
- easy to explain to users
- compatible with both stocks and crypto

---

## 7.2 Strategy Intent

The strategy aims to detect:
- a breakout above recent price structure
- confirmed by above-normal volume
- with risk defined by volatility using ATR

---

## 7.3 Inputs Required Per Symbol

For each symbol, the strategy must have:

- latest close price
- recent 15-minute historical bars
- current volume
- recent average volume
- ATR
- highest high over lookback window
- account equity
- open positions
- current risk state

---

## 7.4 Core Entry Logic

### Long breakout condition

A symbol is eligible only if:

1. latest close is above the highest high of the last N completed candles
2. breakout is confirmed by volume
3. ATR is valid
4. stop-loss distance is valid
5. all risk guards pass

### Example v1 defaults

- breakout lookback: 20 candles
- volume lookback: 20 candles
- ATR period: 14
- ATR multiplier: 1.5
- target multiple: 2R

---

## 7.5 Volume Confirmation

Require:

```text
current candle volume > average volume over last 20 candles
```

Optional config:
- minimum relative volume threshold, e.g. 1.2x average

---

## 7.6 Stop-Loss Rule

Use ATR-based stop-loss:

```text
stopLoss = entryPrice - (1.5 × ATR)
```

This must be calculated before any order is submitted.

No valid stop = no trade.

---

## 7.7 Take-Profit Rule

Use fixed reward-to-risk target:

```text
riskPerUnit = entryPrice - stopLoss
takeProfit = entryPrice + (2 × riskPerUnit)
```

This creates a 2R target by default.

---

## 7.8 Position Sizing Rule

Use fixed fractional risk:

```text
riskAmount = accountEquity × riskPercent
quantity = floor(riskAmount / riskPerUnit)
```

### Example default
- riskPercent = 0.5%

### Quantity constraints
Reject trade if:
- quantity < 1
- riskPerUnit <= 0
- riskAmount <= 0

---

## 7.9 Strategy Output Contract

Each symbol evaluation must return a structured decision like:

```json
{
  "approved": true,
  "symbol": "AAPL",
  "timeframe": "15Min",
  "entryPrice": 182.30,
  "stopLoss": 178.90,
  "takeProfit": 189.10,
  "atr": 2.27,
  "breakoutLevel": 181.95,
  "volumeRatio": 1.34,
  "riskPerUnit": 3.40,
  "quantity": 14,
  "riskAmount": 47.60,
  "reason": "15m breakout confirmed by volume",
  "timestamp": "2026-04-08T14:45:00.000Z"
}
```

Rejected decisions must also return structured output:

```json
{
  "approved": false,
  "symbol": "TSLA",
  "reason": "volume confirmation failed",
  "timestamp": "2026-04-08T14:45:00.000Z"
}
```

---

## 8. Risk Management Specification

## 8.1 Non-negotiable rule

No order is allowed unless all of the following exist:

- entryPrice
- stopLoss
- takeProfit
- riskAmount
- quantity

If any field is missing:
- reject trade
- log the failure

---

## 8.2 Default risk controls

### Per-trade risk
- default: 0.5% of account equity

### Max daily realized loss
- default: 2% of account equity

If hit:
- stop opening new trades for the day
- continue logging and monitoring
- record lockout reason

### Max open positions
- default: 3

If reached:
- reject additional entries

### Duplicate symbol prevention
- do not open a new position in a symbol that already has an open position

### Symbol cooldown
- after closing a trade, do not re-enter the same symbol for a configurable cooldown period
- default: 1 trading day for stocks, 6 hours for crypto

### Liquidity filter
Reject symbols below configured liquidity thresholds.

### Price floor
Reject low-priced symbols below configured minimum price.

---

## 8.3 Suggested stock defaults

- min price: $5
- min average volume: 500,000 shares
- min average dollar volume: $10,000,000

## 8.4 Suggested crypto defaults

- configurable whitelist only
- only scan pairs with sufficient volume
- no illiquid micro pairs

---

## 8.5 Slippage awareness

The app must assume fills may differ from expected entry.
Journal should record:
- expected entry
- actual fill
- slippage estimate

---

## 9. Market Universe Specification

## 9.1 Universe source

The app must scan a configured symbol universe.

### Example stock universe approaches
- manually curated list
- S&P 100 style list
- high-liquidity watchlist
- user-defined symbol file

### Example crypto universe approaches
- manually curated liquid pairs only

---

## 9.2 v1 recommendation

Start with a fixed curated list.

### Example stock list
- AAPL
- MSFT
- NVDA
- AMZN
- META
- TSLA
- AMD
- GOOGL

### Example crypto list
- BTC/USD
- ETH/USD
- SOL/USD

The universe must be configurable.

---

## 10. Data Requirements

## 10.1 Alpaca market data required

For each symbol:
- recent historical 15-minute bars
- latest tradable price or last completed bar close
- volume data

### Historical fields needed
- timestamp
- open
- high
- low
- close
- volume

---

## 10.2 Minimum bar history

To compute v1 strategy safely, fetch enough bars to cover:
- ATR period
- breakout lookback
- volume lookback
- buffer for validation

### Recommended minimum
- 60 completed 15-minute bars per symbol

---

## 10.3 Data validation

Reject symbol evaluation if:
- bars are missing
- bars are stale
- timestamps are not ordered
- insufficient history exists
- ATR cannot be computed
- latest candle is incomplete

---

## 11. Order Execution Specification

## 11.1 Default mode

All execution in v1 must target:
- Alpaca paper trading only

Live trading must be disabled by default.

---

## 11.2 Order type

For v1, use simple market entry with attached internal stop/target logic, unless bracket orders are explicitly supported and chosen.

### Entry
- market order or configurable safe limit rule
- buy only in v1

### Exit handling
At minimum the system must support:
- stop-loss exit
- take-profit exit

---

## 11.3 Execution safety checks

Before placing an order:
- confirm account is in paper mode
- confirm market is open for the asset class
- confirm quantity > 0
- confirm no duplicate open symbol
- confirm max open positions not exceeded
- confirm daily loss lockout not triggered
- confirm latest data freshness

---

## 11.4 Execution result handling

Every order submission must log:
- intended order payload
- API response
- accepted/rejected status
- order ID if available
- error message if failed

---

## 12. Position Management Specification

## 12.1 Open position tracking

The system must track:
- symbol
- entry time
- entry price
- position size
- stop-loss
- take-profit
- current status
- unrealized pnl
- realized pnl on close

---

## 12.2 Exit logic

A position should be closed when:
- stop-loss is hit
- take-profit is hit
- manual close is triggered
- optional stale-position timeout rule is triggered

---

## 12.3 Optional stale-position rule

Configurable rule:
- close position if neither stop nor target is hit after N bars/days

This is optional for v1 but recommended.

---

## 13. Logging and Journaling

## 13.1 Log types

The app must log at least:

- cycle started
- cycle skipped
- symbol data fetched
- strategy approved
- strategy rejected
- risk guard rejected
- order submitted
- order failed
- position opened
- position closed
- daily lockout triggered

---

## 13.2 Journal record fields

Each trade journal entry should contain:

```json
{
  "symbol": "AAPL",
  "assetType": "stock",
  "timeframe": "15Min",
  "signalTime": "2026-04-08T14:45:00.000Z",
  "entryPricePlanned": 182.30,
  "entryPriceFilled": 182.41,
  "stopLoss": 178.90,
  "takeProfit": 189.10,
  "quantity": 14,
  "riskAmount": 47.60,
  "strategyName": "momentum_breakout_atr_v1",
  "approvalReason": "15m breakout confirmed by volume",
  "orderStatus": "filled",
  "exitPrice": null,
  "exitReason": null,
  "pnl": null
}
```

---

## 13.3 Storage recommendation

For v1:
- JSON logs plus database journal records

If MongoDB is already part of the stack, use MongoDB for:
- trades
- cycle logs
- positions
- risk state

---

## 14. Configuration Specification

All user secrets must live in `.env`.

### Required environment variables

```env
NODE_ENV=development
PORT=5000

ALPACA_API_KEY=your_key
ALPACA_API_SECRET=your_secret
ALPACA_BASE_URL=https://paper-api.alpaca.markets

MONGO_URI=your_mongodb_connection_string
DEFAULT_TIMEFRAME=15Min
RISK_PERCENT=0.005
MAX_DAILY_LOSS_PERCENT=0.02
MAX_OPEN_POSITIONS=3
ENABLE_CRYPTO=false
RUN_MODE=paper
```

### Important rules
- never hard-code secrets
- validate all required env vars at startup
- fail fast on invalid config

---

## 15. Folder Structure

```text
src/
  autopilot.js
  worker15m.js

  config/
    env.js
    runtimeConfig.js

  market/
    alpacaMarketData.js
    universe.js
    marketHours.js

  indicators/
    atr.js
    sma.js
    highestHigh.js
    averageVolume.js

  strategies/
    breakoutStrategy.js

  risk/
    guards.js
    positionSizing.js
    riskState.js

  execution/
    alpacaTrading.js
    orderManager.js

  positions/
    positionMonitor.js

  journal/
    tradeJournal.js
    cycleLogger.js

  scheduler/
    runCycle.js

  utils/
    time.js
    math.js
    logger.js

test/
  setup/
  fixtures/
  mocks/
  integration/
  strategies/
  risk/
  execution/
```

---

## 16. Command Specification

### `npm run autopilot`
Runs one full market-data-to-order cycle.

### `npm run autopilot:dry`
Runs one full market-data-to-decision cycle with no orders.

### `npm run worker:15m`
Starts recurring 15-minute execution.

### `npm run strategy:simulate`
Runs strategy-only simulation mode.

### Suggested package.json scripts

```json
{
  "scripts": {
    "dev": "node --watch src/autopilot.js --dry-run",
    "autopilot": "node src/autopilot.js",
    "autopilot:dry": "node src/autopilot.js --dry-run",
    "worker:15m": "node src/worker15m.js",
    "strategy:simulate": "node src/simulateStrategy.js",
    "test": "jest --runInBand"
  }
}
```

---

## 17. Core Runtime Flow

## 17.1 Autopilot cycle

```text
Start cycle
→ load config
→ validate env
→ fetch account info
→ check daily loss lockout
→ load open positions
→ load symbol universe
→ filter by market-hours eligibility
→ fetch recent bars for each symbol
→ validate data quality
→ compute indicators
→ evaluate strategy
→ run risk guards
→ sort approved candidates if needed
→ submit paper orders
→ save journal + logs
→ end cycle
```

---

## 17.2 Worker flow

```text
Start worker
→ wait until next valid 15-minute close
→ run autopilot cycle
→ sleep
→ repeat
```

---

## 18. Failure Handling

The system must handle and log:

- Alpaca auth failures
- missing env vars
- stale data
- bad indicator calculations
- symbol fetch failures
- order rejection
- partial API outages
- database write failures

### Error handling rule
- never swallow async errors
- always log actionable error context
- continue safely when possible
- fail closed when safety is uncertain

---

## 19. Testing Specification

Use:
- Jest for backend tests

### Test coverage requirements

#### Strategy tests
- approves valid breakout
- rejects no breakout
- rejects low volume
- rejects invalid ATR
- rejects invalid stop-loss

#### Risk tests
- rejects over daily loss limit
- rejects duplicate open symbol
- rejects when max positions reached
- rejects when quantity is zero

#### Execution tests
- blocks non-paper mode by default
- logs failed orders
- handles Alpaca API errors

#### Integration tests
- full dry-run autopilot cycle
- successful approved trade flow
- rejected trade flow
- worker skips outside stock market hours

---

## 20. Safety Defaults

The app should ship with these defaults:

- paper trading only
- dry-run strongly recommended first
- stocks only during regular market hours
- conservative risk sizing
- fixed liquid universe
- buy-side only
- no leverage
- no live money mode exposed in v1 UI

---

## 21. Future Extensions

Possible v2 or v3 additions:
- multiple strategies
- user strategy selection
- live dashboard
- email/Telegram alerts
- bracket orders
- trailing stop logic
- partial profit taking
- live trading mode
- performance analytics UI
- user onboarding flow
- hosted SaaS version

---

## 22. Final Product Summary

The v1 app should be a:

**real-time Alpaca-powered autopilot trading engine that scans configured stocks and optional crypto on closed 15-minute candles, evaluates a breakout + ATR strategy, applies strict loss-prevention guardrails, places paper trades automatically, and logs every decision and outcome.**

The user-facing experience should be simple:

```bash
npm run autopilot
```

Or for safe testing:

```bash
npm run autopilot:dry
```

And for continuous automation:

```bash
npm run worker:15m
```

That is the full implementation target for v1.
