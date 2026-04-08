import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { parseCommand } from "./parser.js";
import { getPosition, submitMarketOrder } from "./alpaca.js";
import { buildOrderFromIntent, formatSummary } from "./tradePlanner.js";

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

function fail(message) {
  console.error(`\nError: ${message}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const commandArgs = args.filter((a) => a !== "--dry-run");
const input = commandArgs.join(" ").trim();

if (!input) {
  console.error(
    "\nUsage: npm run trade -- \"<command>\"\n" +
      "\nExamples:\n" +
      '  npm run trade -- "buy 1 share of apple"\n' +
      '  npm run trade -- "buy 0.01 btc"\n' +
      '  npm run trade -- "sell apple stock"\n' +
      '  npm run trade -- "sell eth"\n' +
      '  npm run trade -- "buy $100 of tesla"\n' +
      '  npm run trade -- "buy $50 of eth"\n' +
      '  npm run trade -- "close my aapl position"\n' +
      '  npm run trade -- "close my btc position"\n' +
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

const { action, assetClass, symbol, qty, notional } = parsed;

let positionQty = null;
if (action === "sell" || action === "close") {
  if (dryRun) {
    console.log(`[DRY RUN] Would check ${assetClass} position for ${symbol}.`);
    console.log("[DRY RUN] Assuming a position exists for simulation purposes.");
    positionQty = qty ?? (assetClass === "crypto" ? 1 : 10);
  } else {
    let position;
    try {
      position = await getPosition(symbol);
    } catch (err) {
      fail(`Failed to fetch position: ${err.message}`);
    }

    if (!position) {
      fail(`No open position found for ${symbol}. Order not placed.`);
    }

    positionQty = Math.abs(parseFloat(position.qty));
  }
}

let orderParams;
try {
  orderParams = buildOrderFromIntent({
    action,
    assetClass,
    symbol,
    qty,
    notional,
    positionQty,
  });
} catch (err) {
  fail(err.message);
}

const summary = formatSummary({
  action,
  assetClass,
  symbol,
  qty: orderParams.qty,
  notional: orderParams.notional,
  positionQty,
});
console.log(`\n> ${summary}`);

if (dryRun) {
  console.log("\n[DRY RUN] Order parameters:");
  console.log(JSON.stringify(orderParams, null, 2));
  console.log("\n[DRY RUN] No order was placed.\n");
  process.exit(0);
}

let response;
try {
  response = await submitMarketOrder(orderParams);
} catch (err) {
  fail(`Order failed: ${err.message}`);
}

console.log("\nAlpaca response:");
console.log(JSON.stringify(response, null, 2));
console.log();
