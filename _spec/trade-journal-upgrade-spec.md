# Trade Journal Upgrade Spec
## Stop, Target, Risk Fully Integrated

## Objective

Build a full trade journal layer that becomes the internal source of truth for trade context, so the dashboard can show:

- strategy
- openedAt
- entry
- stop
- target
- risk
- quantity
- status
- realized PnL
- unrealized PnL enrichment
- trade lifecycle history

The broker remains the source of truth for live position existence and mark-to-market values.  
The internal trade journal becomes the source of truth for trade intent and management metadata.

---

## Why This Upgrade Matters

Right now the dashboard can show open positions from the broker, but broker positions alone do not fully describe the trade.

Broker data usually gives:
- symbol
- qty
- avg entry price
- current price
- unrealized pnl

Broker data does **not** reliably preserve your internal trade plan:
- strategy used
- stop loss
- take profit
- initial risk
- reason for entry
- opened timestamp from your system
- exit reason
- lifecycle notes

Without a trade journal, the dashboard is only a portfolio viewer.

With a trade journal, the dashboard becomes a real trade management system.

---

## Product Goal

Create a persistent journal system that tracks each trade from:

1. signal approval
2. order placement
3. fill confirmation
4. open position monitoring
5. stop or target exit
6. closure and archival

---

## High-Level Rules

1. Broker is source of truth for whether a position currently exists.
2. Journal is source of truth for stop, target, risk, strategy, timestamps, and lifecycle metadata.
3. Open positions API must merge broker position data with journal trade data.
4. Closed trades must be written to journal history with realized pnl and exit reason.
5. Journal writes must be persistent and crash-safe.
6. No dashboard field for stop/target/risk should depend on broker-only data.
7. Existing routes should be extended, not broken.
8. Keep backward compatibility where possible.

---

## Scope

This upgrade includes:

- persistent open trade store
- persistent closed trade history
- lifecycle event logging
- broker-to-journal merge logic
- open positions dashboard enrichment
- exit engine journal updates
- route support for journal-backed trade context
- validation and edge-case handling
- tests

This upgrade does **not** require:
- changing the core strategy logic
- changing risk rules themselves
- changing entry criteria
- adding new indicators

---

## Data Model Design

## Directory Structure

Recommended storage layout:

```txt
storage/
  trades/
    open.json
    closed.json
    events.json
```

Alternative acceptable layout if your repo already has a journal folder:

```txt
storage/
  journal/
    openTrades.json
    closedTrades.json
    tradeEvents.json
```

Use existing repo conventions if already established. Do not create a competing parallel structure.

---

## Open Trade Record Schema

Each open trade record must contain:

```json
{
  "tradeId": "uuid-or-stable-id",
  "symbol": "BTC/USD",
  "asset": "crypto",
  "side": "long",
  "strategy": "breakout",
  "status": "open",
  "decisionTimestamp": "2026-04-09T22:27:36.000Z",
  "openedAt": "2026-04-09T22:27:41.000Z",
  "entryReason": "breakout confirmed",
  "entry": 71968.27,
  "qty": 0.05,
  "stop": 71500.00,
  "target": 73000.00,
  "riskPerUnit": 468.27,
  "plannedRiskAmount": 23.41,
  "brokerOrderId": "alpaca-order-id",
  "brokerPositionId": null,
  "timeframe": "15m",
  "metrics": {
    "close": 71968.27,
    "breakoutLevel": 71968.27,
    "atr": 233.67,
    "volumeRatio": 1.67,
    "distanceToBreakoutPct": 0
  },
  "notes": [],
  "createdAt": "2026-04-09T22:27:41.000Z",
  "updatedAt": "2026-04-09T22:27:41.000Z"
}
```

### Required fields

- tradeId
- symbol
- asset
- side
- strategy
- status
- openedAt
- entry
- qty
- stop
- target
- plannedRiskAmount
- createdAt
- updatedAt

### Status values

Allowed values:

- pending
- open
- closed
- canceled
- orphaned

Definitions:
- `pending`: order submitted but not fully confirmed as open
- `open`: broker position exists and journal trade is active
- `closed`: trade exited and moved to closed history
- `canceled`: order never became a position
- `orphaned`: broker position exists but journal enrichment missing or mismatched

---

## Closed Trade Record Schema

```json
{
  "tradeId": "uuid-or-stable-id",
  "symbol": "BTC/USD",
  "asset": "crypto",
  "side": "long",
  "strategy": "breakout",
  "status": "closed",
  "decisionTimestamp": "2026-04-09T22:27:36.000Z",
  "openedAt": "2026-04-09T22:27:41.000Z",
  "closedAt": "2026-04-10T01:15:00.000Z",
  "entryReason": "breakout confirmed",
  "exitReason": "target_hit",
  "entry": 71968.27,
  "exit": 73000.00,
  "qty": 0.05,
  "stop": 71500.00,
  "target": 73000.00,
  "riskPerUnit": 468.27,
  "plannedRiskAmount": 23.41,
  "realizedPnl": 51.59,
  "realizedPnlPct": 1.43,
  "brokerOrderId": "alpaca-order-id",
  "brokerExitOrderId": "alpaca-exit-order-id",
  "timeframe": "15m",
  "metrics": {
    "close": 71968.27,
    "breakoutLevel": 71968.27,
    "atr": 233.67,
    "volumeRatio": 1.67,
    "distanceToBreakoutPct": 0
  },
  "notes": [],
  "createdAt": "2026-04-09T22:27:41.000Z",
  "updatedAt": "2026-04-10T01:15:00.000Z"
}
```

### Allowed exitReason values

- stop_hit
- target_hit
- manual_close
- risk_rule_close
- broker_sync_close
- canceled
- unknown

---

## Trade Event Schema

This is optional but strongly recommended.

```json
{
  "eventId": "uuid",
  "tradeId": "uuid-or-stable-id",
  "symbol": "BTC/USD",
  "type": "trade_opened",
  "message": "Trade opened for BTC/USD breakout",
  "timestamp": "2026-04-09T22:27:41.000Z",
  "data": {
    "entry": 71968.27,
    "stop": 71500,
    "target": 73000,
    "qty": 0.05
  }
}
```

### Event types

- decision_approved
- order_submitted
- order_filled
- trade_opened
- stop_updated
- target_updated
- trade_closed
- stop_hit
- target_hit
- sync_warning
- orphan_detected

---

## Stable ID Strategy

Each trade must have a stable `tradeId`.

Recommended:
- use `crypto.randomUUID()` or equivalent UUID generation

Do **not** rely on:
- array index
- symbol alone
- timestamp alone
- broker order id alone

Reason:
multiple trades can exist for the same symbol over time.

---

## Storage Layer Requirements

## File Responsibilities

### `open.json`
Contains only active trade records:
- pending
- open
- orphaned

### `closed.json`
Contains closed and archived trades.

### `events.json`
Contains lifecycle events for debugging and timeline visualization.

---

## Persistence Rules

1. If storage file does not exist, initialize it with `[]`.
2. Every write must preserve valid JSON.
3. Writes should be atomic where practical.
4. Avoid partial writes on crash.
5. Use helper utilities for:
   - readJsonArray(filePath)
   - writeJsonArray(filePath, data)
   - appendJsonRecord(filePath, record)
6. Validate structure before writing.
7. Never silently swallow write errors.

---

## Recommended Utility Layer

Create or extend a utility module such as:

```txt
server/utils/tradeJournal.js
```

Suggested exported functions:

- `getOpenTrades()`
- `getClosedTrades()`
- `getTradeEvents()`
- `createPendingTrade(tradeInput)`
- `markTradeOpen(tradeId, fillData)`
- `markTradeClosed(tradeId, closeData)`
- `findOpenTradeBySymbol(symbol)`
- `findOpenTradeByTradeId(tradeId)`
- `appendTradeEvent(event)`
- `syncBrokerPositionsToJournal(brokerPositions)`
- `upsertOpenTrade(tradeRecord)`
- `removeOpenTrade(tradeId)`

---

## Entry Engine Integration

## Objective

When a trade is approved and an order is placed, journal metadata must be captured immediately.

## File
Likely one of:
- `server/services/executionEngine.js`
- `server/engines/entryEngine.js`
- equivalent trade placement file

## Required Flow

### When decision is approved, before order placement:
Build a complete trade plan object:

```js
{
  symbol,
  asset,
  side: "long",
  strategy: "breakout",
  entry,
  stop,
  target,
  qty,
  plannedRiskAmount,
  riskPerUnit,
  timeframe,
  metrics,
  decisionTimestamp
}
```

### After broker order is submitted successfully:
Create a `pending` trade record in `open.json`.

### After order fill is confirmed:
Transition the same record from:
- `pending` → `open`

Set:
- openedAt
- brokerOrderId
- entry
- qty
- updatedAt

### If order submission fails:
Do not create an open trade record.
Optionally write an event record indicating failure.

### If order is canceled:
Mark trade as `canceled` and remove from open trade display.

---

## Stop / Target / Risk Calculation Integration

The journal record must include:

- `entry`
- `stop`
- `target`
- `riskPerUnit`
- `plannedRiskAmount`

### Definitions

```txt
riskPerUnit = abs(entry - stop)
plannedRiskAmount = riskPerUnit * qty
```

For long trades:
- stop < entry
- target > entry

Add validation:
- reject trade journal creation if stop is missing
- reject trade journal creation if target is missing
- reject trade journal creation if qty <= 0
- reject trade journal creation if plannedRiskAmount <= 0

---

## Dashboard Open Positions Enrichment

## Objective

The dashboard open positions endpoint must merge broker live positions with journal metadata.

## File
Likely:
- `server/routes/dashboard.js`

## Current Problem

Broker positions alone do not include:
- strategy
- stop
- target
- risk
- openedAt
- entryReason

## Required Behavior

For each broker open position:
1. Match to journal trade using the best available key.
2. Merge broker live values with journal values.
3. Return a normalized open position record to frontend.

### Preferred matching strategy

Priority:
1. `brokerOrderId`
2. `tradeId` if already linked
3. symbol + status=open
4. latest open journal record for same symbol if only one exists

If multiple open journal trades exist for same symbol and matching is ambiguous:
- mark record as `orphaned`
- do not guess blindly
- include warning metadata

---

## Open Positions API Response Shape

Each row returned to the dashboard should contain:

```json
{
  "tradeId": "uuid",
  "symbol": "BTC/USD",
  "asset": "crypto",
  "side": "long",
  "strategy": "breakout",
  "openedAt": "2026-04-09T22:27:41.000Z",
  "qty": 0.05,
  "entry": 71968.27,
  "current": 72450.18,
  "stop": 71500.00,
  "target": 73000.00,
  "risk": 23.41,
  "riskPerUnit": 468.27,
  "entryReason": "breakout confirmed",
  "status": "open",
  "unrealizedPnl": 24.10,
  "unrealizedPnlPct": 0.67,
  "brokerMarketValue": 3622.51,
  "orphaned": false
}
```

### Dashboard rules

- `strategy` must come from journal
- `openedAt` must come from journal
- `stop` must come from journal
- `target` must come from journal
- `risk` must come from journal
- `current` and unrealized pnl should come from broker when available

If journal enrichment is missing:
- return `orphaned: true`
- keep the row visible
- do not crash
- set missing fields to `null`

---

## Exit Engine Integration

## Objective

When the position exit engine closes a trade, the journal must reflect the closure.

## File
Likely:
- `server/engines/exitEngine.js`
- `server/services/positionMonitor.js`
- equivalent monitoring file

## Required Flow

### During each cycle
For each open journal-backed trade:
1. read latest price
2. compare with stop and target
3. if stop hit:
   - submit close order
   - mark journal trade closed with `exitReason=stop_hit`
4. if target hit:
   - submit close order
   - mark journal trade closed with `exitReason=target_hit`

### When trade closes
Move the record from:
- `open.json`
to
- `closed.json`

Populate:
- closedAt
- exit
- realizedPnl
- realizedPnlPct
- exitReason
- brokerExitOrderId
- updatedAt

Append event:
- `trade_closed`
- and optionally `stop_hit` or `target_hit`

---

## Realized PnL Formula

For long trades:

```txt
realizedPnl = (exit - entry) * qty
realizedPnlPct = ((exit - entry) / entry) * 100
```

Use safe rounding for display, but preserve raw numeric values in storage where practical.

---

## Broker Sync / Reconciliation Layer

## Objective

Handle situations where broker and journal state drift apart.

### Scenarios

#### 1. Broker position exists but no journal record exists
Mark as `orphaned`.

Behavior:
- dashboard still shows position
- enrichment fields are null
- append sync warning event
- do not auto-delete position
- do not auto-invent stop/target

#### 2. Journal says trade is open but broker has no position
Possible causes:
- manual close
- broker-side cancellation
- sync issue
- failed previous write

Behavior:
- mark journal trade as closed with `exitReason=broker_sync_close`
- closedAt = now
- exit may be null if broker exit price unavailable
- append sync event

#### 3. Multiple journal open trades match one broker position
Behavior:
- keep broker row visible
- set `orphaned: true`
- append warning event
- do not merge randomly

---

## Activity Feed Integration

Extend activity feed so it can include trade journal events like:

- Trade opened — BTC/USD breakout, entry 71968.27, stop 71500, target 73000
- Trade closed — BTC/USD target hit, realized +51.59
- Trade orphaned — ETH/USD missing journal metadata

This can be driven from `events.json` or merged from closed/open trade changes.

---

## New Optional Routes

These are recommended but not strictly required.

### `GET /api/trades/open`
Return raw open journal trades.

### `GET /api/trades/closed`
Return closed trade history.

### `GET /api/trades/events`
Return recent trade lifecycle events.

### `GET /api/trades/:tradeId`
Return a single trade with full lifecycle context.

If existing repo patterns differ, follow repo conventions.

---

## Frontend Requirements

## Open Positions Table

Ensure these fields are populated from merged API:
- Strategy
- Opened
- Stop
- Target
- Risk

If `orphaned`:
- show warning badge
- keep row visible
- show missing values as `—`

### Example row behavior

#### Normal enriched row
- Strategy: breakout
- Opened: 10:27 PM
- Stop: 71,500.00
- Target: 73,000.00
- Risk: $23.41

#### Orphaned row
- Strategy: —
- Opened: —
- Stop: —
- Target: —
- Risk: —
- Badge: Orphaned

---

## Closed Trades View (Recommended)

Add a dashboard section or route later for:
- symbol
- strategy
- openedAt
- closedAt
- entry
- exit
- qty
- realized pnl
- exit reason

Not required for phase 1 if backend completes journal support first.

---

## Validation Requirements

Validate before writing any open trade record:

- symbol exists and is string
- asset exists
- side is allowed enum
- strategy exists
- entry is finite number > 0
- qty is finite number > 0
- stop is finite number > 0
- target is finite number > 0
- plannedRiskAmount is finite number > 0
- openedAt or decisionTimestamp exists
- tradeId exists

For long positions:
- stop < entry
- target > entry

Reject invalid records with explicit error messages.

---

## Error Handling Rules

- No silent failures
- Storage read/write errors must be logged
- API should return safe fallback data instead of crashing dashboard
- Reconciliation mismatches should create warnings, not app crashes
- Journal update failures during exit handling must be surfaced in logs and cycle summary

---

## Logging Requirements

Log major lifecycle actions:

- trade pending created
- trade opened
- trade closed
- trade moved to closed history
- orphan detected
- broker sync closure
- journal write failure

Do not log secrets or sensitive env values.

---

## Backward Compatibility Requirements

- Existing dashboard route must continue to work
- Existing open positions table must not break if some fields are absent
- Existing journal/decision history must remain readable
- Migration should tolerate older open trade records with missing fields

Use safe optional access and defaults.

---

## Migration / Bootstrapping

If existing open positions already exist in broker but journal is empty:

1. Do not fabricate trade plan fields.
2. Show these positions as orphaned.
3. Allow future trades to be fully journal-backed.
4. Optionally support a manual backfill path later, but do not require it for this phase.

---

## Testing Requirements

## Backend Unit Tests

Add tests for trade journal utility functions:

- initializes missing files as empty arrays
- creates pending trade
- marks trade open
- marks trade closed
- moves trade from open to closed
- appends trade events
- rejects invalid trade record
- reconciles missing broker position
- handles orphaned broker position

## Backend Integration Tests

Test routes and engine flows:

- approved decision + successful order creates open journal record
- stop hit closes trade and archives it
- target hit closes trade and archives it
- open positions API returns merged journal + broker fields
- orphaned positions return safe fallback structure
- closed trade history returns realized pnl and exit reason

Use Jest for backend tests.

---

## Suggested Implementation Order

### Phase 1 — Storage Foundation
- build journal utility
- initialize files
- add schemas / validation

### Phase 2 — Entry Integration
- write pending/open trades during order flow
- append events

### Phase 3 — Dashboard Enrichment
- merge broker positions with journal records
- populate strategy/opened/stop/target/risk

### Phase 4 — Exit Integration
- archive closed trades
- realized pnl
- exit reason

### Phase 5 — Reconciliation
- orphan detection
- broker sync closure handling

### Phase 6 — Tests + Cleanup
- unit tests
- integration tests
- safe logging and edge cases

---

## Non-Goals

Do not:
- redesign the entire dashboard UI
- add advanced analytics
- add multiple strategy execution changes
- introduce database persistence unless explicitly requested
- change the trading cadence
- modify approval criteria

This is a journal integration upgrade, not a strategy rewrite.

---

## Success Criteria

Implementation is successful when:

1. Every new trade opened by the bot creates a persistent journal record.
2. Open positions dashboard shows:
   - strategy
   - openedAt
   - stop
   - target
   - risk
3. Closed trades are archived with:
   - exitReason
   - closedAt
   - realizedPnl
4. Broker-only positions remain visible and are flagged as orphaned.
5. Exit engine updates journal automatically.
6. App survives restarts without losing trade management context.
7. All core journal flows are covered by tests.

---

## Expected User Outcome

After this upgrade, the system will move from:

> seeing positions

to:

> managing trades with full intent, risk, and lifecycle visibility

That is the required milestone before deeper automation or advanced analytics.

---

## Implementation Notes for Claude

- Follow existing repo conventions first.
- Extend existing files where appropriate instead of creating duplicate patterns.
- Keep code modular.
- Keep API logic out of UI components.
- Use safe file IO helpers.
- Use explicit validation.
- Add Jest tests for backend behavior.
- Preserve backward compatibility.
- Prefer small utility modules over giant route files.
- Do not hard-code paths if config utilities already exist.
