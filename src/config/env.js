// Centralised environment config — validated at startup.
// Import this module before anything else that needs env vars.

const REQUIRED = [
  "ALPACA_API_KEY",
  "ALPACA_API_SECRET",
  "ALPACA_BASE_URL",
  "MONGO_URI",
];

const PAPER_URL = "https://paper-api.alpaca.markets";

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

  const trailingAtrMultiplier = parseFloat(process.env.TRAILING_ATR_MULTIPLIER ?? "1.5");
  if (!Number.isFinite(trailingAtrMultiplier) || trailingAtrMultiplier <= 0) {
    throw new Error(
      `TRAILING_ATR_MULTIPLIER must be a positive number. Got: "${process.env.TRAILING_ATR_MULTIPLIER}"`
    );
  }

  const maxHoldBars = parseInt(process.env.MAX_HOLD_BARS ?? "48", 10);
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
      riskPercent: parseFloat(process.env.RISK_PERCENT ?? "0.005"),
      maxDailyLossPercent: parseFloat(process.env.MAX_DAILY_LOSS_PERCENT ?? "0.02"),
      maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS ?? "5", 10),
      enableStocks: process.env.ENABLE_STOCKS !== "false",
      enableCrypto: process.env.ENABLE_CRYPTO !== "false",
      runMode: process.env.RUN_MODE ?? "paper",
      trailingAtrMultiplier,
      maxHoldBars,
    },
  };
}

export const config = loadEnv();
