import test from "node:test";
import assert from "node:assert/strict";
import { buildOrderFromIntent } from "../src/tradePlanner.js";

test("sell quantity is respected when provided", () => {
  assert.deepEqual(
    buildOrderFromIntent({
      action: "sell",
      assetClass: "stock",
      symbol: "AAPL",
      qty: 2,
      notional: null,
      positionQty: 10,
    }),
    {
      assetClass: "stock",
      symbol: "AAPL",
      side: "sell",
      qty: 2,
      notional: null,
    }
  );
});

test("sell full position when quantity not provided", () => {
  assert.deepEqual(
    buildOrderFromIntent({
      action: "sell",
      assetClass: "stock",
      symbol: "AAPL",
      qty: null,
      notional: null,
      positionQty: 10,
    }),
    {
      assetClass: "stock",
      symbol: "AAPL",
      side: "sell",
      qty: 10,
      notional: null,
    }
  );
});

test("close always liquidates full position", () => {
  assert.deepEqual(
    buildOrderFromIntent({
      action: "close",
      assetClass: "stock",
      symbol: "TSLA",
      qty: null,
      notional: null,
      positionQty: 7,
    }),
    {
      assetClass: "stock",
      symbol: "TSLA",
      side: "sell",
      qty: 7,
      notional: null,
    }
  );
});
