# Forced First Trade Debug Specification

## Purpose

This spec defines a controlled mechanism to force a single trade in paper trading mode to validate the full trading pipeline:

Market Data → Strategy → Decision → Execution → Persistence → Dashboard → Exit Monitoring

This is strictly for debugging and must never be enabled in live trading.

---

## Environment Configuration

Add the following to your `.env`:

```
FORCE_FIRST_TRADE=true
FORCE_FIRST_TRADE_SYMBOL=BTC/USD
FORCE_FIRST_TRADE_QTY=0.001
```

---

## Constraints

- Only applies in paper trading mode
- Only one symbol is allowed
- Only one active forced trade at a time
- Risk guards must remain active
- Must persist full trade data
- Must auto-disable after first execution

---

## Strategy Override Layer

### Function: maybeForceTrade

```
export function maybeForceTrade({ symbol, assetClass, latestPrice }) {
  const enabled = process.env.FORCE_FIRST_TRADE === "true";
  const forcedSymbol = process.env.FORCE_FIRST_TRADE_SYMBOL;

  if (!enabled) return null;
  if (symbol !== forcedSymbol) return null;

  return {
    approved: true,
    reason: "forced first paper trade",
    metrics: {
      close: latestPrice,
      breakoutLevel: latestPrice,
      atr: 0,
      volumeRatio: 1,
      distancePct: 0,
    },
    strategyName: "forced-debug-entry",
    isForced: true,
  };
}
```

### Integration Point

In decision engine:

```
const forcedDecision = maybeForceTrade({
  symbol,
  assetClass,
  latestPrice: close,
});

if (forcedDecision) return forcedDecision;
```

---

## Risk Guards

Do NOT bypass:

- max open positions
- duplicate trade prevention
- account validation
- position sizing checks

---

## Trade Execution

Use forced quantity from `.env`.

### Open Trade Object

```
const openTrade = {
  symbol,
  normalizedSymbol: symbol.replace("/", ""),
  assetClass,
  strategyName: decision.strategyName || "forced-debug-entry",
  openedAt: new Date().toISOString(),
  entryPrice: filledAvgPrice,
  stopLoss: Number((filledAvgPrice * 0.99).toFixed(2)),
  takeProfit: Number((filledAvgPrice * 1.02).toFixed(2)),
  riskAmount: Number((filledAvgPrice * 0.01 * quantity).toFixed(2)),
  quantity,
  status: "open",
};
```

Persist to:

```
storage/trades/open.json
```

---

## Exit Logic (Next Cycles)

- If price <= stopLoss → exit trade
- If price >= takeProfit → exit trade

---

## Activity Feed Logging

```
Cycle started
BTC/USD approved: forced first paper trade
BTC/USD entry placed
BTC/USD saved to openTradesStore
Cycle complete
```

---

## Auto-Disable Logic

Prevent duplicate forced trades:

```
if (decision.isForced && existingOpenTradeForSymbol) {
  return {
    approved: false,
    reason: "forced trade already active",
    metrics: {
      close,
      breakoutLevel: close,
      atr: 0,
      volumeRatio: 1,
      distancePct: 0,
    },
  };
}
```

---

## Success Criteria

After one cycle:

- One approved decision
- One Alpaca paper position
- One stored open trade
- Dashboard populated with:
  - strategy
  - stop
  - target
  - risk
  - openedAt

---

## Safety Rules

- Never enable in live trading
- Always use minimal quantity
- Remove or disable after test

---

## Next Step

Once validated:

- Remove forced override
- Re-enable real strategy conditions
- Proceed to full autonomous operation
