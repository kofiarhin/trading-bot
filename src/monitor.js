/**
 * Politician Copy-Trading Monitor
 *
 * Polls Capitol Trades for new stock trades by Dave McCormick (M001243),
 * saves them as JSON files in _suggested_trade/, and optionally executes
 * them via Alpaca paper trading.
 *
 * Usage:
 *   npm run monitor            — poll and auto-execute trades
 *   npm run monitor:dry        — poll, save files, but don't execute
 *
 * Env vars (all optional with defaults):
 *   POLITICIAN_ID              — Capitol Trades politician ID (default: M001243)
 *   POLL_INTERVAL_MS           — polling interval in ms (default: 300000 = 5 min)
 *   NOTIONAL_PER_TRADE         — dollars to spend per copied trade (default: 100)
 *   AUTO_EXECUTE               — set to "false" to disable auto-execution (default: true)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { fetchStockTrades } from "./capitoltrades.js";
import { submitMarketOrder } from "./alpaca.js";

// ---------------------------------------------------------------------------
// Bootstrap — load .env
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env");

if (existsSync(envPath)) {
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const POLITICIAN_ID = process.env.POLITICIAN_ID ?? "M001243"; // Dave McCormick
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS ?? "300000", 10); // 5 min
const NOTIONAL_PER_TRADE = parseFloat(process.env.NOTIONAL_PER_TRADE ?? "100");
const AUTO_EXECUTE = process.env.AUTO_EXECUTE !== "false";
const DRY_RUN = process.argv.includes("--dry-run");

const OUTPUT_DIR = resolve(__dirname, "../_suggested_trade");
const SEEN_FILE = resolve(OUTPUT_DIR, ".seen_trades.json");

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------
function ensureOutputDir() {
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
}

function loadSeenTrades() {
  if (!existsSync(SEEN_FILE)) return new Set();
  try {
    const raw = JSON.parse(readFileSync(SEEN_FILE, "utf-8"));
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function saveSeenTrades(seen) {
  writeFileSync(SEEN_FILE, JSON.stringify([...seen], null, 2), "utf-8");
}

function tradeKey(trade) {
  return `${trade.ticker}|${trade.type}|${trade.txDate}|${trade.amount}`;
}

// ---------------------------------------------------------------------------
// Save suggested trade to file
// ---------------------------------------------------------------------------
function saveSuggestedTrade(trade, executed, error = null) {
  ensureOutputDir();

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${ts}_${trade.ticker ?? "UNKNOWN"}_${trade.type}.json`;
  const filepath = resolve(OUTPUT_DIR, filename);

  const record = {
    savedAt: new Date().toISOString(),
    politician: trade.politician,
    ticker: trade.ticker,
    company: trade.company,
    type: trade.type,
    txDate: trade.txDate,
    pubDate: trade.pubDate,
    amount: trade.amount,
    assetType: trade.assetType,
    owner: trade.owner,
    botAction: {
      notional: NOTIONAL_PER_TRADE,
      executed: executed && !DRY_RUN,
      dryRun: DRY_RUN,
      error: error ?? null,
    },
  };

  writeFileSync(filepath, JSON.stringify(record, null, 2), "utf-8");

  // Always overwrite latest.json with the most recently seen trade
  writeFileSync(
    resolve(OUTPUT_DIR, "latest.json"),
    JSON.stringify(record, null, 2),
    "utf-8"
  );

  return filepath;
}

// ---------------------------------------------------------------------------
// Execute a copy trade via Alpaca
// ---------------------------------------------------------------------------
async function executeCopyTrade(trade) {
  const side = trade.type === "buy" ? "buy" : "sell";

  if (side !== "buy" && side !== "sell") {
    throw new Error(`Unknown trade type: "${trade.type}"`);
  }

  if (side === "buy") {
    return submitMarketOrder({
      symbol: trade.ticker,
      side: "buy",
      notional: NOTIONAL_PER_TRADE,
      qty: null,
    });
  }

  // For sells, we'd need to check position first. Keep it simple:
  // submit a sell for $notional worth (Alpaca handles the qty conversion).
  return submitMarketOrder({
    symbol: trade.ticker,
    side: "sell",
    notional: NOTIONAL_PER_TRADE,
    qty: null,
  });
}

// ---------------------------------------------------------------------------
// Process one poll cycle
// ---------------------------------------------------------------------------
async function poll(seen) {
  console.log(`\n[${new Date().toISOString()}] Polling Capitol Trades...`);

  let trades;
  try {
    trades = await fetchStockTrades(POLITICIAN_ID);
  } catch (err) {
    console.error(`  Fetch failed: ${err.message}`);
    return;
  }

  console.log(`  Found ${trades.length} stock trade(s) on page 1`);

  let newCount = 0;

  for (const trade of trades) {
    const key = tradeKey(trade);
    if (seen.has(key)) continue;

    seen.add(key);
    newCount++;

    const label = `${trade.type.toUpperCase()} ${trade.ticker} (${trade.company ?? "?"}) on ${trade.txDate}`;
    console.log(`\n  NEW TRADE: ${label}`);
    console.log(
      `    Amount range: ${trade.amount ?? "unknown"} | Owner: ${trade.owner ?? "?"}`
    );

    let executed = false;
    let execError = null;

    if (DRY_RUN || !AUTO_EXECUTE) {
      console.log(
        `    [${DRY_RUN ? "DRY RUN" : "AUTO_EXECUTE=false"}] Would place $${NOTIONAL_PER_TRADE} ${trade.type} order for ${trade.ticker}`
      );
      executed = false;
    } else {
      try {
        const result = await executeCopyTrade(trade);
        console.log(`    Alpaca order placed: ${result.id ?? JSON.stringify(result)}`);
        executed = true;
      } catch (err) {
        execError = err.message;
        console.error(`    Order failed: ${err.message}`);
      }
    }

    const filepath = saveSuggestedTrade(trade, executed, execError);
    console.log(`    Saved: ${filepath}`);
  }

  if (newCount === 0) {
    console.log("  No new trades since last poll.");
  }

  saveSeenTrades(seen);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main() {
  ensureOutputDir();

  console.log("=".repeat(60));
  console.log("  Politician Copy-Trading Monitor");
  console.log("  Following: Dave McCormick (M001243)");
  console.log(`  Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
  console.log(`  Notional per trade: $${NOTIONAL_PER_TRADE}`);
  console.log(
    `  Auto-execute: ${DRY_RUN ? "NO (dry run)" : AUTO_EXECUTE ? "YES" : "NO (disabled)"}`
  );
  console.log("=".repeat(60));

  const seen = loadSeenTrades();

  // Run immediately, then on interval
  await poll(seen);

  setInterval(() => poll(seen), POLL_INTERVAL_MS);
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
