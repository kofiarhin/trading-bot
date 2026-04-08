# Crypto Extension Spec for Trading Bot

## Objective
Extend the CLI trading bot to support crypto trading using Alpaca without breaking stock functionality.

---

## Scope

### In Scope
- Buy, sell, close crypto positions
- Support qty and notional orders
- Maintain CLI UX
- Use Alpaca paper trading

### Out of Scope
- Strategies
- Backtesting
- UI changes
- Forex

---

## Supported Commands

### Buy
- buy 0.01 btc
- buy btc/usd
- buy $100 of bitcoin

### Sell
- sell 0.005 btc
- sell eth

### Close
- close my btc position

### Dry Run
- npm run trade:dry -- "buy 0.01 btc"

---

## Parser Output Contract

```js
{
  action,
  assetClass,
  symbol,
  qty,
  notional,
  rawSymbol
}
```

---

## Supported Crypto (Phase 1)

- BTC/USD
- ETH/USD
- SOL/USD
- DOGE/USD

---

## Symbol Map Example

```js
const CRYPTO_SYMBOL_MAP = {
  bitcoin: "BTC/USD",
  btc: "BTC/USD",
  ethereum: "ETH/USD",
  eth: "ETH/USD",
  solana: "SOL/USD",
  sol: "SOL/USD",
  dogecoin: "DOGE/USD",
  doge: "DOGE/USD"
}
```

---

## Trade Planner Rules

- Buy → qty or notional required
- Sell → qty required or full position
- Close → full position
- Reject crypto sell with notional

---

## Alpaca Rules

### Stock
- time_in_force: day

### Crypto
- time_in_force: gtc
- supports qty and notional
- no short selling

---

## Example Orders

### Crypto Buy Qty
```json
{
  "symbol": "BTC/USD",
  "side": "buy",
  "qty": "0.01",
  "time_in_force": "gtc"
}
```

### Crypto Buy Notional
```json
{
  "symbol": "ETH/USD",
  "side": "buy",
  "notional": "100",
  "time_in_force": "gtc"
}
```

---

## File Changes

### Update
- src/parser.js
- src/symbols.js
- src/tradePlanner.js
- src/alpaca.js
- src/index.js

### Add
- tests/tradePlanner.crypto.test.js
- tests/alpaca.crypto.test.js

---

## Acceptance Criteria

- Crypto buy/sell/close works
- Dry run works
- Stock flow unaffected
- Tests pass
- Clear errors for invalid inputs

---

## Implementation Order

1. symbols.js (crypto support)
2. parser.js (assetClass)
3. tests update
4. tradePlanner.js
5. alpaca.js
6. index.js
7. add tests
8. manual testing

---

## Example CLI Usage

```bash
npm run trade -- "buy 0.01 btc"
npm run trade -- "sell eth"
npm run trade -- "close my btc position"
npm run trade:dry -- "buy $50 of eth"
```

---

## Future Extensions

- Dynamic asset discovery
- Crypto strategies
- Backtesting
- Limit orders
