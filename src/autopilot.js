// Autopilot — one full market-scan-to-order cycle.
// Usage: node src/autopilot.js [--dry-run]
import { config } from "./config/env.js";
import { getUniverse } from "./market/universe.js";
import { filterEligible } from "./market/marketHours.js";
import { fetchBars, validateBars } from "./market/alpacaMarketData.js";
import { evaluateBreakout } from "./strategies/breakoutStrategy.js";
import { runRiskGuards } from "./risk/guards.js";
import { placeOrder } from "./execution/orderManager.js";
import { getAccount } from "./execution/alpacaTrading.js";
import { getOpenSymbols } from "./positions/positionMonitor.js";
import { appendTradeEntry, buildJournalEntry } from "./journal/tradeJournal.js";
import { logCycleComplete } from "./journal/cycleLogger.js";
import { logger } from "./utils/logger.js";

const dryRun = process.argv.includes("--dry-run");

async function runAutopilot() {
  logger.info(`Autopilot cycle starting${dryRun ? " [DRY RUN]" : ""}`);

  const tradingCfg = config.trading;
  const summary = { scanned: 0, approved: 0, placed: 0, skipped: 0, errors: 0 };

  // 1. Fetch account info
  let account;
  try {
    account = await getAccount();
  } catch (err) {
    logger.error("Failed to fetch account", { error: err.message });
    process.exit(1);
  }

  const accountEquity = parseFloat(account.equity);
  logger.info("Account loaded", { equity: accountEquity, status: account.status });

  // 2. Load open positions
  const openSymbols = await getOpenSymbols();
  logger.info("Open positions loaded", { count: openSymbols.length, symbols: openSymbols });

  // 3. Build universe and filter by market hours
  const universe = getUniverse(tradingCfg);
  const stocksTotal = universe.filter((u) => u.assetClass === "stock").length;
  const cryptoTotal = universe.filter((u) => u.assetClass === "crypto").length;
  logger.info("Universe loaded", { total: universe.length, stocks: stocksTotal, crypto: cryptoTotal });

  const eligible = filterEligible(universe);
  const stocksEligible = eligible.filter((u) => u.assetClass === "stock").length;
  const cryptoEligible = eligible.filter((u) => u.assetClass === "crypto").length;
  logger.info("Universe filtered", {
    eligible: eligible.length,
    stocksEligible,
    cryptoEligible,
  });

  if (eligible.length === 0) {
    logger.info("No eligible symbols — outside market hours and crypto disabled or unavailable");
    logCycleComplete({ ...summary, note: "no eligible symbols" });
    return;
  }

  // 4. Per-symbol: fetch → validate → evaluate → risk check → order
  for (const { symbol, assetClass } of eligible) {
    summary.scanned++;

    let bars;
    try {
      bars = await fetchBars(symbol, assetClass, 60);
    } catch (err) {
      logger.error("Failed to fetch bars", { symbol, error: err.message });
      summary.errors++;
      continue;
    }

    const dataCheck = validateBars(bars, 25);
    if (!dataCheck.valid) {
      logger.warn("Data validation failed", { symbol, reason: dataCheck.reason });
      summary.skipped++;
      continue;
    }

    // Evaluate strategy
    const decision = evaluateBreakout({
      symbol,
      assetClass,
      bars,
      accountEquity,
      riskPercent: tradingCfg.riskPercent,
      timeframe: tradingCfg.timeframe,
    });

    if (!decision.approved) {
      logger.info("Strategy rejected", { symbol, reason: decision.reason });
      summary.skipped++;
      continue;
    }

    logger.info("Strategy approved", {
      symbol,
      entryPrice: decision.entryPrice,
      stopLoss: decision.stopLoss,
      takeProfit: decision.takeProfit,
      quantity: decision.quantity,
    });
    summary.approved++;

    // Risk guards
    const guard = runRiskGuards({
      decision,
      openPositions: openSymbols,
      accountEquity,
      maxDailyLossPercent: tradingCfg.maxDailyLossPercent,
      maxOpenPositions: tradingCfg.maxOpenPositions,
    });

    if (!guard.pass) {
      logger.warn("Risk guard rejected", { symbol, reason: guard.reason });
      summary.skipped++;
      continue;
    }

    // Place order
    const orderResult = await placeOrder({ decision, dryRun });

    // Journal
    const entry = buildJournalEntry(decision, orderResult);
    appendTradeEntry(entry);

    if (orderResult.submitted) {
      openSymbols.push(symbol); // Track locally to avoid duplicate in same cycle
      summary.placed++;
    }
  }

  logCycleComplete(summary);
  logger.info("Autopilot cycle complete", summary);
}

runAutopilot().catch((err) => {
  logger.error("Autopilot crashed", { error: err.message, stack: err.stack });
  process.exit(1);
});
