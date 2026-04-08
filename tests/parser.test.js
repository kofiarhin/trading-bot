import test from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "../src/parser.js";

test("buy 1 share of apple", () => {
  assert.deepEqual(parseCommand("buy 1 share of apple"), {
    action: "buy",
    assetClass: "stock",
    symbol: "AAPL",
    qty: 1,
    notional: null,
    rawSymbol: "apple",
  });
});

test("buy 2 shares of tesla", () => {
  assert.deepEqual(parseCommand("buy 2 shares of tesla"), {
    action: "buy",
    assetClass: "stock",
    symbol: "TSLA",
    qty: 2,
    notional: null,
    rawSymbol: "tesla",
  });
});

test("buy $100 of apple", () => {
  assert.deepEqual(parseCommand("buy $100 of apple"), {
    action: "buy",
    assetClass: "stock",
    symbol: "AAPL",
    qty: null,
    notional: 100,
    rawSymbol: "apple",
  });
});

test("buy 200 dollars of apple", () => {
  assert.deepEqual(parseCommand("buy 200 dollars of apple"), {
    action: "buy",
    assetClass: "stock",
    symbol: "AAPL",
    qty: null,
    notional: 200,
    rawSymbol: "apple",
  });
});

test("buy $200 share of nvidia", () => {
  assert.deepEqual(parseCommand("buy $200 share of nvidia"), {
    action: "buy",
    assetClass: "stock",
    symbol: "NVDA",
    qty: null,
    notional: 200,
    rawSymbol: "nvidia",
  });
});

test("sell 2 shares of apple", () => {
  assert.deepEqual(parseCommand("sell 2 shares of apple"), {
    action: "sell",
    assetClass: "stock",
    symbol: "AAPL",
    qty: 2,
    notional: null,
    rawSymbol: "apple",
  });
});

test("sell apple stock", () => {
  assert.deepEqual(parseCommand("sell apple stock"), {
    action: "sell",
    assetClass: "stock",
    symbol: "AAPL",
    qty: null,
    notional: null,
    rawSymbol: "apple",
  });
});

test("close my apple position", () => {
  assert.deepEqual(parseCommand("close my apple position"), {
    action: "close",
    assetClass: "stock",
    symbol: "AAPL",
    qty: null,
    notional: null,
    rawSymbol: "apple",
  });
});

test("close my aapl position", () => {
  assert.deepEqual(parseCommand("close my aapl position"), {
    action: "close",
    assetClass: "stock",
    symbol: "AAPL",
    qty: null,
    notional: null,
    rawSymbol: "aapl",
  });
});

test("buy 0.01 btc", () => {
  assert.deepEqual(parseCommand("buy 0.01 btc"), {
    action: "buy",
    assetClass: "crypto",
    symbol: "BTC/USD",
    qty: 0.01,
    notional: null,
    rawSymbol: "btc",
  });
});

test("buy $100 of bitcoin", () => {
  assert.deepEqual(parseCommand("buy $100 of bitcoin"), {
    action: "buy",
    assetClass: "crypto",
    symbol: "BTC/USD",
    qty: null,
    notional: 100,
    rawSymbol: "bitcoin",
  });
});

test("sell eth", () => {
  assert.deepEqual(parseCommand("sell eth"), {
    action: "sell",
    assetClass: "crypto",
    symbol: "ETH/USD",
    qty: null,
    notional: null,
    rawSymbol: "eth",
  });
});

test("close my btc position", () => {
  assert.deepEqual(parseCommand("close my btc position"), {
    action: "close",
    assetClass: "crypto",
    symbol: "BTC/USD",
    qty: null,
    notional: null,
    rawSymbol: "btc",
  });
});

test("buy btc/usd", () => {
  assert.deepEqual(parseCommand("buy btc/usd"), {
    action: "buy",
    assetClass: "crypto",
    symbol: "BTC/USD",
    qty: null,
    notional: null,
    rawSymbol: "btc/usd",
  });
});

test("shell expansion malformed dollars case", () => {
  assert.throws(
    () => parseCommand("buy 00 share of nvidia"),
    /altered by shell variable expansion/
  );
});
