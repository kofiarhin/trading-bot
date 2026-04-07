// Maps company names and aliases to ticker symbols.
// All keys must be lowercase for case-insensitive matching.
const SYMBOL_MAP = {
  apple: "AAPL",
  aapl: "AAPL",

  tesla: "TSLA",
  tsla: "TSLA",

  microsoft: "MSFT",
  msft: "MSFT",

  amazon: "AMZN",
  amzn: "AMZN",

  google: "GOOGL",
  alphabet: "GOOGL",
  googl: "GOOGL",
  goog: "GOOGL",

  meta: "META",
  facebook: "META",
  fb: "META",

  nvidia: "NVDA",
  nvda: "NVDA",
};

/**
 * Resolves a company name or ticker alias to an uppercase ticker symbol.
 * Returns null if the name cannot be resolved.
 * @param {string} name
 * @returns {string|null}
 */
export function resolveSymbol(name) {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  return SYMBOL_MAP[key] ?? null;
}
