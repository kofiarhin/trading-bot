// Centralised environment config — validated at startup.
// Import this module before anything else that needs env vars.

export const CONFIG_VERSION = "v2";

// Resolve legacy env-var aliases before validation.
// If the canonical key is not set but a legacy alias is, copy the value across.
// This means old .env files keep working without changes.
const ALIAS_MAP = {
  SYMBOLS: "AUTOPILOT_SYMBOLS",
  WATCHLIST: "AUTOPILOT_SYMBOLS",
  TICKERS: "AUTOPILOT_SYMBOLS",
  RISK_PER_TRADE: "RISK_PERCENT",
  MAX_OPEN_POSITIONS: "MAX_POSITIONS",
  LOSS_LIMIT_PCT: "DAILY_LOSS_LIMIT_PCT",
  SCORE_THRESHOLD: "MIN_SETUP_SCORE",
};

export const resolvedAliases = [];

for (const [legacy, canonical] of Object.entries(ALIAS_MAP)) {
  if (process.env[legacy] !== undefined && process.env[canonical] === undefined) {
    process.env[canonical] = process.env[legacy];
    resolvedAliases.push({ from: legacy, to: canonical });
  }
}

const REQUIRED = [
  "ALPACA_API_KEY",
  "ALPACA_API_SECRET",
  "ALPACA_BASE_URL",
  "MONGO_URI",
];

const PAPER_URL = "https://paper-api.alpaca.markets";

function parseCsvSymbols(raw) {
  if (!raw) return [];
  return [...new Set(raw.split(',').map((symbol) => symbol.trim()).filter(Boolean))];
}

function parsePositiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function parsePositiveInt(value, fallback) {
  const numeric = Number.parseInt(value ?? '', 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function loadEnv() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}\n` +
        "Copy .env.example to .env and fill in your Alpaca paper-trading credentials."
    );
  }

  const baseURL = process.env.ALPACA_BASE_URL.replace(/\/$/, "");
  if (baseURL !== PAPER_URL) {
    throw new Error(
      `ALPACA_BASE_URL must be "${PAPER_URL}". Got: "${baseURL}". ` +
        "This bot is paper trading only."
    );
  }

  const trailingAtrMultiplier = parsePositiveNumber(process.env.TRAILING_ATR_MULTIPLIER, 1.5);
  if (!Number.isFinite(trailingAtrMultiplier) || trailingAtrMultiplier <= 0) {
    throw new Error(
      `TRAILING_ATR_MULTIPLIER must be a positive number. Got: "${process.env.TRAILING_ATR_MULTIPLIER}"`
    );
  }

  const maxHoldBars = parsePositiveInt(process.env.MAX_HOLD_BARS, 48);
  if (!Number.isFinite(maxHoldBars) || maxHoldBars <= 0) {
    throw new Error(
      `MAX_HOLD_BARS must be a positive integer. Got: "${process.env.MAX_HOLD_BARS}"`
    );
  }

  return {
    alpaca: {
      key: process.env.ALPACA_API_KEY,
      secret: process.env.ALPACA_API_SECRET,
      baseURL,
      dataURL: "https://data.alpaca.markets",
    },
    mongo: {
      uri: process.env.MONGO_URI ?? null,
    },
    trading: {
      timeframe: process.env.DEFAULT_TIMEFRAME ?? "15Min",
      symbols: parseCsvSymbols(process.env.AUTOPILOT_SYMBOLS),
      riskPercent: parseFloat(process.env.RISK_PERCENT ?? "0.005"),
      maxDailyLossPercent: parseFloat(process.env.MAX_DAILY_LOSS_PERCENT ?? "0.02"),
      // dailyLossLimitPct is the percentage form (e.g. 2 = 2%) used in the
      // execution-guard comparison. DAILY_LOSS_LIMIT_PCT is the canonical name;
      // legacy LOSS_LIMIT_PCT is mapped to it via ALIAS_MAP.
      dailyLossLimitPct: parseFloat(process.env.DAILY_LOSS_LIMIT_PCT ?? "2"),
      // MAX_POSITIONS is the canonical name; legacy MAX_OPEN_POSITIONS maps to it.
      maxOpenPositions: parsePositiveInt(process.env.MAX_POSITIONS, 5),
      maxCandidatesPerCycle: parsePositiveInt(process.env.MAX_CANDIDATES_PER_CYCLE, 3),
      enableStocks: process.env.ENABLE_STOCKS !== "false",
      enableCrypto: process.env.ENABLE_CRYPTO !== "false",
      runMode: process.env.RUN_MODE ?? "paper",
      trailingAtrMultiplier,
      maxHoldBars,
    },
    brokerSync: {
      enableDerivedRisk: process.env.BROKER_SYNC_ENABLE_DERIVED_RISK !== "false",
      stopPct: parseFloat(process.env.BROKER_SYNC_STOP_PCT ?? "0.02"),
      targetRMultiple: parseFloat(process.env.BROKER_SYNC_TARGET_R_MULTIPLE ?? "2"),
    },
  };
}

export const config = loadEnv();
