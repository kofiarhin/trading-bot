// Autopilot — one full market-scan-to-order cycle.
// Usage: node src/autopilot.js [--dry-run]
import { config } from "./config/env.js";
import { getUniverse } from "./market/universe.js";
import { filterEligible } from "./market/marketHours.js";
import { fetchBars, validateBars } from "./market/alpacaMarketData.js";
import { evaluateBreakout } from "./strategies/breakoutStrategy.js";
import { runRiskGuards } from "./risk/guards.js";
import { placeOrder, closeTrade } from "./execution/orderManager.js";
import { getAccount } from "./execution/alpacaTrading.js";
import { getOpenSymbols, checkOpenTradesForExit } from "./positions/positionMonitor.js";
import { appendTradeEntry, buildJournalEntry } from "./journal/tradeJournal.js";
import { markTradeClosed } from "./journal/journalUtils.js";
import { removeOpenTrade } from "./journal/openTradesStore.js";
import { appendClosedTrade } from "./journal/closedTradesStore.js";
import { logCycleComplete } from "./journal/cycleLogger.js";
import { logDecision } from "./journal/decisionLogger.js";
import { normalizeSymbol } from "./utils/symbolNorm.js";
import { logger } from "./utils/logger.js";

const dryRun = process.argv.includes("--dry-run");

// Maps positionMonitor exitReason strings to spec-compliant journal exitReason values.
function toJournalExitReason(exitReason) {
  const map = {
    stopLoss: "stop_hit",
    takeProfit: "target_hit",
    stop_hit: "stop_hit",
    target_hit: "target_hit",
    broker_sync_close: "broker_sync_close",
  };
  return map[exitReason] ?? "unknown";
}

async function runAutopilot() {
  logger.info(`Autopilot cycle starting${dryRun ? " [DRY RUN]" : ""}`);

  const tradingCfg = config.trading;
  const summary = { scanned: 0, approved: 0, placed: 0, skipped: 0, errors: 0, closed: 0 };

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

  // 2. Monitor exits — check open trades before placing new ones
  logger.info("Checking open trades for exit conditions");
  let exitCandidates = [];
  try {
    exitCandidates = await checkOpenTradesForExit();
  } catch (err) {
    logger.error("Exit check failed", { error: err.message });
  }

  logger.info("Exit check complete", { candidates: exitCandidates.length });

  // 3. Execute exits
  for (const { trade, exitReason, currentPrice, orphaned } of exitCandidates) {
    const symbol = trade.normalizedSymbol ?? normalizeSymbol(trade.symbol);
    const journalExitReason = toJournalExitReason(exitReason);

    // Orphaned: journal open but no broker position — close journal record only
    if (orphaned) {
      logger.warn("Closing orphaned journal trade (no broker position)", { symbol, tradeId: trade.tradeId });

      if (trade.tradeId) {
        try {
          markTradeClosed(trade.tradeId, {
            exitReason: "broker_sync_close",
            exitPrice: null,
            closedAt: new Date().toISOString(),
          });
          summary.closed++;
        } catch (err) {
          logger.error("Failed to close orphaned journal trade", { symbol, error: err.message });
          summary.errors++;
        }
      } else {
        // Legacy record — remove from open store + append to closed
        appendClosedTrade({
          symbol: trade.symbol,
          normalizedSymbol: symbol,
          assetClass: trade.assetClass ?? null,
          strategyName: trade.strategyName ?? null,
          openedAt: trade.openedAt ?? null,
          closedAt: new Date().toISOString(),
          entryPrice: trade.entryPrice,
          exitPrice: null,
          quantity: trade.quantity ?? 1,
          pnl: null,
          pnlPct: null,
          exitReason: "broker_sync_close",
        });
        removeOpenTrade(symbol);
        summary.closed++;
      }
      continue;
    }

    logger.info("Executing exit", { symbol, exitReason, currentPrice });

    const result = await closeTrade({ trade, exitReason, currentPrice, dryRun });

    if (dryRun) {
      logger.info("[DRY RUN] Exit logged — no state mutation", { symbol, exitReason });
      continue;
    }

    if (!result.closed) {
      logger.error("Exit failed", { symbol, error: result.error });
      summary.errors++;
      continue;
    }

    const exitPrice = result.exitPrice ?? currentPrice;

    // Use markTradeClosed for journal-backed trades (have tradeId)
    if (trade.tradeId) {
      try {
        markTradeClosed(trade.tradeId, {
          exitReason: journalExitReason,
          exitPrice,
          closedAt: new Date().toISOString(),
          brokerExitOrderId: result.orderId ?? null,
        });
      } catch (err) {
        logger.error("Failed to mark trade closed in journal", {
          symbol,
          tradeId: trade.tradeId,
          error: err.message,
        });
        summary.errors++;
        continue;
      }
    } else {
      // Legacy record without tradeId — use old path for backward compat
      const pnl = (exitPrice - trade.entryPrice) * (trade.quantity ?? 1);
      const pnlPct = trade.entryPrice
        ? ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100
        : null;

      appendClosedTrade({
        symbol: trade.symbol,
        normalizedSymbol: normalizeSymbol(symbol),
        assetClass: trade.assetClass ?? null,
        strategyName: trade.strategyName ?? null,
        openedAt: trade.openedAt ?? null,
        closedAt: new Date().toISOString(),
        entryPrice: trade.entryPrice,
        exitPrice,
        quantity: trade.quantity ?? 1,
        pnl,
        pnlPct,
        exitReason: journalExitReason,
      });

      removeOpenTrade(symbol);
    }

    summary.closed++;
    logger.info("Trade closed and archived", { symbol, exitReason: journalExitReason, exitPrice });
  }

  // 4. Load current open positions (after exits)
  const openSymbols = await getOpenSymbols();
  logger.info("Open positions loaded", { count: openSymbols.length, symbols: openSymbols });

  // 5. Build universe and filter by market hours
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

  // 6. Per-symbol: fetch → validate → evaluate → risk check → order
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

    let persistedDecision;
    try {
      persistedDecision = logDecision(decision, assetClass);
    } catch (err) {
      logger.error("Decision persistence failed", {
        symbol,
        assetClass,
        approved: !!decision.approved,
        error: err.message,
      });
      summary.errors++;
      continue;
    }

    logger.info("Decision logged", {
      symbol,
      approved: !!decision.approved,
      assetClass,
      file: persistedDecision.fileName,
      totalRecords: persistedDecision.totalRecords,
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

    // Place order — decision carries all the context placeOrder needs
    const orderResult = await placeOrder({ decision, dryRun });

    // Legacy daily journal entry (kept for backward compat with existing signals/performance routes)
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
