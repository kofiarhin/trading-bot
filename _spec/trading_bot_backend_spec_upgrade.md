# Trading Bot Backend Upgrade Spec

## Objective

Complete the next critical backend upgrades:

1. Add full decision metrics (ATR, volume ratio, distance)
2. Implement a durable open trades store
3. Enrich dashboard open positions using stored trade context

---

## Current State

### Working
- Decision pipeline (strategy → logger → API → UI)
- Close price and breakout level displayed
- Activity feed functional
- PnL tracking functional

### Missing
- ATR and Volume Ratio not displayed
- Open positions lack:
  - strategy
  - opened time
  - stop loss
  - take profit
  - risk

---

## Implementation Plan

---

# 1. Decision Metrics (Required)

## Goal
Ensure all decisions (approved and rejected) include structured metrics.

## Required Fields

```js
{
  closePrice,
  breakoutLevel,
  atr,
  volumeRatio,
  distanceToBreakoutPct
}
```

## Formula

```js
distanceToBreakoutPct =
  breakoutLevel
    ? ((closePrice - breakoutLevel) / breakoutLevel) * 100
    : null;
```

## Strategy Update

File:
```
src/strategies/breakoutStrategy.js
```

Update rejection:

```js
return reject("no breakout", {
  closePrice,
  breakoutLevel,
  atr: atr ?? null,
  volumeRatio: volumeRatio ?? null,
  distanceToBreakoutPct:
    breakoutLevel ? ((closePrice - breakoutLevel) / breakoutLevel) * 100 : null
});
```

## Expected Result

Recent Decisions table shows:
- Close
- Breakout Level
- ATR
- Volume Ratio

---

# 2. Open Trades Store (Required)

## Goal
Persist active trades across sessions.

## File Structure

```
storage/trades/open.json
```

## Module

Create:
```
src/journal/openTradesStore.js
```

## Functions

```js
getOpenTrades()
saveOpenTrade(trade)
removeOpenTrade(normalizedSymbol)
findOpenTrade(normalizedSymbol)
```

## Trade Schema

```js
{
  symbol,
  normalizedSymbol,
  assetClass,
  strategyName,
  openedAt,
  entryPrice,
  stopLoss,
  takeProfit,
  riskAmount,
  quantity,
  status: "open"
}
```

---

# 3. Save Trades on Execution

## File
```
src/execution/orderManager.js
```

## Behavior

After successful trade execution:

```js
saveOpenTrade({
  symbol,
  normalizedSymbol,
  assetClass,
  strategyName,
  entryPrice,
  stopLoss,
  takeProfit,
  riskAmount,
  quantity,
  openedAt: new Date().toISOString()
});
```

## Rule
Do NOT save during dry-run.

---

# 4. Dashboard Merge Update

## File
```
src/server/routes/dashboard.js
```

## Replace

```js
getTodayJournal()
```

## With

```js
getOpenTrades()
```

## Merge Logic

```js
const normalized = normalizeSymbol(position.symbol);

const trade = openTrades.find(
  (t) => t.normalizedSymbol === normalized
);
```

## Enrich Fields

```js
strategyName: trade?.strategyName ?? null,
openedAt: trade?.openedAt ?? null,
stopLoss: trade?.stopLoss ?? null,
takeProfit: trade?.takeProfit ?? null,
riskAmount: trade?.riskAmount ?? null,
```

---

# 5. Expected Outcome

## Recent Decisions
Shows:
- Close
- Breakout
- ATR
- Volume Ratio

## Open Positions
Shows:
- Strategy
- Opened
- Stop
- Target
- Risk

---

# 6. Implementation Order

1. Add metrics to strategy
2. Persist metrics in logger
3. Create openTradesStore
4. Save trades on execution
5. Update dashboard merge

---

# 7. Acceptance Criteria

- ATR and volume ratio appear in dashboard
- Decisions include structured metrics
- Open trades persist in storage
- Positions display full trade context
- System works across multiple cycles
- No breaking changes to existing features

---

# Final Result

System evolves from:

**Viewer**

to

**Trading System with State + Insight**
