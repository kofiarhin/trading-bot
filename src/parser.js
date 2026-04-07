import { resolveSymbol } from "./symbols.js";

/**
 * Parses a natural language trading command into a structured intent.
 *
 * Returns:
 *   { action, symbol, qty, notional }
 *   action: "buy" | "sell" | "close" | "exit"
 *
 * Throws a descriptive Error on ambiguous or invalid input.
 */
export function parseCommand(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("No command provided.");
  }

  const raw = input.trim().toLowerCase();

  // Detect exit intent first
  if (/^(exit|quit|q)$/.test(raw)) {
    return { action: "exit", symbol: null, qty: null, notional: null };
  }

  // Detect buy and sell presence
  const hasBuy = /\bbuy\b/.test(raw);
  const hasSell = /\b(sell|close)\b/.test(raw);

  if (hasBuy && hasSell) {
    throw new Error(
      `Ambiguous command — contains both buy and sell intent: "${input}"`
    );
  }

  if (!hasBuy && !hasSell) {
    throw new Error(
      `Could not detect a buy, sell, or close action in: "${input}"`
    );
  }

  // Determine action
  let action;
  if (/\bclose\b/.test(raw)) {
    action = "close";
  } else if (hasSell) {
    action = "sell";
  } else {
    action = "buy";
  }

  // Extract notional dollar amount: "$50", "50 dollars", "$50.00"
  let notional = null;
  const notionalMatch =
    raw.match(/\$\s*(\d+(?:\.\d+)?)/) ||
    raw.match(/(\d+(?:\.\d+)?)\s*dollars?\b/);
  if (notionalMatch) {
    notional = parseFloat(notionalMatch[1]);
    if (isNaN(notional) || notional <= 0) {
      throw new Error(`Invalid dollar amount in: "${input}"`);
    }
  }

  // Extract share quantity: "2 shares", "1 share", standalone integer before
  // or after "of", but not when it's part of a dollar amount already captured.
  let qty = null;
  if (!notional) {
    // "2 shares of ...", "1 share of ...", "buy 3 apple"
    const qtyMatch =
      raw.match(/(\d+(?:\.\d+)?)\s+shares?\b/) ||
      raw.match(/\b(\d+(?:\.\d+)?)\s+(?:of\s+)?\w+\s+stock\b/) ||
      raw.match(/\bbuy\s+(\d+(?:\.\d+)?)\b/) ||
      raw.match(/\bsell\s+(\d+(?:\.\d+)?)\b/);
    if (qtyMatch) {
      qty = parseFloat(qtyMatch[1]);
      if (isNaN(qty) || qty <= 0) {
        throw new Error(`Invalid share quantity in: "${input}"`);
      }
    }
  }

  // Extract company name / ticker.
  // Strip action words, quantity markers, and filler words, then match what remains.
  const cleaned = raw
    .replace(/\$\s*\d+(?:\.\d+)?/, "") // strip dollar amounts
    .replace(/\d+(?:\.\d+)?\s*dollars?/, "") // strip "X dollars"
    .replace(/\d+(?:\.\d+)?\s*shares?/, "") // strip "X shares"
    .replace(/\b(buy|sell|close|my|position|stock|shares?|of|a|the|some)\b/g, "") // filler
    .replace(/\s+/g, " ")
    .trim();

  // Attempt to find a resolvable token in the cleaned string
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  let symbol = null;

  for (const token of tokens) {
    const resolved = resolveSymbol(token);
    if (resolved) {
      symbol = resolved;
      break;
    }
  }

  if (!symbol) {
    throw new Error(
      `Could not resolve a known stock symbol from: "${input}". ` +
        `Supported companies: Apple, Tesla, Microsoft, Amazon, Google, Meta, Nvidia (or their tickers).`
    );
  }

  // Guardrail: buy without qty or notional is ambiguous
  if (action === "buy" && qty === null && notional === null) {
    throw new Error(
      `Buy command requires a share quantity or dollar amount. ` +
        `Try: "buy 1 share of ${symbol}" or "buy $100 of ${symbol}".`
    );
  }

  return { action, symbol, qty, notional };
}
