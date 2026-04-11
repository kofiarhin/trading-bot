# Trading Bot

A Node.js autopilot trading engine for Alpaca **paper trading**. Scans a configured stock and crypto universe on closed 15-minute candles, evaluates a momentum breakout strategy with ATR-based risk sizing, applies strict risk controls, and places paper orders automatically.

Also includes a manual CLI for placing individual orders by natural language command.

---

## Installation

```bash
npm install
```

---

## Environment Setup

```bash
cp .env.example .env
```

Edit `.env` with your Alpaca paper credentials:

```env
ALPACA_API_KEY=your_paper_api_key
ALPACA_API_SECRET=your_paper_api_secret
ALPACA_BASE_URL=https://paper-api.alpaca.markets

DEFAULT_TIMEFRAME=15Min
RISK_PERCENT=0.005
MAX_DAILY_LOSS_PERCENT=0.02
MAX_OPEN_POSITIONS=3
ENABLE_CRYPTO=false
RUN_MODE=paper
```

Get your paper trading keys from [app.alpaca.markets](https://app.alpaca.markets) — switch to **Paper** mode in the dashboard.

---

## Autopilot Commands

### Run one full cycle (scan → strategy → risk → orders)

```bash
npm run autopilot
```

This performs the full pipeline once and exits:

```
Load universe → Fetch bars → Compute indicators → Evaluate strategy
→ Run risk guards → Place paper orders → Log results → Exit
```

### Dry run (no orders placed)

```bash
npm run autopilot:dry
```

Same pipeline but skips order submission. Logs all decisions and writes journal entries marked as `dry_run`. **Always run this first.**

### Recurring 15-minute worker

```bash
npm run worker:15m
```

Starts a long-running process that waits for each 15-minute candle boundary and runs the autopilot cycle automatically. Respects market hours for stocks. Press `Ctrl+C` to stop.

### Strategy simulation only

```bash
npm run strategy:simulate
```

Fetches live market data and evaluates the strategy for all symbols. Prints detailed decisions to stdout. No orders, no journal writes. Useful for validating the strategy is working as expected.

---

## How the Autopilot Works

### Strategy — Momentum Breakout + ATR

A trade is approved only when all of the following conditions pass:

1. **Breakout confirmed** — latest close is above the highest high of the last 20 completed candles
2. **Volume confirmed** — current candle volume exceeds the 20-candle average volume
3. **ATR valid** — 14-period ATR is computable and positive
4. **Stop-loss valid** — `stopLoss = entryPrice − (1.5 × ATR)`
5. **Position size ≥ 1** — `quantity = floor((equity × riskPercent) / riskPerUnit)`

Take-profit target is set at 2R: `takeProfit = entryPrice + (2 × riskPerUnit)`

Default risk per trade is **0.5% of account equity**.

### Risk Controls

All of these must pass before any order is submitted:

| Guard | Default |
|---|---|
| Per-trade risk | 0.5% of equity |
| Daily loss limit | 2% of equity — locks out new trades for the day |
| Max open positions | 3 |
| Duplicate symbol | No new entry if symbol already has an open position |
| Symbol cooldown | 1 trading day (stocks) / 6 hours (crypto) after closing |

### Market Hours

- **Stocks** — Mon–Fri, 9:45 AM–4:00 PM ET (first closed 15-minute candle onward)
- **Crypto** — 24/7 (set `ENABLE_CRYPTO=true` in `.env` to enable)

### Logs and Journal

Every cycle writes to MongoDB:

- **CycleLog collection** — cycle summaries (scanned, approved, placed, skipped)
- **OpenTrade / ClosedTrade / TradeEvent collections** — trade lifecycle records with entry, stop, target, fill, and PnL
- **Decision collection** — per-symbol strategy decisions per cycle

MongoDB is the only active runtime source of truth. Legacy JSON files under `storage/` are migration input only — run `npm run db:migrate` once to import them if you have pre-migration data.

---

## Symbol Universe

Edit [src/market/universe.js](src/market/universe.js) to change what the autopilot scans.

### Default stocks

`AAPL`, `MSFT`, `NVDA`, `AMZN`, `META`, `TSLA`, `AMD`, `GOOGL`

### Default crypto (requires `ENABLE_CRYPTO=true`)

`BTC/USD`, `ETH/USD`, `SOL/USD`

---

## Configuration Reference

All settings live in `.env`. See [.env.example](.env.example) for the full list.

| Variable | Default | Description |
|---|---|---|
| `ALPACA_API_KEY` | — | Alpaca paper API key |
| `ALPACA_API_SECRET` | — | Alpaca paper API secret |
| `ALPACA_BASE_URL` | — | Must be `https://paper-api.alpaca.markets` |
| `DEFAULT_TIMEFRAME` | `15Min` | Candle timeframe |
| `RISK_PERCENT` | `0.005` | Fraction of equity risked per trade (0.5%) |
| `MAX_DAILY_LOSS_PERCENT` | `0.02` | Daily loss lockout threshold (2%) |
| `MAX_OPEN_POSITIONS` | `3` | Maximum concurrent open positions |
| `ENABLE_CRYPTO` | `false` | Set to `true` to include crypto in scans |
| `RUN_MODE` | `paper` | Must stay `paper` in v1 |

---

## Tests

```bash
npm test
```

Runs all Jest tests. Coverage includes strategy logic, risk guards, and indicator calculations.

```bash
npm run test:watch
```

Re-runs tests on file change.

---

## Manual Trading CLI

The original CLI is still available for placing individual orders by natural language command.

```bash
npm run trade -- "<command>"
```

### Buy

```bash
npm run trade -- "buy 1 share of apple"
npm run trade -- "buy 2 shares of tesla"
npm run trade -- 'buy $100 of apple'
npm run trade -- "buy 200 dollars of nvidia"
npm run trade -- "buy 0.01 btc"
npm run trade -- 'buy $50 of eth'
```

### Sell

```bash
npm run trade -- "sell apple stock"
npm run trade -- "sell 2 shares of apple"
npm run trade -- "sell eth"
```

### Close position

```bash
npm run trade -- "close my apple position"
npm run trade -- "close my btc position"
```

### Dry run preview

```bash
npm run trade:dry -- "sell apple stock"
npm run trade:dry -- 'buy $100 of tesla'
```

### Shell `$` escaping note

In bash, wrap dollar-amount commands in single quotes or escape the `$`:

```bash
npm run trade -- 'buy $200 of nvidia'     # single quotes — safe
npm run trade -- "buy \$200 of nvidia"    # escaped — safe
npm run trade -- "buy 200 dollars of nvidia"  # no $ — safe
```

### Supported stocks (CLI)

| Company | Aliases | Symbol |
|---|---|---|
| Apple | apple, aapl | AAPL |
| Tesla | tesla, tsla | TSLA |
| Microsoft | microsoft, msft | MSFT |
| Amazon | amazon, amzn | AMZN |
| Google | google, alphabet, googl, goog | GOOGL |
| Meta | meta, facebook, fb | META |
| Nvidia | nvidia, nvda | NVDA |

### Supported crypto (CLI)

| Asset | Aliases | Symbol |
|---|---|---|
| Bitcoin | bitcoin, btc, btc/usd | BTC/USD |
| Ethereum | ethereum, eth, eth/usd | ETH/USD |
| Solana | solana, sol, sol/usd | SOL/USD |
| Dogecoin | dogecoin, doge, doge/usd | DOGE/USD |

---

## Safety Notes

- **Paper trading only.** The bot hard-fails at startup if `ALPACA_BASE_URL` is not exactly `https://paper-api.alpaca.markets`.
- Live trading mode is blocked in v1.
- Always do a dry run before running live autopilot cycles for the first time.
- Risk state (daily loss, cooldowns) persists across runs in the `RiskState` MongoDB collection and resets each trading day.

---

## Deployment

### Architecture

| Component | Platform |
|---|---|
| Backend API + worker | Heroku |
| Frontend dashboard | Vercel |
| Database | MongoDB Atlas |

---

### 1. MongoDB Atlas

1. Create a free cluster at [cloud.mongodb.com](https://cloud.mongodb.com)
2. Create a database user with read/write access
3. Whitelist all IPs (`0.0.0.0/0`) or restrict to Heroku's IP range
4. Copy the connection string — it will look like:
   `mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/trading-bot`

---

### 2. Heroku Backend

The `Procfile` defines two processes:

```
web: node -r ./src/config/loadEnv.cjs src/server/index.js
worker: node -r ./src/config/loadEnv.cjs src/worker15m.js
```

**Deploy steps:**

```bash
heroku create your-trading-bot
heroku config:set \
  NODE_ENV=production \
  ALPACA_API_KEY=your_key \
  ALPACA_API_SECRET=your_secret \
  ALPACA_BASE_URL=https://paper-api.alpaca.markets \
  MONGO_URI=mongodb+srv://... \
  MONGO_DB_NAME=trading-bot \
  CLIENT_URL=https://your-vercel-app.vercel.app
git push heroku main
```

**Enable the worker dyno** (it is off by default on Heroku):

```bash
heroku ps:scale web=1 worker=1
```

**Run the one-time migration** (only needed if you have legacy JSON files to import):

```bash
heroku run npm run db:migrate
```

**Required Heroku config vars:**

| Variable | Description |
|---|---|
| `ALPACA_API_KEY` | Alpaca paper API key |
| `ALPACA_API_SECRET` | Alpaca paper API secret |
| `ALPACA_BASE_URL` | Must be `https://paper-api.alpaca.markets` |
| `MONGO_URI` | MongoDB Atlas connection string |
| `MONGO_DB_NAME` | Database name (e.g. `trading-bot`) |
| `CLIENT_URL` | Your Vercel frontend URL (for CORS) |

---

### 3. Vercel Frontend

```bash
cd client
vercel deploy
```

Set the environment variable in the Vercel dashboard (or via CLI):

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://your-trading-bot.herokuapp.com/api` |

The frontend has no server-side logic — it is a static Vite build that calls the Heroku API.
