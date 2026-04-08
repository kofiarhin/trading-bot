# Alpaca Autopilot Trading App — Full Extension Implementation Spec (Stocks + Crypto Enabled by Default)

## 1. Objective

Extend the current trading bot into a unified autopilot engine that:

- scans **all supported asset classes by default**
- uses **current market data from Alpaca**
- runs a built-in strategy on **closed 15-minute candles**
- applies **strict risk controls before any order**
- places **paper trades automatically**
- supports **one-shot** and **scheduled** execution
- supports **stocks and crypto together by default**

The extension must make crypto a first-class asset in the same autopilot pipeline as stocks.

---

## 2. Product Definition

## 2.1 Main user experience

The product should center on these commands:

```bash
npm run autopilot
npm run autopilot:dry
npm run worker:15m
npm run strategy:simulate
```

### `npm run autopilot`
Runs one full scan → strategy → risk → order cycle.

### `npm run autopilot:dry`
Runs the same cycle without placing any orders.

### `npm run worker:15m`
Runs the same autopilot cycle every 15 minutes.

### `npm run strategy:simulate`
Runs strategy-only evaluation for testing and debugging.

---

## 2.2 Default product behavior

All supported asset classes must be enabled by default:

- stocks: enabled
- crypto: enabled

This means a fresh install must scan both asset classes without requiring extra toggles.

### Important distinction
Enabled by default does **not** mean always tradable at the same time.

Eligibility rules still apply:

- stocks: only eligible during configured stock session
- crypto: eligible 24/7

---

## 3. Extension Goals

This extension must add or guarantee all of the following:

1. stocks and crypto are both enabled by default
2. crypto is included in `autopilot` and `autopilot:dry`
3. crypto is not blocked by stock market-hours rules
4. symbol matching is normalized across stocks, crypto, positions, journaling, and guards
5. crypto bars are fetched through the same autopilot market-data layer
6. strategy evaluation works for both stocks and crypto
7. position sizing supports integer stock quantity and fractional crypto quantity
8. duplicate prevention works across normalized symbols
9. worker mode can run overnight for crypto while skipping closed stock sessions
10. logs clearly show stock and crypto universe counts and eligibility counts

---

## 4. Architectural Principle

Use one shared pipeline for all assets:

```text
Universe
→ Eligibility
→ Market Data Fetch
→ Data Validation
→ Indicator Computation
→ Strategy Evaluation
→ Risk Guards
→ Order Execution
→ Journal + Logs
```

Asset-specific behavior should be injected through configuration and asset-aware helpers, not through separate bots.

---

## 5. Functional Scope

## 5.1 In scope

- stock + crypto universe support
- both asset classes enabled by default
- unified autopilot pipeline
- unified strategy output contract
- normalized symbol comparisons
- crypto 24/7 eligibility
- stock session-aware eligibility
- paper trading only by default
- dry-run mode
- recurring 15-minute worker mode
- journaling and logs for both asset classes

## 5.2 Out of scope

- live-money mode by default
- options
- multiple strategies in v1
- user-auth SaaS UI
- mobile app
- news/social signals
- leverage/margin logic
- advanced portfolio optimization

---

## 6. Commands and Runtime Contract

## 6.1 `npm run autopilot`

### Purpose
Runs one full autopilot cycle across all enabled assets.

### Expected behavior
- load config
- validate env
- fetch account
- fetch open positions
- build stock + crypto universe
- apply session eligibility
- fetch bars
- validate bars
- compute indicators
- run strategy
- apply risk guards
- place paper orders
- save journal and logs
- exit

### Side effects
- may submit paper orders
- may update risk state
- may create journal records

---

## 6.2 `npm run autopilot:dry`

### Purpose
Runs the same cycle in safe mode.

### Expected behavior
- identical to `autopilot`
- does not place orders
- still writes decisions and logs

### Side effects
- no order submission
- logs/journal only

---

## 6.3 `npm run worker:15m`

### Purpose
Runs autopilot continuously at each 15-minute boundary.

### Expected behavior
- wait until next valid closed-candle time
- run the same core autopilot cycle
- continue indefinitely
- skip stock execution outside session
- still process crypto if enabled

### Side effects
- repeated logs and possible paper orders across cycles

---

## 6.4 `npm run strategy:simulate`

### Purpose
Developer/testing mode for evaluating strategy decisions without execution.

### Expected behavior
- fetch bars
- compute indicators
- run strategy
- output approvals/rejections
- no order placement

---

## 7. Asset Enablement Rules

## 7.1 Defaults

These must be the product defaults:

```env
ENABLE_STOCKS=true
ENABLE_CRYPTO=true
```

If env values are missing, runtime config must still assume both are enabled.

### Required parsing rule

Only explicit `"false"` disables an asset class.

Example:

```js
enableStocks = env.ENABLE_STOCKS !== "false";
enableCrypto = env.ENABLE_CRYPTO !== "false";
```

---

## 7.2 Default universes

### Stocks
```env
STOCK_UNIVERSE=AAPL,MSFT,NVDA,AMZN,META,TSLA,AMD,GOOGL
```

### Crypto
```env
CRYPTO_UNIVERSE=BTC/USD,ETH/USD,SOL/USD
```

The universe must remain configurable.

---

## 8. Environment and Configuration

## 8.1 Required env vars

```env
NODE_ENV=development
PORT=5000

ALPACA_API_KEY=your_key
ALPACA_API_SECRET=your_secret
ALPACA_BASE_URL=https://paper-api.alpaca.markets
MONGO_URI=your_mongodb_connection_string

RUN_MODE=paper
DEFAULT_TIMEFRAME=15Min

ENABLE_STOCKS=true
ENABLE_CRYPTO=true

STOCK_UNIVERSE=AAPL,MSFT,NVDA,AMZN,META,TSLA,AMD,GOOGL
CRYPTO_UNIVERSE=BTC/USD,ETH/USD,SOL/USD

RISK_PERCENT=0.005
MAX_DAILY_LOSS_PERCENT=0.02
MAX_OPEN_POSITIONS=3

MIN_STOCK_PRICE=5
MIN_STOCK_AVG_VOLUME=500000
MIN_STOCK_AVG_DOLLAR_VOLUME=10000000

MIN_CRYPTO_AVG_DOLLAR_VOLUME=5000000
CRYPTO_QTY_PRECISION=6
```

---

## 8.2 `.env.example` requirements

The example env file must include stock and crypto enabled by default.
It must describe:

- what each setting controls
- that `RUN_MODE=paper` is the default
- that crypto is scanned 24/7
- that stocks only scan during stock session

---

## 8.3 Runtime config contract

Runtime config must expose:

```js
{
  trading: {
    runMode,
    timeframe,
    enableStocks,
    enableCrypto,
    stockUniverse,
    cryptoUniverse,
    riskPercent,
    maxDailyLossPercent,
    maxOpenPositions,
    minStockPrice,
    minStockAvgVolume,
    minStockAvgDollarVolume,
    minCryptoAvgDollarVolume,
    cryptoQtyPrecision
  }
}
```

---

## 9. Universe Builder Specification

## 9.1 File
`src/market/universe.js`

## 9.2 Responsibility
Build the scan universe for all enabled assets.

## 9.3 Output contract

The universe builder must return records like:

```js
[
  { symbol: "AAPL", assetClass: "stock" },
  { symbol: "MSFT", assetClass: "stock" },
  { symbol: "BTC/USD", assetClass: "crypto" },
  { symbol: "ETH/USD", assetClass: "crypto" }
]
```

## 9.4 Rules

- include stock symbols if `enableStocks === true`
- include crypto symbols if `enableCrypto === true`
- trim whitespace
- dedupe values
- preserve `assetClass` explicitly
- never return raw strings only

---

## 10. Eligibility and Market Hours

## 10.1 File
`src/market/marketHours.js`

## 10.2 Stock rule
Stocks are only eligible during configured stock market session.

### v1 default
- regular US market hours only
- evaluate only on closed 15-minute candles

## 10.3 Crypto rule
Crypto must be eligible 24/7 when enabled.

## 10.4 Required helper contract

```js
isAssetEligibleNow({ assetClass, now, config }) => boolean
```

### Behavior
- stock: true only during configured stock session
- crypto: true always when enabled

## 10.5 Filtering requirement

Autopilot must filter each symbol individually, not skip the whole cycle just because stocks are closed.

### Correct outcome outside stock market hours
- stocks filtered out
- crypto remains eligible

### Example log
```text
Universe loaded {"total":11,"stocks":8,"crypto":3}
Universe filtered {"eligible":3,"stocksEligible":0,"cryptoEligible":3}
```

---

## 11. Symbol Normalization Specification

## 11.1 Why this is required

Crypto symbols may appear in different formats across systems:

- `BTC/USD`
- `BTCUSD`

Without normalization, duplicate-position checks and cooldown logic can fail.

## 11.2 File
`src/utils/normalizeSymbol.js`

## 11.3 Required helper

```js
export function normalizeSymbol(symbol) {
  return String(symbol).replace("/", "").toUpperCase();
}
```

## 11.4 Must be used in all of these places

- open position comparisons
- duplicate prevention
- cooldown checks
- order comparisons
- journal records
- trade state tracking
- exit logic
- risk state
- symbol map utilities where relevant

## 11.5 Storage rule

Journal records should store both:

- original symbol
- normalized symbol

Example:

```json
{
  "symbol": "BTC/USD",
  "normalizedSymbol": "BTCUSD"
}
```

---

## 12. Market Data Specification

## 12.1 File
`src/market/alpacaMarketData.js`

## 12.2 Responsibility
Fetch recent bars in a common shape for both stocks and crypto.

## 12.3 Input contract

```js
fetchBars({ symbol, assetClass, timeframe, limit })
```

## 12.4 Output contract

Return normalized bars like:

```js
[
  {
    "t": "2026-04-08T14:45:00Z",
    "o": 182.10,
    "h": 183.00,
    "l": 181.80,
    "c": 182.70,
    "v": 1200345
  }
]
```

This output shape must be identical regardless of asset class.

## 12.5 Asset-specific behavior

### Stocks
- use Alpaca stock bars endpoint
- obey stock eligibility/session logic

### Crypto
- use Alpaca crypto bars endpoint
- available 24/7

## 12.6 Minimum history
Fetch enough completed bars to support:
- ATR period
- breakout lookback
- average volume lookback
- extra validation buffer

### Recommended minimum
- 60 completed 15-minute bars

---

## 13. Bar Validation Specification

## 13.1 File
`src/market/alpacaMarketData.js` or separate validator module

## 13.2 Required validation
Reject evaluation if:

- bars are missing
- fewer than required limit
- timestamps are not ascending
- OHLC fields are invalid
- volume is missing/invalid
- latest bar is stale
- latest bar is incomplete
- bar spacing is inconsistent

## 13.3 Closed-candle rule
The strategy must operate on completed 15-minute candles only.

If latest returned bar may still be forming, the validator must either:
- reject it
- or explicitly use the previous completed bar

---

## 14. Strategy Specification

## 14.1 File
`src/strategies/breakoutStrategy.js`

## 14.2 Strategy
Use one built-in strategy for v1:

**Momentum Breakout + ATR Risk Strategy**

## 14.3 Inputs required

Per symbol:
- assetClass
- symbol
- bars
- account equity
- open positions
- config

## 14.4 Indicator inputs
The strategy depends on:
- ATR(14)
- highest high over 20 bars
- average volume over 20 bars
- latest close
- latest volume

## 14.5 Long entry rules

Approve a long only if:

1. latest close is above highest high of the prior breakout lookback window
2. current volume exceeds average volume threshold
3. ATR is valid
4. stop-loss distance is valid
5. risk sizing yields valid quantity
6. all risk guards pass

## 14.6 Stop-loss rule

```text
stopLoss = entryPrice - (1.5 × ATR)
```

## 14.7 Take-profit rule

```text
riskPerUnit = entryPrice - stopLoss
takeProfit = entryPrice + (2 × riskPerUnit)
```

## 14.8 Quantity rules

### Stocks
Use integer quantity:

```text
quantity = floor(riskAmount / riskPerUnit)
```

### Crypto
Use fractional quantity:

```text
quantity = roundDown(riskAmount / riskPerUnit, cryptoQtyPrecision)
```

## 14.9 Strategy output contract

Approved:

```json
{
  "approved": true,
  "symbol": "BTC/USD",
  "normalizedSymbol": "BTCUSD",
  "assetClass": "crypto",
  "timeframe": "15Min",
  "entryPrice": 68321.12,
  "stopLoss": 67110.44,
  "takeProfit": 70742.48,
  "atr": 807.12,
  "breakoutLevel": 68190.21,
  "volumeRatio": 1.42,
  "riskPerUnit": 1210.68,
  "quantity": 0.042315,
  "riskAmount": 51.23,
  "reason": "15m breakout confirmed by volume",
  "timestamp": "2026-04-08T14:45:00.000Z"
}
```

Rejected:

```json
{
  "approved": false,
  "symbol": "AAPL",
  "normalizedSymbol": "AAPL",
  "assetClass": "stock",
  "reason": "volume confirmation failed",
  "timestamp": "2026-04-08T14:45:00.000Z"
}
```

---

## 15. Indicator Modules

## 15.1 Directory
`src/indicators/`

## 15.2 Required modules
- `atr.js`
- `highestHigh.js`
- `averageVolume.js`
- optional `sma.js` if needed later

## 15.3 Contracts

### `atr.js`
Input: bars, period  
Output: numeric ATR

### `highestHigh.js`
Input: bars, lookback  
Output: numeric breakout level

### `averageVolume.js`
Input: bars, lookback  
Output: numeric average volume

All indicator modules must work for both stocks and crypto because both use the same normalized bar structure.

---

## 16. Risk Management Specification

## 16.1 File
`src/risk/guards.js`

## 16.2 Non-negotiable order rule

No order is allowed unless all of these exist and are valid:

- entryPrice
- stopLoss
- takeProfit
- quantity
- riskAmount
- assetClass
- symbol
- normalizedSymbol

If any are invalid:
- reject trade
- log reason

---

## 16.3 Required risk guards

### Daily loss lockout
If realized daily loss >= configured threshold:
- reject all new entries
- continue to log skip reason

### Max open positions
Reject new trade when open positions >= configured max.

### Duplicate position guard
Reject if normalized symbol already exists in open positions.

### Cooldown guard
Reject if symbol was recently exited and is still within cooldown period.

### Quantity guard
Reject if quantity <= 0.

### Missing-fields guard
Reject if strategy output is incomplete.

### Liquidity guard
Reject assets failing asset-specific liquidity thresholds.

### Run-mode guard
Reject order execution if not in paper mode unless explicitly supported later.

---

## 16.4 Liquidity checks

## Stocks
Reject if:
- price < configured floor
- average volume < threshold
- average dollar volume < threshold

## Crypto
Reject if:
- average dollar volume < crypto threshold
- bars insufficient
- liquidity too weak for reliable execution

## 16.5 File split
Recommended:
- `src/risk/guards.js`
- `src/risk/positionSizing.js`
- `src/risk/riskState.js`

---

## 17. Position Sizing Specification

## 17.1 File
`src/risk/positionSizing.js`

## 17.2 Responsibility
Compute quantity from:
- account equity
- configured risk percent
- stop-loss distance
- asset class

## 17.3 Contract

```js
sizePosition({
  assetClass,
  equity,
  riskPercent,
  entryPrice,
  stopLoss,
  cryptoQtyPrecision
})
```

## 17.4 Output

```js
{
  quantity,
  riskAmount,
  riskPerUnit
}
```

## 17.5 Rules
- reject invalid stop distance
- use integer share sizing for stocks
- use fractional precision-safe sizing for crypto
- floor, never round up

---

## 18. Execution Specification

## 18.1 Files
- `src/execution/orderManager.js`
- `src/execution/alpacaTrading.js`

## 18.2 Responsibility
Submit paper orders for approved trades.

## 18.3 Input contract

```js
placeApprovedTrade({
  decision,
  account,
  dryRun
})
```

## 18.4 Behavior
- validate paper mode
- confirm decision is approved
- confirm all execution guards passed
- build correct Alpaca payload by asset class
- submit order unless dry-run
- log response

## 18.5 Asset-specific execution

### Stocks
- integer qty
- stock order payload format

### Crypto
- fractional qty
- crypto order payload format
- time-in-force/value fields must match Alpaca crypto requirements used by the codebase

## 18.6 Dry-run behavior
Dry-run must:
- build payload
- log intended payload
- skip actual submit
- still write simulation journal

---

## 19. Position and Exit Management

## 19.1 Files
- `src/positions/positionMonitor.js`
- `src/execution/orderManager.js`

## 19.2 Responsibility
Track open positions and handle exits.

## 19.3 Required state
Store:
- symbol
- normalizedSymbol
- assetClass
- entry price
- quantity
- stop-loss
- take-profit
- openedAt
- status

## 19.4 Exit triggers
A position must be closable on:
- stop-loss hit
- take-profit hit
- manual close
- optional stale trade timeout

## 19.5 Matching rule
All open-position and exit comparisons must use `normalizedSymbol`.

---

## 20. Journaling Specification

## 20.1 Files
- `src/journal/tradeJournal.js`
- `src/journal/cycleLogger.js`

## 20.2 Journal requirements
Every decision must be recordable for both approved and rejected trades.

## 20.3 Required fields

```json
{
  "symbol": "ETH/USD",
  "normalizedSymbol": "ETHUSD",
  "assetClass": "crypto",
  "timeframe": "15Min",
  "signalTime": "2026-04-08T14:45:00.000Z",
  "entryPricePlanned": 3412.10,
  "entryPriceFilled": null,
  "stopLoss": 3359.84,
  "takeProfit": 3516.62,
  "quantity": 0.823145,
  "riskAmount": 43.02,
  "strategyName": "momentum_breakout_atr_v1",
  "approvalReason": "15m breakout confirmed by volume",
  "orderStatus": "dry-run",
  "exitPrice": null,
  "exitReason": null,
  "pnl": null
}
```

## 20.4 Cycle logs
Each cycle should log:
- total symbols
- stock count
- crypto count
- stock eligible count
- crypto eligible count
- approved count
- placed count
- skipped count
- error count

---

## 21. Worker Specification

## 21.1 File
`src/worker15m.js`

## 21.2 Responsibility
Run the autopilot cycle every 15 minutes.

## 21.3 Critical rule
The worker must not skip the whole cycle just because stocks are closed.

### Correct logic
- if crypto enabled, worker may still run outside stock hours
- if stocks closed and crypto disabled, cycle may skip
- if both disabled, worker should fail config validation

## 21.4 Timing rule
Trigger only after a 15-minute candle has closed.

### Example
- 09:45
- 10:00
- 10:15
- etc.

Use a shared helper to calculate the next valid boundary.

---

## 22. Logging Requirements

## 22.1 Log levels
- info
- warn
- error

## 22.2 Must-log events
- autopilot cycle starting
- account loaded
- open positions loaded
- universe loaded
- universe filtered
- bars fetched
- bars rejected
- strategy approved
- strategy rejected
- guard rejected
- dry-run payload built
- order submitted
- order rejected
- cycle complete

## 22.3 Example cycle logs

During stock hours:

```text
[INFO] Universe loaded {"total":11,"stocks":8,"crypto":3}
[INFO] Universe filtered {"eligible":11,"stocksEligible":8,"cryptoEligible":3}
```

Outside stock hours:

```text
[INFO] Universe loaded {"total":11,"stocks":8,"crypto":3}
[INFO] Universe filtered {"eligible":3,"stocksEligible":0,"cryptoEligible":3}
```

---

## 23. Autopilot Core Flow

## 23.1 File
`src/autopilot.js`

## 23.2 Required flow

```text
Start cycle
→ load env/config
→ validate configuration
→ fetch account
→ fetch open positions
→ normalize open-position symbols
→ build universe
→ log stock/crypto universe split
→ filter eligible assets by session rules
→ fetch bars per eligible asset
→ validate bars
→ compute indicators
→ run strategy
→ apply risk guards
→ sort approved candidates if needed
→ build order payloads
→ submit paper orders unless dry-run
→ write journal + logs
→ end cycle
```

## 23.3 Asset-awareness
Every stage must preserve:
- symbol
- normalizedSymbol
- assetClass

No stage should strip the asset class.

---

## 24. Required File-Level Changes

## 24.1 Add or update config
- `src/config/loadEnv.cjs`
- `src/config/runtimeConfig.js`
- `.env.example`

## 24.2 Add or update market layer
- `src/market/universe.js`
- `src/market/marketHours.js`
- `src/market/alpacaMarketData.js`

## 24.3 Add utility
- `src/utils/normalizeSymbol.js`

## 24.4 Add or update indicators
- `src/indicators/atr.js`
- `src/indicators/highestHigh.js`
- `src/indicators/averageVolume.js`

## 24.5 Add or update strategy
- `src/strategies/breakoutStrategy.js`

## 24.6 Add or update risk
- `src/risk/guards.js`
- `src/risk/positionSizing.js`
- `src/risk/riskState.js`

## 24.7 Add or update execution
- `src/execution/orderManager.js`
- `src/execution/alpacaTrading.js`

## 24.8 Add or update positions
- `src/positions/positionMonitor.js`

## 24.9 Add or update journaling
- `src/journal/tradeJournal.js`
- `src/journal/cycleLogger.js`

## 24.10 Add or update runtime entry points
- `src/autopilot.js`
- `src/worker15m.js`
- `src/simulateStrategy.js`

---

## 25. Testing Specification

## 25.1 Test stack
Use Jest for backend tests.

## 25.2 Required test files
- `test/utils/normalizeSymbol.test.js`
- `test/market/universe.test.js`
- `test/market/marketHours.test.js`
- `test/market/alpacaMarketData.crypto.test.js`
- `test/strategies/breakoutStrategy.stock.test.js`
- `test/strategies/breakoutStrategy.crypto.test.js`
- `test/risk/guards.test.js`
- `test/risk/positionSizing.crypto.test.js`
- `test/execution/orderManager.crypto.test.js`
- `test/integration/autopilot.dry.test.js`
- `test/integration/worker15m.crypto.test.js`

## 25.3 Required test cases

### Universe tests
- includes stocks by default
- includes crypto by default
- excludes asset only when explicitly disabled

### Market-hours tests
- stocks blocked outside session
- crypto allowed outside session
- mixed universe returns crypto eligible while stocks are filtered

### Symbol normalization tests
- `BTC/USD` normalizes to `BTCUSD`
- stock symbol remains unchanged except uppercasing

### Strategy tests
- valid stock breakout approves
- valid crypto breakout approves
- no breakout rejects
- bad volume rejects
- invalid ATR rejects

### Position sizing tests
- stock quantity is integer
- crypto quantity is fractional and floored
- invalid stop distance rejects

### Guard tests
- duplicate crypto position rejected after normalization
- daily loss lockout rejects
- max open positions rejects
- cooldown rejects

### Integration tests
- dry-run includes crypto outside stock hours
- dry-run includes both assets during stock hours
- autopilot does not place orders in dry-run
- worker can still process crypto overnight

---

## 26. Acceptance Criteria

The extension is complete only when all of the following are true:

1. a fresh install enables stocks and crypto by default
2. `npm run autopilot:dry` includes crypto outside stock hours
3. `npm run autopilot:dry` includes both stocks and crypto during stock hours
4. `npm run autopilot` can build valid paper-order payloads for both stocks and crypto
5. duplicate checks work for `BTC/USD` and `BTCUSD`
6. quantity handling is integer for stocks and fractional for crypto
7. cycle logs clearly show stock and crypto counts
8. worker mode runs overnight for crypto
9. tests pass
10. dry-run never submits orders

---

## 27. Rollout Plan

## Phase 1
Config + default enablement
- enable all assets by default
- update `.env.example`
- update runtime config

## Phase 2
Universe + eligibility
- include crypto in universe
- split stock/crypto eligibility correctly

## Phase 3
Symbol normalization
- add helper
- wire into guards, positions, journals

## Phase 4
Market data + validation
- fetch crypto bars
- normalize bar shape
- validate completed candles

## Phase 5
Strategy + sizing
- support crypto quantity precision
- preserve shared decision contract

## Phase 6
Execution + journaling
- build crypto payloads
- log and journal both asset classes

## Phase 7
Worker + overnight flow
- allow crypto processing outside stock hours
- fix whole-cycle skip behavior

## Phase 8
Tests + final verification
- complete test suite
- verify dry-run and worker behavior

---

## 28. Final Summary

This extension turns the current autopilot into a full multi-asset market-data engine.

The final implementation target is:

**A single Alpaca-powered autopilot trading app that scans stocks and crypto by default, evaluates real-time market-driven strategy conditions on closed 15-minute candles, applies strict risk controls, places paper trades automatically, and can run every 15 minutes with crypto active 24/7 and stocks active during configured market hours.**
