import test from "node:test";
import assert from "node:assert/strict";
import { buildOrderFromIntent, formatSummary } from "../src/tradePlanner.js";

test("crypto buy quantity is supported", () => {
  assert.deepEqual(
    buildOrderFromIntent({
      action: "buy",
      assetClass: "crypto",
      symbol: "BTC/USD",
      qty: 0.01,
      notional: null,
      positionQty: null,
    }),
    {
      assetClass: "crypto",
      symbol: "BTC/USD",
      side: "buy",
      qty: 0.01,
      notional: null,
    }
  );
});

test("crypto buy notional is supported", () => {
  assert.deepEqual(
    buildOrderFromIntent({
      action: "buy",
      assetClass: "crypto",
      symbol: "ETH/USD",
      qty: null,
      notional: 100,
      positionQty: null,
    }),
    {
      assetClass: "crypto",
      symbol: "ETH/USD",
      side: "buy",
      qty: null,
      notional: 100,
    }
  );
});

test("crypto sell without quantity liquidates full position", () => {
  assert.deepEqual(
    buildOrderFromIntent({
      action: "sell",
      assetClass: "crypto",
      symbol: "ETH/USD",
      qty: null,
      notional: null,
      positionQty: 0.75,
    }),
    {
      assetClass: "crypto",
      symbol: "ETH/USD",
      side: "sell",
      qty: 0.75,
      notional: null,
    }
  );
});

test("crypto close liquidates full position", () => {
  assert.deepEqual(
    buildOrderFromIntent({
      action: "close",
      assetClass: "crypto",
      symbol: "BTC/USD",
      qty: null,
      notional: null,
      positionQty: 0.25,
    }),
    {
      assetClass: "crypto",
      symbol: "BTC/USD",
      side: "sell",
      qty: 0.25,
      notional: null,
    }
  );
});

test("crypto sell rejects notional orders", () => {
  assert.throws(
    () =>
      buildOrderFromIntent({
        action: "sell",
        assetClass: "crypto",
        symbol: "BTC/USD",
        qty: null,
        notional: 50,
        positionQty: 0.5,
      }),
    /do not support notional amounts/
  );
});

test("crypto buy without qty or notional is rejected by planner", () => {
  assert.throws(
    () =>
      buildOrderFromIntent({
        action: "buy",
        assetClass: "crypto",
        symbol: "BTC/USD",
        qty: null,
        notional: null,
        positionQty: null,
      }),
    /requires a quantity or dollar amount/
  );
});

test("crypto summaries use unit wording", () => {
  assert.equal(
    formatSummary({
      action: "close",
      assetClass: "crypto",
      symbol: "BTC/USD",
      qty: null,
      notional: null,
      positionQty: 0.5,
    }),
    "SELL BTC/USD — 0.5 units (full position)"
  );
});
