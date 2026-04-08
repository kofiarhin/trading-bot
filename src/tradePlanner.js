function formatQuantity(assetClass, qty) {
  const label = assetClass === "crypto" ? "unit" : "share";
  return `${qty} ${label}${qty !== 1 ? "s" : ""}`;
}

export function buildOrderFromIntent({
  action,
  assetClass = "stock",
  symbol,
  qty,
  notional,
  positionQty,
}) {
  if (action === "buy") {
    if (qty == null && notional == null) {
      const quantityExample =
        assetClass === "crypto" ? `buy 0.01 ${symbol}` : `buy 1 share of ${symbol}`;

      throw new Error(
        `Buy order for ${symbol} requires a quantity or dollar amount. ` +
          `Try: "${quantityExample}"` +
          ` or "buy $100 of ${symbol}".`
      );
    }

    return {
      assetClass,
      symbol,
      side: "buy",
      qty: qty ?? null,
      notional: notional ?? null,
    };
  }

  if (notional != null) {
    if (assetClass === "crypto") {
      throw new Error(
        `Crypto sell orders do not support notional amounts. ` +
          `Use a quantity or close the full ${symbol} position.`
      );
    }

    throw new Error(
      `Sell orders do not support dollar amounts. ` +
        `Use a share quantity or sell the full ${symbol} position.`
    );
  }

  const normalizedPositionQty = Number(positionQty);
  if (!Number.isFinite(normalizedPositionQty) || normalizedPositionQty <= 0) {
    throw new Error(`Position quantity for ${symbol} is invalid (${positionQty}). Order not placed.`);
  }

  if (action === "close") {
    return {
      assetClass,
      symbol,
      side: "sell",
      qty: normalizedPositionQty,
      notional: null,
    };
  }

  if (qty != null) {
    if (qty > normalizedPositionQty) {
      const label = assetClass === "crypto" ? "units" : "shares";

      throw new Error(
        `Cannot sell ${qty} ${label} of ${symbol}; only ${normalizedPositionQty} ${label} are open.`
      );
    }

    return {
      assetClass,
      symbol,
      side: "sell",
      qty,
      notional: null,
    };
  }

  return {
    assetClass,
    symbol,
    side: "sell",
    qty: normalizedPositionQty,
    notional: null,
  };
}

export function formatSummary({ action, assetClass = "stock", symbol, qty, notional, positionQty }) {
  if (action === "buy") {
    if (notional != null) return `BUY ${symbol} — notional $${notional}`;
    return `BUY ${symbol} — ${formatQuantity(assetClass, qty)}`;
  }

  if (action === "close") {
    return `SELL ${symbol} — ${formatQuantity(assetClass, positionQty)} (full position)`;
  }

  if (qty != null) {
    return `SELL ${symbol} — ${formatQuantity(assetClass, qty)}`;
  }

  return `SELL ${symbol} — ${formatQuantity(assetClass, positionQty)} (full position)`;
}
