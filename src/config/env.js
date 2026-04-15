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
  MAX_POSITIONS: "MAX_OPEN_POSITIONS",
  LOSS_LIMIT_PCT: "MAX_DAILY_LOSS_PERCENT",
  DAILY_LOSS_LIMIT_PCT: "MAX_DAILY_LOSS_PERCENT",
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

function parseBoolean(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
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

  const canonical = {
    MAX_OPEN_POSITIONS: parsePositiveInt(process.env.MAX_OPEN_POSITIONS, 5),
    MAX_DAILY_LOSS_PERCENT: parsePositiveNumber(process.env.MAX_DAILY_LOSS_PERCENT, 2),
    MAX_CANDIDATES_PER_CYCLE: parsePositiveInt(process.env.MAX_CANDIDATES_PER_CYCLE, 3),
    ENABLE_STOCKS: parseBoolean(process.env.ENABLE_STOCKS, true),
    ENABLE_CRYPTO: parseBoolean(process.env.ENABLE_CRYPTO, true),
    AUTOPILOT_SYMBOLS: parseCsvSymbols(process.env.AUTOPILOT_SYMBOLS),
    PREFILTER_MIN_BARS: parsePositiveInt(process.env.PREFILTER_MIN_BARS, 22),
    PREFILTER_MIN_VOL_RATIO: parsePositiveNumber(process.env.PREFILTER_MIN_VOL_RATIO, 1.2),
    PREFILTER_MIN_RANGE_ATR_MULTIPLE: parsePositiveNumber(process.env.PREFILTER_MIN_RANGE_ATR_MULTIPLE, 1),
    PREFILTER_MAX_DISTANCE_TO_BREAKOUT_PCT: parsePositiveNumber(process.env.PREFILTER_MAX_DISTANCE_TO_BREAKOUT_PCT, 1.0),
    BREAKOUT_CONFIRMATION_PCT: Number.isFinite(Number(process.env.BREAKOUT_CONFIRMATION_PCT))
      ? Number(process.env.BREAKOUT_CONFIRMATION_PCT)
      : 0,
    MAX_TOTAL_RISK_PCT: parsePositiveNumber(process.env.MAX_TOTAL_RISK_PCT, 5),
    MAX_CORRELATED_POSITIONS: parsePositiveInt(process.env.MAX_CORRELATED_POSITIONS, 3),
    DRAWDOWN_THROTTLE_PCT: parsePositiveNumber(process.env.DRAWDOWN_THROTTLE_PCT, 1),
    MAX_HOLD_BARS: maxHoldBars,
    TRAILING_ATR_MULTIPLIER: trailingAtrMultiplier,
  };

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
      symbols: canonical.AUTOPILOT_SYMBOLS,
      riskPercent: parseFloat(process.env.RISK_PERCENT ?? "0.005"),
      maxDailyLossPercent: canonical.MAX_DAILY_LOSS_PERCENT / 100,
      // dailyLossLimitPct is the percentage form (e.g. 2 = 2%) used in execution guards.
      dailyLossLimitPct: canonical.MAX_DAILY_LOSS_PERCENT,
      maxOpenPositions: canonical.MAX_OPEN_POSITIONS,
      maxCandidatesPerCycle: canonical.MAX_CANDIDATES_PER_CYCLE,
      enableStocks: canonical.ENABLE_STOCKS,
      enableCrypto: canonical.ENABLE_CRYPTO,
      runMode: process.env.RUN_MODE ?? "paper",
      trailingAtrMultiplier: canonical.TRAILING_ATR_MULTIPLIER,
      maxHoldBars: canonical.MAX_HOLD_BARS,
    },
    prefilter: {
      minBars: canonical.PREFILTER_MIN_BARS,
      minVolRatio: canonical.PREFILTER_MIN_VOL_RATIO,
      minRangeAtrMultiple: canonical.PREFILTER_MIN_RANGE_ATR_MULTIPLE,
      maxDistanceToBreakoutPct: canonical.PREFILTER_MAX_DISTANCE_TO_BREAKOUT_PCT,
    },
    strategy: {
      breakoutConfirmationPct: canonical.BREAKOUT_CONFIRMATION_PCT,
    },
    risk: {
      maxTotalRiskPct: canonical.MAX_TOTAL_RISK_PCT,
      maxCorrelatedPositions: canonical.MAX_CORRELATED_POSITIONS,
      drawdownThrottlePct: canonical.DRAWDOWN_THROTTLE_PCT,
    },
    brokerSync: {
      enableDerivedRisk: process.env.BROKER_SYNC_ENABLE_DERIVED_RISK !== "false",
      stopPct: parseFloat(process.env.BROKER_SYNC_STOP_PCT ?? "0.02"),
      targetRMultiple: parseFloat(process.env.BROKER_SYNC_TARGET_R_MULTIPLE ?? "2"),
    },
    canonical,
  };
}

export const config = loadEnv();
