export function buildOrderFromIntent({ action, symbol, qty, notional, positionQty }) {
  if (action === "buy") {
    return {
      symbol,
      side: "buy",
      qty: qty ?? null,
      notional: notional ?? null,
    };
  }

  const normalizedPositionQty = Number(positionQty);
  if (!Number.isFinite(normalizedPositionQty) || normalizedPositionQty <= 0) {
    throw new Error(`Position quantity for ${symbol} is invalid (${positionQty}). Order not placed.`);
  }

  if (action === "close") {
    return {
      symbol,
      side: "sell",
      qty: normalizedPositionQty,
      notional: null,
    };
  }

  if (qty != null) {
    if (qty > normalizedPositionQty) {
      throw new Error(
        `Cannot sell ${qty} shares of ${symbol}; only ${normalizedPositionQty} shares are open.`
      );
    }

    return {
      symbol,
      side: "sell",
      qty,
      notional: null,
    };
  }

  return {
    symbol,
    side: "sell",
    qty: normalizedPositionQty,
    notional: null,
  };
}

export function formatSummary({ action, symbol, qty, notional, positionQty }) {
  if (action === "buy") {
    if (notional != null) return `BUY ${symbol} — notional $${notional}`;
    return `BUY ${symbol} — ${qty} share${qty !== 1 ? "s" : ""}`;
  }

  if (action === "close") {
    return `SELL ${symbol} — ${positionQty} share${positionQty !== 1 ? "s" : ""} (full position)`;
  }

  if (qty != null) {
    return `SELL ${symbol} — ${qty} share${qty !== 1 ? "s" : ""}`;
  }

  return `SELL ${symbol} — ${positionQty} share${positionQty !== 1 ? "s" : ""} (full position)`;
}
