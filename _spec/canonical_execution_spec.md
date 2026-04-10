# SPEC: Canonical Decision Contract + Single Execution Path Stabilization

## OBJECTIVE

Stabilize the trading bot by fixing the data contract at the source and removing the last live architectural split in execution.

This implementation pass must:

1. Make `buildDecision()` emit the canonical trade contract directly
2. Keep `orderManager.js` as the single canonical execution module
3. Convert `src/execution/placeOrder.js` into a compatibility wrapper only
4. Add validation guards to prevent invalid entry data from reaching storage or broker logic
5. Preserve backward compatibility when reading old journal records
6. Avoid breaking the current dry-run behavior, dashboard routes, and autopilot flow

This is a stabilization pass, not a full system rewrite.

---

## PRIMARY PROBLEM

The current codebase still relies on downstream normalization because `buildDecision()` emits legacy field names such as:

- `strategy`
- `stop`
- `target`
- `risk`
- `qty`

This means the app currently works like this:

```
autopilot -> legacy decision shape -> normalize later -> persist -> normalize again -> display
```

That is fragile.

The target state is:

```
autopilot -> canonical decision shape -> execute -> persist -> display
```

---

## IMPLEMENTATION GOALS

After this work:

- the decision object created in `src/autopilot.js` must already be canonical
- `orderManager.js` must remain the only real execution implementation
- `placeOrder.js` must no longer contain a separate execution flow
- invalid stop loss / take profit / quantity / entry price values must be rejected before order execution or storage writes
- old records on disk may still be read safely through normalization, but all newly created data must be canonical

---

## 1) CANONICAL DECISION CONTRACT

### FILE
- `src/autopilot.js`

### REQUIREMENT

Update `buildDecision()` so it returns the canonical shape directly.

### CANONICAL DECISION SHAPE

```js
{
  approved: boolean,
  reason: string,

  symbol: string,
  normalizedSymbol: string,
  assetClass: "crypto" | "stock",

  strategyName: string,

  entryPrice: number,
  stopLoss: number,
  takeProfit: number,
  quantity: number,
  riskAmount: number,

  metrics: {
    closePrice: number,
    breakoutLevel: number,
    atr: number,
    volumeRatio: number,
    distanceToBreakoutPct: number
  }
}
```

### REQUIRED CHANGE

Replace legacy fields with canonical equivalents.

---

## 2) SINGLE EXECUTION PATH

### FILES
- `src/execution/orderManager.js`
- `src/execution/placeOrder.js`
- `src/autopilot.js`

### REQUIREMENT

`orderManager.js` must be the only execution implementation.

Convert `placeOrder.js` into a wrapper:

```js
import { placeOrder } from './orderManager.js';

export default async function legacyPlaceOrder(...args) {
  return placeOrder(...args);
}

export { placeOrder };
```

---

## 3) VALIDATION AT ENTRY BOUNDARY

### FILE
- `src/execution/orderManager.js`

### RULES

Reject invalid values:

- entryPrice > 0
- stopLoss > 0
- takeProfit > 0
- quantity > 0
- stopLoss < entryPrice
- takeProfit > entryPrice

Throw errors if invalid.

---

## 4) CANONICAL WRITE CONTRACT

All new trades must use:

```js
{
  tradeId,
  symbol,
  normalizedSymbol,
  assetClass,
  strategyName,
  entryPrice,
  stopLoss,
  takeProfit,
  quantity,
  riskAmount,
  status,
  openedAt,
  closedAt,
  exitPrice,
  pnl,
  pnlPct,
  exitReason,
  metrics
}
```

Do NOT write legacy fields.

---

## 5) BACKWARD COMPATIBILITY

Support legacy fields when reading:

- id -> tradeId
- stop -> stopLoss
- target -> takeProfit
- qty -> quantity
- risk -> riskAmount
- strategy -> strategyName

---

## 6) CLOSE TRADE CONTRACT

Use canonical fields.

Compute:

```js
const pnl = (exitPrice - entryPrice) * quantity;
const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
```

---

## 7) DRY RUN

In dry-run mode:

- do NOT call broker
- do NOT mutate storage
- ONLY log actions

---

## 8) DASHBOARD COMPATIBILITY

Do not break existing frontend behavior.

---

## 9) TESTING

Use Jest.

Test:

- canonical decision output
- canonical trade writes
- legacy read compatibility
- exit behavior
- validation failures
- dry-run safety

---

## 10) SUCCESS CRITERIA

- canonical decision flow
- single execution path
- no legacy writes
- safe dry-run
- tests passing

---

## 11) VALIDATION COMMANDS

```bash
npm run autopilot:dry
npm test
```
