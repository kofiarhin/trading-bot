# Backend Enhancement Spec — Decision Metrics + Open Trade Context

## 1. Objective

Implement backend upgrades to support:

1. Decision metrics on rejected decisions
2. Durable open-trade context for open positions

The goal is to enable the dashboard to explain:
- why trades are rejected
- how trades are structured
- what risk is active on positions

---

## 2. Problems

### 2.1 Missing Decision Metrics
Rejected decisions only store a reason string, not structured values like:
- close price
- breakout level
- ATR
- volume ratio

### 2.2 Missing Trade Context
Open positions only use today’s journal, causing missing:
- strategy
- stop loss
- take profit
- risk
- opened time

---

## 3. Desired State

### Decisions
Every decision (approved/rejected) must include:

- closePrice
- breakoutLevel
- atr
- volumeRatio
- distanceToBreakoutPct

### Open Positions
Every position should include:

- strategyName
- openedAt
- stopLoss
- takeProfit
- riskAmount

---

## 4. Implementation Part A — Decision Metrics

### Update Strategy (breakoutStrategy.js)

Replace:

```js
return { approved: false, symbol, reason, timestamp }
```

With:

```js
return {
  approved: false,
  symbol,
  reason,
  timestamp,
  closePrice,
  breakoutLevel,
  atr,
  volumeRatio,
  distanceToBreakoutPct
}
```

---

### Update decisionLogger.js

Persist all fields:

```js
{
  symbol,
  approved,
  decision,
  reason,
  timestamp,
  closePrice,
  breakoutLevel,
  atr,
  volumeRatio,
  distanceToBreakoutPct
}
```

---

### Update dashboard route

Return structured metrics directly:

```js
{
  symbol,
  decision,
  closePrice,
  breakoutLevel,
  atr,
  volumeRatio
}
```

---

## 5. Implementation Part B — Open Trade Store

### New File
```
storage/trades/open.json
```

### Schema

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

### New Module
`src/journal/openTradesStore.js`

Functions:
- getOpenTrades()
- saveOpenTrade()
- removeOpenTrade()
- findOpenTrade()

---

### Order Manager Update

On successful trade:

```js
saveOpenTrade({
  symbol,
  entryPrice,
  stopLoss,
  takeProfit,
  riskAmount,
  quantity,
  openedAt
})
```

---

### Dashboard Positions Merge

Merge:
- Alpaca positions
- openTradesStore

Priority:
- Alpaca → live price + qty
- Store → strategy + stop + target + risk

---

## 6. Acceptance Criteria

### Decision Metrics
- dashboard shows close, breakout, ATR, volume ratio
- rejected decisions include structured metrics

### Open Trades
- open trades stored persistently
- positions enriched with strategy + stop + risk
- works across days

---

## 7. Implementation Order

1. Add metrics to decisions
2. Persist metrics in logger
3. Build openTradesStore
4. Save trades on execution
5. Merge in dashboard

---

## 8. Final Outcome

Dashboard will now explain:

- why a trade was rejected
- how a trade is structured
- what risk is active

Turning the system into a true trading control panel.
