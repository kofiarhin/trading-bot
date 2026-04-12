// Worker — runs the autopilot cycle every 15 minutes.
// Waits for the next closed 15-minute candle boundary before each run.
// Usage: node src/worker15m.js
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { connectMongo } from "./db/connectMongo.js";
import { msUntilNext15Min } from "./utils/time.js";
import { logger } from "./utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTOPILOT = resolve(__dirname, "autopilot.js");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runCycle() {
  logger.info("Running autopilot cycle from worker");

  const result = spawnSync(process.execPath, [AUTOPILOT], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    logger.error("Worker: cycle process error", { error: result.error.message });
  } else if (result.status !== 0) {
    logger.error("Worker: cycle exited with non-zero status", { status: result.status });
  }
}

async function main() {
  await connectMongo();
  logger.info("Worker started — will run autopilot every 15 minutes");
  logger.info("Press Ctrl+C to stop");

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const waitMs = msUntilNext15Min();
    const waitSec = Math.ceil(waitMs / 1000);
    logger.info(`Waiting ${waitSec}s until next 15-minute boundary`);
    await sleep(waitMs);

    await runCycle();
  }
}

main().catch((err) => {
  logger.error("Worker crashed", { error: err.message });
  process.exit(1);
});
