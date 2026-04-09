// Trade events store — lifecycle event log for all trade journal activity.
// Stored in storage/trades/events.json
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { logger } from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRADES_DIR = resolve(__dirname, "../../storage/trades");
const EVENTS_PATH = resolve(TRADES_DIR, "events.json");

function ensureDir() {
  if (!existsSync(TRADES_DIR)) mkdirSync(TRADES_DIR, { recursive: true });
}

function readEvents() {
  if (!existsSync(EVENTS_PATH)) return [];
  try {
    const parsed = JSON.parse(readFileSync(EVENTS_PATH, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    logger.error("Failed to read trade events", { error: err.message });
    return [];
  }
}

export function getTradeEvents() {
  return readEvents();
}

/**
 * Appends a trade lifecycle event record.
 *
 * @param {{
 *   tradeId: string,
 *   symbol: string,
 *   type: string,  one of the allowed event types
 *   message: string,
 *   data?: object,
 * }} event
 * @returns {object} The saved event record
 */
export function appendTradeEvent(event) {
  ensureDir();
  const events = readEvents();
  const record = {
    eventId: randomUUID(),
    tradeId: event.tradeId,
    symbol: event.symbol,
    type: event.type,
    message: event.message ?? "",
    timestamp: new Date().toISOString(),
    data: event.data ?? null,
  };
  events.push(record);
  try {
    writeFileSync(EVENTS_PATH, JSON.stringify(events, null, 2), "utf-8");
  } catch (err) {
    logger.error("Failed to write trade event", { error: err.message, type: event.type });
    throw err;
  }
  return record;
}
