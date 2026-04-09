# Entry → Entry + Exit Upgrade Spec

## 1. Objective

Upgrade the current repo from an **entry-only autopilot trading system** to a **full entry + exit trading system**.

After this implementation, the bot must be able to:

- open trades when strategy conditions are met
- persist full open-trade context
- monitor active positions every cycle
- automatically close positions when:
  - stop loss is hit
  - take profit is hit
- move closed trades into history
- update dashboard state for:
  - open positions
  - closed trades
  - realized pnl
  - exit reason

---

## 2. Current State

### What already exists
- market scan engine
- strategy engine
- decision logging
- dashboard
- paper entry execution
- partial trade context work
- open positions visible from Alpaca

### What is missing
- active position monitoring
- automatic stop-loss execution
- automatic take-profit execution
- closed-trade persistence
- removal of closed trades from open state
- realized pnl tracking from internal trade records

---

## 3. Target End State

The repo should support a full trade lifecycle:

```
Scan market
→ approve trade
→ place entry
→ persist open trade
→ monitor open trade every cycle
→ close trade on stop or target
→ archive closed trade
→ update dashboard + pnl
```

---

## 4. Core Product Behavior

### In `autopilot:dry`
- simulate exit checks
- log exit triggers
- no real orders or state mutation

### In `autopilot`
- check exits
- close positions if needed
- place new trades
- persist state

### In `worker:15m`
- repeat full cycle every 15 minutes

---

## 5. Required Architectural Change

### New cycle order
```
load state
→ monitor exits
→ close trades
→ scan market
→ place entries
→ persist state
```

---

## 6. Data Models

### Open Trades (`storage/trades/open.json`)
```json
{
  "symbol": "",
  "normalizedSymbol": "",
  "assetClass": "",
  "strategyName": "",
  "openedAt": "",
  "entryPrice": null,
  "stopLoss": null,
  "takeProfit": null,
  "riskAmount": null,
  "quantity": null,
  "status": "open"
}
```

### Closed Trades (`storage/trades/closed.json`)
```json
{
  "symbol": "",
  "normalizedSymbol": "",
  "assetClass": "",
  "strategyName": "",
  "openedAt": "",
  "closedAt": "",
  "entryPrice": null,
  "exitPrice": null,
  "pnl": null,
  "pnlPct": null,
  "exitReason": ""
}
```

---

## 7. New Modules

### openTradesStore.js
- getOpenTrades
- saveOpenTrade
- removeOpenTrade

### closedTradesStore.js
- getClosedTrades
- appendClosedTrade

### positionMonitor.js
- checkOpenTradesForExit

---

## 8. Exit Logic

### Stop Loss
```
if price <= stopLoss → exit
```

### Take Profit
```
if price >= takeProfit → exit
```

---

## 9. Execution Updates

### closeTrade()
- place sell order
- return result

---

## 10. Trade Archival

```
pnl = (exitPrice - entryPrice) * quantity
```

---

## 11. Autopilot Integration

```
Start
→ monitor exits
→ execute exits
→ scan entries
→ execute entries
→ save state
→ End
```

---

## 12. Dashboard Updates

### Open positions
- merge Alpaca + openTradesStore

### Closed trades endpoint
```
GET /api/dashboard/positions/closed
```

---

## 13. Activity Feed

Add:
- stop loss hit
- take profit hit
- trade closed

---

## 14. Acceptance Criteria

- exits trigger correctly
- trades removed from open store
- trades added to closed store
- dashboard reflects updates
- dry-run does not mutate state

---

## 15. Implementation Order

1. openTradesStore
2. closedTradesStore
3. closeTrade()
4. positionMonitor
5. autopilot integration
6. dashboard updates

---

## 16. Final Outcome

System evolves from:

**Entry-only**

to:

**Entry + Exit (Full Lifecycle Trading System)**
