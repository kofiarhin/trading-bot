import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMarketOrderPayload,
  getPosition,
  submitMarketOrder,
} from "../src/alpaca.js";

function setEnv() {
  process.env.ALPACA_API_KEY = "test-key";
  process.env.ALPACA_API_SECRET = "test-secret";
  process.env.ALPACA_BASE_URL = "https://paper-api.alpaca.markets";
}

test("buildMarketOrderPayload uses gtc for crypto qty orders", () => {
  assert.deepEqual(
    buildMarketOrderPayload({
      symbol: "BTC/USD",
      assetClass: "crypto",
      side: "buy",
      qty: 0.01,
    }),
    {
      symbol: "BTC/USD",
      side: "buy",
      type: "market",
      time_in_force: "gtc",
      qty: "0.01",
    }
  );
});

test("buildMarketOrderPayload uses gtc for crypto notional orders", () => {
  assert.deepEqual(
    buildMarketOrderPayload({
      symbol: "ETH/USD",
      assetClass: "crypto",
      side: "buy",
      notional: 100,
    }),
    {
      symbol: "ETH/USD",
      side: "buy",
      type: "market",
      time_in_force: "gtc",
      notional: "100",
    }
  );
});

test("buildMarketOrderPayload keeps day orders for stocks", () => {
  assert.deepEqual(
    buildMarketOrderPayload({
      symbol: "AAPL",
      assetClass: "stock",
      side: "buy",
      qty: 1,
    }),
    {
      symbol: "AAPL",
      side: "buy",
      type: "market",
      time_in_force: "day",
      qty: "1",
    }
  );
});

test("submitMarketOrder posts crypto payload with gtc", async () => {
  setEnv();

  const originalFetch = global.fetch;
  let request;

  global.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      text: async () => JSON.stringify({ id: "order-123" }),
    };
  };

  try {
    const response = await submitMarketOrder({
      symbol: "BTC/USD",
      assetClass: "crypto",
      side: "buy",
      qty: 0.01,
    });

    assert.deepEqual(response, { id: "order-123" });
    assert.equal(request.url, "https://paper-api.alpaca.markets/v2/orders");
    assert.deepEqual(JSON.parse(request.options.body), {
      symbol: "BTC/USD",
      side: "buy",
      type: "market",
      time_in_force: "gtc",
      qty: "0.01",
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("getPosition encodes crypto symbols in request path", async () => {
  setEnv();

  const originalFetch = global.fetch;
  let requestedUrl;

  global.fetch = async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      text: async () => JSON.stringify({ symbol: "BTC/USD", qty: "0.5" }),
    };
  };

  try {
    const position = await getPosition("BTC/USD");
    assert.deepEqual(position, { symbol: "BTC/USD", qty: "0.5" });
    assert.equal(
      requestedUrl,
      "https://paper-api.alpaca.markets/v2/positions/BTC%2FUSD"
    );
  } finally {
    global.fetch = originalFetch;
  }
});
