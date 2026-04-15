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

function parseNonNegativeNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
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

function canonicalFromEnv() {
  return {
    MAX_OPEN_POSITIONS: parsePositiveInt(process.env.MAX_OPEN_POSITIONS, 5),
    MAX_DAILY_LOSS_PERCENT: parsePositiveNumber(process.env.MAX_DAILY_LOSS_PERCENT, 2),
    MAX_CANDIDATES_PER_CYCLE: parsePositiveInt(process.env.MAX_CANDIDATES_PER_CYCLE, 3),
    ENABLE_STOCKS: parseBoolean(process.env.ENABLE_STOCKS, true),
    ENABLE_CRYPTO: parseBoolean(process.env.ENABLE_CRYPTO, true),
    AUTOPILOT_SYMBOLS: parseCsvSymbols(process.env.AUTOPILOT_SYMBOLS),

    BREAKOUT_LOOKBACK: parsePositiveInt(process.env.BREAKOUT_LOOKBACK, 20),
    VOLUME_LOOKBACK: parsePositiveInt(process.env.VOLUME_LOOKBACK, 20),
    ATR_PERIOD: parsePositiveInt(process.env.ATR_PERIOD, 14),

    PREFILTER_MIN_BARS: parsePositiveInt(process.env.PREFILTER_MIN_BARS, 22),
    PREFILTER_MIN_VOL_RATIO: parsePositiveNumber(process.env.PREFILTER_MIN_VOL_RATIO, 1.2),
    PREFILTER_MIN_RANGE_ATR_MULTIPLE: parsePositiveNumber(process.env.PREFILTER_MIN_RANGE_ATR_MULTIPLE, 1),
    PREFILTER_MAX_DISTANCE_TO_BREAKOUT_PCT: parsePositiveNumber(process.env.PREFILTER_MAX_DISTANCE_TO_BREAKOUT_PCT, 1.0),

    ATR_MULTIPLIER: parsePositiveNumber(process.env.ATR_MULTIPLIER, 1.5),
    TARGET_MULTIPLE: parsePositiveNumber(process.env.TARGET_MULTIPLE, 2),
    MIN_VOL_RATIO: parsePositiveNumber(process.env.MIN_VOL_RATIO, 1.2),
    MIN_ATR: parsePositiveNumber(process.env.MIN_ATR, 0.25),
    MIN_RISK_REWARD: parsePositiveNumber(process.env.MIN_RISK_REWARD, 1.5),
    BREAKOUT_CONFIRMATION_PCT: parseNonNegativeNumber(process.env.BREAKOUT_CONFIRMATION_PCT, 0),
    BREAKOUT_NEAR_MISS_PCT: parseNonNegativeNumber(process.env.BREAKOUT_NEAR_MISS_PCT, 0.5),

    MIN_SETUP_SCORE: parseNonNegativeNumber(process.env.MIN_SETUP_SCORE, 0),
    MIN_SETUP_SCORE_TOKYO: parseNonNegativeNumber(process.env.MIN_SETUP_SCORE_TOKYO, 0),
    MIN_SETUP_SCORE_LONDON: parseNonNegativeNumber(process.env.MIN_SETUP_SCORE_LONDON, 0),
    MIN_SETUP_SCORE_NEW_YORK: parseNonNegativeNumber(process.env.MIN_SETUP_SCORE_NEW_YORK, 0),

    MAX_TOTAL_RISK_PCT: parsePositiveNumber(process.env.MAX_TOTAL_RISK_PCT, 5),
    MAX_CORRELATED_POSITIONS: parsePositiveInt(process.env.MAX_CORRELATED_POSITIONS, 3),
    DRAWDOWN_THROTTLE_PCT: parsePositiveNumber(process.env.DRAWDOWN_THROTTLE_PCT, 1),
    MAX_HOLD_BARS: parsePositiveInt(process.env.MAX_HOLD_BARS, 48),
    TRAILING_ATR_MULTIPLIER: parsePositiveNumber(process.env.TRAILING_ATR_MULTIPLIER, 1.5),
  };
}

function loadEnv() {
  const isTestEnv = process.env.NODE_ENV === "test";
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (!isTestEnv && missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}\n` +
        "Copy .env.example to .env and fill in your Alpaca paper-trading credentials."
    );
  }

  const baseURL = (process.env.ALPACA_BASE_URL ?? PAPER_URL).replace(/\/$/, "");
  if (!isTestEnv && baseURL !== PAPER_URL) {
    throw new Error(
      `ALPACA_BASE_URL must be "${PAPER_URL}". Got: "${baseURL}". ` +
        "This bot is paper trading only."
    );
  }

  const canonical = canonicalFromEnv();

  return {
    alpaca: {
      key: process.env.ALPACA_API_KEY ?? "test",
      secret: process.env.ALPACA_API_SECRET ?? "test",
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
      breakoutLookback: canonical.BREAKOUT_LOOKBACK,
      volumeLookback: canonical.VOLUME_LOOKBACK,
      atrPeriod: canonical.ATR_PERIOD,
      breakoutNearMissPct: canonical.BREAKOUT_NEAR_MISS_PCT,
    },
    strategy: {
      breakoutLookback: canonical.BREAKOUT_LOOKBACK,
      volumeLookback: canonical.VOLUME_LOOKBACK,
      atrPeriod: canonical.ATR_PERIOD,
      atrMultiplier: canonical.ATR_MULTIPLIER,
      targetMultiple: canonical.TARGET_MULTIPLE,
      minVolRatio: canonical.MIN_VOL_RATIO,
      minAtr: canonical.MIN_ATR,
      minRiskReward: canonical.MIN_RISK_REWARD,
      breakoutConfirmationPct: canonical.BREAKOUT_CONFIRMATION_PCT,
      breakoutNearMissPct: canonical.BREAKOUT_NEAR_MISS_PCT,
      minSetupScore: canonical.MIN_SETUP_SCORE,
      minSetupScoreTokyo: canonical.MIN_SETUP_SCORE_TOKYO,
      minSetupScoreLondon: canonical.MIN_SETUP_SCORE_LONDON,
      minSetupScoreNewYork: canonical.MIN_SETUP_SCORE_NEW_YORK,
    },
    risk: {
      maxOpenPositions: canonical.MAX_OPEN_POSITIONS,
      maxDailyLossPercent: canonical.MAX_DAILY_LOSS_PERCENT,
      maxTotalRiskPct: canonical.MAX_TOTAL_RISK_PCT,
      maxCorrelatedPositions: canonical.MAX_CORRELATED_POSITIONS,
      drawdownThrottlePct: canonical.DRAWDOWN_THROTTLE_PCT,
      maxHoldBars: canonical.MAX_HOLD_BARS,
      trailingAtrMultiplier: canonical.TRAILING_ATR_MULTIPLIER,
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
