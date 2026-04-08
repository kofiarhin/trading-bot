// Centralised environment config — validated at startup.
// Import this module before anything else that needs env vars.

const REQUIRED = [
  "ALPACA_API_KEY",
  "ALPACA_API_SECRET",
  "ALPACA_BASE_URL",
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
      maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS ?? "3", 10),
      enableCrypto: process.env.ENABLE_CRYPTO === "true",
      runMode: process.env.RUN_MODE ?? "paper",
    },
  };
}

export const config = loadEnv();
