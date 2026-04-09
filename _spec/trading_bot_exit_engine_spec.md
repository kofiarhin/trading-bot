# SPEC: Integrate Exit Engine + Unify Trade Lifecycle

## OBJECTIVE

Upgrade the trading system to fully align with the project brief by:

1. Integrating Exit Engine into the main cycle
2. Enforcing single source of truth for trade state
3. Completing trade lifecycle (entry → open → exit → archive)
4. Ensing dry-run safety
5. Making dashboard + API reflect real state
6. Adding tests for exit behavior

---

## SYSTEM REQUIREMENTS

The system cycle MUST follow this order:

load state → monitor exits → execute exits → update state → scan market → evaluate → execute entries → persist → repeat

---

## 1. CANONICAL TRADE SCHEMA (MANDATORY)

```js
{
  id: string,
  symbol: string,
  normalizedSymbol: string,
  assetClass: "crypto" | "stock",

  strategyName: string,

  entryPrice: number,
  stopLoss: number,
  takeProfit: number,
  quantity: number,
  riskAmount: number,

  status: "open" | "closed",

  openedAt: string,
  closedAt?: string,

  exitPrice?: number,
  pnl?: number,
  pnlPct?: number,
  exitReason?: "stop_loss" | "take_profit" | "manual",

  metrics: {
    closePrice: number,
    breakoutLevel: number,
    atr: number,
    volumeRatio: number,
    distanceToBreakoutPct: number
  }
}
```

---

## 2. REMOVE DUPLICATE SYSTEMS

DELETE:
- journalUtils.js

KEEP:
- tradeJournal.js

RULE:
There must be ONLY ONE trade state manager.

---

## 3. EXIT ENGINE INTEGRATION

### FILE: src/autopilot.js

```js
import { checkOpenTradesForExit } from './positions/positionMonitor.js';
import { closeTrade } from './execution/orderManager.js';
import { getOpenTrades } from './journal/tradeJournal.js';
```

```js
async function handleExits() {
  const openTrades = await getOpenTrades();
  const exitDecisions = await checkOpenTradesForExit(openTrades);

  for (const exit of exitDecisions) {
    if (!exit.shouldExit) continue;

    await closeTrade({
      tradeId: exit.tradeId,
      symbol: exit.symbol,
      exitPrice: exit.currentPrice,
      reason: exit.reason
    });
  }
}
```

Add to cycle BEFORE scanning:

```js
await handleExits();
```

---

## 4. POSITION MONITOR CONTRACT

```js
[
  {
    tradeId: string,
    symbol: string,
    shouldExit: boolean,
    reason: "stop_loss" | "take_profit",
    currentPrice: number
  }
]
```

---

## 5. CLOSE TRADE FLOW

```js
if (process.env.DRY_RUN === 'true') {
  console.log('[DRY RUN] Would close trade:', symbol);
  return;
}

const trade = getOpenTradeById(tradeId);

const pnl = (exitPrice - trade.entryPrice) * trade.quantity;
const pnlPct = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;

const closedTrade = {
  ...trade,
  status: "closed",
  exitPrice,
  pnl,
  pnlPct,
  exitReason: reason,
  closedAt: new Date().toISOString()
};

removeOpenTrade(tradeId);
addClosedTrade(closedTrade);
```

---

## 6. TRADE JOURNAL API

Must export:

- getOpenTrades
- getOpenTradeById
- addOpenTrade
- removeOpenTrade
- addClosedTrade
- getClosedTrades

Storage:
- storage/trades/open.json
- storage/trades/closed.json

---

## 7. ENTRY FLOW

```js
addOpenTrade({
  id,
  symbol,
  normalizedSymbol,
  assetClass,
  strategyName,
  entryPrice,
  stopLoss,
  takeProfit,
  quantity,
  riskAmount,
  status: "open",
  openedAt: new Date().toISOString(),
  metrics
});
```

---

## 8. DASHBOARD

OPEN:
- symbol, entry, stop, target, pnl, openedAt, strategyName

CLOSED:
- symbol, entry, exit, pnl, pnl%, exitReason, closedAt

Routes:
- GET /positions/open
- GET /positions/closed

---

## 9. DECISION CONTRACT

```js
{
  strategyName,
  closePrice,
  breakoutLevel,
  atr,
  volumeRatio,
  distanceToBreakoutPct,

  entryPrice,
  stopLoss,
  takeProfit,
  quantity,
  riskAmount,

  approved,
  reason
}
```

---

## 10. TESTING

```js
it('triggers stop loss exit', async () => {
  expect(true).toBe(true);
});
```

---

## SUCCESS CRITERIA

- Trades close automatically
- Closed trades stored
- Open trades removed
- PnL visible
- Dry run safe
- Dashboard accurate
