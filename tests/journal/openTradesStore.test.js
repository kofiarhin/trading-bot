import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";

import { clearMongoHarness, startMongoHarness, stopMongoHarness } from "../helpers/mongoHarness.js";
import {
  findOpenTrade,
  getOpenTrades,
  removeOpenTrade,
  saveOpenTrade,
} from "../../src/journal/openTradesStore.js";

describe("openTradesStore", () => {
  beforeAll(async () => {
    await startMongoHarness("open-trades-store-test");
  });

  beforeEach(async () => {
    await clearMongoHarness();
  });

  afterAll(async () => {
    await stopMongoHarness();
  });

  it("saves and finds trades using normalized symbols", async () => {
    await saveOpenTrade({
      symbol: "BTC/USD",
      assetClass: "crypto",
      strategyName: "momentum_breakout_atr_v1",
      openedAt: "2026-04-08T09:00:00.000Z",
      entryPrice: 71234.56,
      stopLoss: 70500,
      takeProfit: 72600,
      riskAmount: 100,
      quantity: 1,
    });

    await expect(getOpenTrades()).resolves.toEqual([
      expect.objectContaining({
        symbol: "BTC/USD",
        normalizedSymbol: "BTCUSD",
        status: "open",
      }),
    ]);

    await expect(findOpenTrade("BTCUSD")).resolves.toEqual(
      expect.objectContaining({
        symbol: "BTC/USD",
        normalizedSymbol: "BTCUSD",
        strategyName: "momentum_breakout_atr_v1",
      })
    );
  });

  it("updates existing records by normalized symbol and removes them", async () => {
    await saveOpenTrade({
      symbol: "ETH/USD",
      assetClass: "crypto",
      strategyName: "first_strategy",
      openedAt: "2026-04-08T09:00:00.000Z",
      entryPrice: 2200,
      stopLoss: 2100,
      takeProfit: 2400,
      riskAmount: 75,
      quantity: 2,
    });

    await saveOpenTrade({
      symbol: "ETHUSD",
      assetClass: "crypto",
      strategyName: "updated_strategy",
      openedAt: "2026-04-08T10:00:00.000Z",
      entryPrice: 2210,
      stopLoss: 2110,
      takeProfit: 2410,
      riskAmount: 80,
      quantity: 3,
    });

    await expect(getOpenTrades()).resolves.toHaveLength(1);
    await expect(findOpenTrade("ETH/USD")).resolves.toEqual(
      expect.objectContaining({
        symbol: "ETHUSD",
        normalizedSymbol: "ETHUSD",
        strategyName: "updated_strategy",
        quantity: 3,
      })
    );

    await removeOpenTrade("ETH/USD");

    await expect(getOpenTrades()).resolves.toEqual([]);
    await expect(findOpenTrade("ETHUSD")).resolves.toBeNull();
  });
});
