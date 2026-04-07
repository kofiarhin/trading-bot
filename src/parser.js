import { resolveSymbol } from "./symbols.js";

function buildShellExpansionError() {
  return (
    "It looks like your dollar amount was altered by shell variable expansion (for example, `$200` became `00`). " +
    "In bash/git bash, `$...` is expanded unless escaped or single-quoted. " +
    "Use one of:\n" +
    "- npm run trade -- 'buy $200 of nvidia'\n" +
    "- npm run trade -- \"buy \\$200 of nvidia\"\n" +
    "- npm run trade -- \"buy 200 dollars of nvidia\""
  );
}

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

  if (/^(exit|quit|q)$/.test(raw)) {
    return { action: "exit", symbol: null, qty: null, notional: null };
  }

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

  let action;
  if (/\bclose\b/.test(raw)) {
    action = "close";
  } else if (hasSell) {
    action = "sell";
  } else {
    action = "buy";
  }

  if (
    action === "buy" &&
    /\bbuy\s+0{2,}(?:\.0+)?\s+(?:share|shares|of|dollars?)\b/.test(raw)
  ) {
    throw new Error(buildShellExpansionError());
  }

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

  let qty = null;
  if (!notional) {
    const qtyMatch =
      raw.match(/(\d+(?:\.\d+)?)\s+shares?\b/) ||
      raw.match(/\bbuy\s+(\d+(?:\.\d+)?)\b/) ||
      raw.match(/\bsell\s+(\d+(?:\.\d+)?)\b/);

    if (qtyMatch) {
      qty = parseFloat(qtyMatch[1]);
      if (isNaN(qty) || qty <= 0) {
        throw new Error(`Invalid share quantity in: "${input}"`);
      }
    }
  }

  const cleaned = raw
    .replace(/\$\s*\d+(?:\.\d+)?/, "")
    .replace(/\d+(?:\.\d+)?\s*dollars?/, "")
    .replace(/\d+(?:\.\d+)?\s*shares?/, "")
    .replace(/\b(buy|sell|close|my|position|stock|shares?|of|a|the|some)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

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

  if (action === "buy" && qty === null && notional === null) {
    throw new Error(
      `Buy command requires a share quantity or dollar amount. ` +
        `Try: "buy 1 share of ${symbol}" or "buy $100 of ${symbol}".`
    );
  }

  return { action, symbol, qty, notional };
}
