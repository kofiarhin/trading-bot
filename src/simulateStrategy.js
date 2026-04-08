// Strategy simulator — runs strategy evaluation without placing any orders.
// Usage: node src/simulateStrategy.js
import { config } from "./config/env.js";
import { getUniverse } from "./market/universe.js";
import { fetchBars, validateBars } from "./market/alpacaMarketData.js";
import { evaluateBreakout } from "./strategies/breakoutStrategy.js";
import { getAccount } from "./execution/alpacaTrading.js";
import { logger } from "./utils/logger.js";

async function simulate() {
  logger.info("Strategy simulation starting");

  let account;
  try {
    account = await getAccount();
  } catch (err) {
    logger.error("Failed to fetch account", { error: err.message });
    process.exit(1);
  }

  const accountEquity = parseFloat(account.equity);
  const tradingCfg = config.trading;

  const universe = getUniverse(tradingCfg);
  logger.info(`Simulating ${universe.length} symbols`);

  const results = [];

  for (const { symbol, assetClass } of universe) {
    let bars;
    try {
      bars = await fetchBars(symbol, assetClass, 60);
    } catch (err) {
      logger.error("Failed to fetch bars", { symbol, error: err.message });
      results.push({ symbol, error: err.message });
      continue;
    }

    const dataCheck = validateBars(bars, 25);
    if (!dataCheck.valid) {
      results.push({ symbol, skipped: true, reason: dataCheck.reason });
      continue;
    }

    const decision = evaluateBreakout({
      symbol,
      assetClass,
      bars,
      accountEquity,
      riskPercent: tradingCfg.riskPercent,
      timeframe: tradingCfg.timeframe,
    });

    results.push(decision);

    if (decision.approved) {
      logger.info("APPROVED", {
        symbol,
        entryPrice: decision.entryPrice,
        stopLoss: decision.stopLoss,
        takeProfit: decision.takeProfit,
        quantity: decision.quantity,
        volumeRatio: decision.volumeRatio,
      });
    } else {
      logger.info("rejected", { symbol, reason: decision.reason });
    }
  }

  const approved = results.filter((r) => r.approved);
  logger.info(`Simulation complete — ${approved.length}/${results.length} approved`);
  console.log("\nSimulation Results:");
  console.log(JSON.stringify(results, null, 2));
}

simulate().catch((err) => {
  logger.error("Simulation crashed", { error: err.message });
  process.exit(1);
});
