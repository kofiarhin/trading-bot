import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { parseCommand } from "./parser.js";
import { getPosition, submitMarketOrder } from "./alpaca.js";

// ---------------------------------------------------------------------------
// Load .env manually (no external dependencies)
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
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fail(message) {
  console.error(`\nError: ${message}\n`);
  process.exit(1);
}

function formatSummary({ action, symbol, qty, notional, positionQty }) {
  if (action === "buy") {
    if (notional != null) return `BUY ${symbol} — notional $${notional}`;
    return `BUY ${symbol} — ${qty} share${qty !== 1 ? "s" : ""}`;
  }
  if (action === "sell" || action === "close") {
    return `SELL ${symbol} — ${positionQty} share${positionQty !== 1 ? "s" : ""} (full position)`;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const commandArgs = args.filter((a) => a !== "--dry-run");
const input = commandArgs.join(" ").trim();

if (!input) {
  console.error(
    "\nUsage: npm run trade -- \"<command>\"\n" +
      "\nExamples:\n" +
      '  npm run trade -- "buy 1 share of apple"\n' +
      '  npm run trade -- "sell apple stock"\n' +
      '  npm run trade -- "buy $100 of tesla"\n' +
      '  npm run trade -- "close my aapl position"\n' +
      '  npm run trade:dry -- "sell 2 shares of microsoft"\n'
  );
  process.exit(1);
}

let parsed;
try {
  parsed = parseCommand(input);
} catch (err) {
  fail(err.message);
}

if (parsed.action === "exit") {
  console.log("Goodbye.");
  process.exit(0);
}

const { action, symbol, qty, notional } = parsed;

// ---------------------------------------------------------------------------
// Resolve position for sell / close
// ---------------------------------------------------------------------------
let positionQty = null;

if (action === "sell" || action === "close") {
  if (dryRun) {
    console.log(`[DRY RUN] Would check position for ${symbol}.`);
    console.log(
      `[DRY RUN] Assuming a position exists for simulation purposes.`
    );
    positionQty = qty ?? 10; // simulated quantity
  } else {
    let position;
    try {
      position = await getPosition(symbol);
    } catch (err) {
      fail(`Failed to fetch position: ${err.message}`);
    }

    if (!position) {
      fail(
        `No open position found for ${symbol}. Order not placed.`
      );
    }

    positionQty = Math.abs(parseFloat(position.qty));

    if (isNaN(positionQty) || positionQty <= 0) {
      fail(`Position quantity for ${symbol} is invalid (${position.qty}). Order not placed.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Build order parameters
// ---------------------------------------------------------------------------
let orderParams;

if (action === "buy") {
  orderParams = {
    symbol,
    side: "buy",
    qty: qty ?? null,
    notional: notional ?? null,
  };
} else {
  // sell or close — always sell full position
  orderParams = {
    symbol,
    side: "sell",
    qty: positionQty,
    notional: null,
  };
}

// ---------------------------------------------------------------------------
// Print execution summary
// ---------------------------------------------------------------------------
const summary = formatSummary({ action, symbol, qty, notional, positionQty });
console.log(`\n> ${summary}`);

if (dryRun) {
  console.log("\n[DRY RUN] Order parameters:");
  console.log(JSON.stringify(orderParams, null, 2));
  console.log("\n[DRY RUN] No order was placed.\n");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Submit order
// ---------------------------------------------------------------------------
let response;
try {
  response = await submitMarketOrder(orderParams);
} catch (err) {
  fail(`Order failed: ${err.message}`);
}

console.log("\nAlpaca response:");
console.log(JSON.stringify(response, null, 2));
console.log();
