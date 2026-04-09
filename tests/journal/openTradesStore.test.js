import { beforeAll, afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import {
  findOpenTrade,
  getOpenTrades,
  removeOpenTrade,
  saveOpenTrade,
} from "../../src/journal/openTradesStore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const openTradesPath = resolve(__dirname, "../../storage/trades/open.json");

let originalOpenTrades = null;
let openTradesExisted = false;

function writeOpenTrades(data) {
  mkdirSync(dirname(openTradesPath), { recursive: true });
  writeFileSync(openTradesPath, JSON.stringify(data, null, 2), "utf-8");
}

describe("openTradesStore", () => {
  beforeAll(() => {
    openTradesExisted = existsSync(openTradesPath);
    originalOpenTrades = openTradesExisted
      ? readFileSync(openTradesPath, "utf-8")
      : null;
  });

  beforeEach(() => {
    writeOpenTrades([]);
  });

  afterAll(() => {
    if (openTradesExisted) {
      writeFileSync(openTradesPath, originalOpenTrades, "utf-8");
      return;
    }

    if (existsSync(openTradesPath)) {
      unlinkSync(openTradesPath);
    }
  });

  it("saves and finds trades using normalized symbols", () => {
    saveOpenTrade({
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

    expect(getOpenTrades()).toEqual([
      expect.objectContaining({
        symbol: "BTC/USD",
        normalizedSymbol: "BTCUSD",
        status: "open",
      }),
    ]);

    expect(findOpenTrade("BTCUSD")).toEqual(
      expect.objectContaining({
        symbol: "BTC/USD",
        normalizedSymbol: "BTCUSD",
        strategyName: "momentum_breakout_atr_v1",
      })
    );
  });

  it("updates existing records by normalized symbol and removes them", () => {
    saveOpenTrade({
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

    saveOpenTrade({
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

    expect(getOpenTrades()).toHaveLength(1);
    expect(findOpenTrade("ETH/USD")).toEqual(
      expect.objectContaining({
        symbol: "ETHUSD",
        normalizedSymbol: "ETHUSD",
        strategyName: "updated_strategy",
        quantity: 3,
      })
    );

    removeOpenTrade("ETH/USD");

    expect(getOpenTrades()).toEqual([]);
    expect(findOpenTrade("ETHUSD")).toBeNull();
  });
});
