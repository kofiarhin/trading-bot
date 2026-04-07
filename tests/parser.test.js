import test from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "../src/parser.js";

test("buy 1 share of apple", () => {
  assert.deepEqual(parseCommand("buy 1 share of apple"), {
    action: "buy",
    symbol: "AAPL",
    qty: 1,
    notional: null,
  });
});

test("buy 2 shares of tesla", () => {
  assert.deepEqual(parseCommand("buy 2 shares of tesla"), {
    action: "buy",
    symbol: "TSLA",
    qty: 2,
    notional: null,
  });
});

test("buy $100 of apple", () => {
  assert.deepEqual(parseCommand("buy $100 of apple"), {
    action: "buy",
    symbol: "AAPL",
    qty: null,
    notional: 100,
  });
});

test("buy 200 dollars of apple", () => {
  assert.deepEqual(parseCommand("buy 200 dollars of apple"), {
    action: "buy",
    symbol: "AAPL",
    qty: null,
    notional: 200,
  });
});

test("buy $200 share of nvidia", () => {
  assert.deepEqual(parseCommand("buy $200 share of nvidia"), {
    action: "buy",
    symbol: "NVDA",
    qty: null,
    notional: 200,
  });
});

test("sell 2 shares of apple", () => {
  assert.deepEqual(parseCommand("sell 2 shares of apple"), {
    action: "sell",
    symbol: "AAPL",
    qty: 2,
    notional: null,
  });
});

test("sell apple stock", () => {
  assert.deepEqual(parseCommand("sell apple stock"), {
    action: "sell",
    symbol: "AAPL",
    qty: null,
    notional: null,
  });
});

test("close my apple position", () => {
  assert.deepEqual(parseCommand("close my apple position"), {
    action: "close",
    symbol: "AAPL",
    qty: null,
    notional: null,
  });
});

test("close my aapl position", () => {
  assert.deepEqual(parseCommand("close my aapl position"), {
    action: "close",
    symbol: "AAPL",
    qty: null,
    notional: null,
  });
});

test("shell expansion malformed dollars case", () => {
  assert.throws(
    () => parseCommand("buy 00 share of nvidia"),
    /altered by shell variable expansion/
  );
});
