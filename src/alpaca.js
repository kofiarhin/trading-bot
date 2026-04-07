const REQUIRED_BASE_URL = "https://paper-api.alpaca.markets";

function getConfig() {
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_API_SECRET;
  const baseURL = process.env.ALPACA_BASE_URL;

  if (!key || !secret || !baseURL) {
    throw new Error(
      "Missing required environment variables. " +
        "Set ALPACA_API_KEY, ALPACA_API_SECRET, and ALPACA_BASE_URL in your .env file."
    );
  }

  if (baseURL.replace(/\/$/, "") !== REQUIRED_BASE_URL) {
    throw new Error(
      `ALPACA_BASE_URL must be exactly "${REQUIRED_BASE_URL}". ` +
        `Got: "${baseURL}". This bot is paper trading only.`
    );
  }

  return { key, secret, baseURL: baseURL.replace(/\/$/, "") };
}

async function alpacaFetch(path, options = {}) {
  const { key, secret, baseURL } = getConfig();

  const url = `${baseURL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "APCA-API-KEY-ID": key,
      "APCA-API-SECRET-KEY": secret,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  let body;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  if (!res.ok) {
    const message =
      body?.message ?? body?.error ?? body?.raw ?? "Unknown Alpaca error";
    throw new Error(`Alpaca API error ${res.status}: ${message}`);
  }

  return body;
}

/**
 * Fetches the current open position for a symbol.
 * Returns the position object or null if no position exists.
 * @param {string} symbol
 * @returns {Promise<object|null>}
 */
export async function getPosition(symbol) {
  try {
    const position = await alpacaFetch(`/v2/positions/${symbol}`);
    return position;
  } catch (err) {
    // Alpaca returns 404 when there is no open position
    if (err.message.includes("404")) return null;
    throw err;
  }
}

/**
 * Submits a market order to Alpaca paper trading.
 * Provide either qty (shares) or notional (dollars), not both.
 * @param {{ symbol: string, side: "buy"|"sell", qty?: number, notional?: number }}
 * @returns {Promise<object>}
 */
export async function submitMarketOrder({ symbol, side, qty, notional }) {
  if (!symbol || !side) throw new Error("symbol and side are required.");
  if (qty == null && notional == null)
    throw new Error("Either qty or notional must be provided.");
  if (qty != null && notional != null)
    throw new Error("Provide qty OR notional, not both.");

  const body = {
    symbol,
    side,
    type: "market",
    time_in_force: "day",
  };

  if (qty != null) {
    body.qty = String(qty);
  } else {
    body.notional = String(notional);
  }

  return alpacaFetch("/v2/orders", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
