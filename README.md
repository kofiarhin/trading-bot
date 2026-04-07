# Trading Bot

A Node.js CLI trading assistant for Alpaca **paper trading**. Type natural language commands to place market orders against your Alpaca paper account.

---

## Installation

```bash
npm install
```

No external packages are required. The bot uses Node.js built-ins only.

---

## Environment Setup

Copy the example env file and fill in your Alpaca paper credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```env
ALPACA_API_KEY=your_paper_key
ALPACA_API_SECRET=your_paper_secret
ALPACA_BASE_URL=https://paper-api.alpaca.markets
```

Get your paper trading keys from: https://app.alpaca.markets (switch to Paper mode in the dashboard).

---

## Usage

```bash
npm run trade -- "<command>"
```

### Buy examples

```bash
npm run trade -- "buy 1 share of apple"
npm run trade -- "buy 2 shares of tesla"
npm run trade -- "buy $100 of apple"
npm run trade -- "buy $50 of nvidia"
```

### Sell examples

```bash
npm run trade -- "sell apple stock"
npm run trade -- "sell 2 shares of apple"
npm run trade -- "sell microsoft stock"
```

### Close position examples

```bash
npm run trade -- "close my apple position"
npm run trade -- "close my aapl position"
npm run trade -- "close my tsla position"
```

---

## Dry Run Mode

Use `--dry-run` (or `npm run trade:dry`) to parse and preview a command without placing any order:

```bash
npm run trade:dry -- "sell apple stock"
npm run trade:dry -- "buy $100 of tesla"
npm run trade:dry -- "close my msft position"
```

Dry-run output will show the resolved symbol, action, and order parameters without contacting Alpaca.

---

## Supported Stocks

| Company   | Aliases accepted                    | Symbol |
|-----------|--------------------------------------|--------|
| Apple     | apple, aapl                         | AAPL   |
| Tesla     | tesla, tsla                         | TSLA   |
| Microsoft | microsoft, msft                     | MSFT   |
| Amazon    | amazon, amzn                        | AMZN   |
| Google    | google, alphabet, googl, goog       | GOOGL  |
| Meta      | meta, facebook, fb                  | META   |
| Nvidia    | nvidia, nvda                        | NVDA   |

---

## Rejected Commands

The bot will reject and exit non-zero for:

- `"buy apple stock"` — buy requires a quantity or dollar amount
- `"sell buy apple"` — ambiguous, contains both buy and sell
- `"buy 1 share of bitcoin"` — unknown symbol
- Sell/close when no position exists for that symbol

---

## Safety Notes

- **Paper trading only.** The bot hard-fails if `ALPACA_BASE_URL` is not exactly `https://paper-api.alpaca.markets`.
- No live endpoint is ever contacted.
- US equities, market orders only. No crypto, options, or margin logic.
- Sell and close commands always sell the **full current position** (or the requested share count for explicit sells).
- Orders are day orders (`time_in_force: day`).
