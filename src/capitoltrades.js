/**
 * Capitol Trades scraper
 *
 * Fetches stock trades for a given politician from capitoltrades.com.
 * The site uses Next.js App Router with React Server Components (RSC),
 * which embeds trade data as escaped JSON inside self.__next_f.push() script tags.
 *
 * Target: Dave McCormick (M001243) — most active trader on the platform.
 */

const BASE_URL = "https://www.capitoltrades.com";

/**
 * Fetches the most recent trades for a politician.
 * Returns ALL trades (including those without a ticker) so the caller can decide what to do.
 *
 * @param {string} politicianId - Capitol Trades ID, e.g. "M001243"
 * @param {number} page - 1-based page number
 * @returns {Promise<Trade[]>}
 */
export async function fetchTrades(politicianId = "M001243", page = 1) {
  const url = `${BASE_URL}/trades?politician=${politicianId}&page=${page}&pageSize=20`;

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!res.ok) {
    throw new Error(
      `Capitol Trades request failed: HTTP ${res.status} ${res.statusText}`
    );
  }

  const html = await res.text();
  return parseTradesFromRsc(html);
}

/**
 * Fetches trades filtered to only stock/ETF trades that can be executed via Alpaca.
 * These are trades where issuerTicker is present.
 *
 * @param {string} politicianId
 * @param {number} page
 * @returns {Promise<Trade[]>}
 */
export async function fetchStockTrades(politicianId = "M001243", page = 1) {
  const all = await fetchTrades(politicianId, page);
  return all.filter((t) => t.ticker !== null);
}

// ---------------------------------------------------------------------------
// RSC payload parser
// ---------------------------------------------------------------------------

/**
 * Extracts trade records from a Capitol Trades HTML page.
 *
 * The site uses Next.js App Router (RSC), which serialises component props
 * as JSON inside <script>self.__next_f.push([1, "...escaped JSON..."])</script> tags.
 * Trade records are embedded as a JSON array that contains objects with a `_txId` field.
 *
 * @param {string} html
 * @returns {Trade[]}
 */
function parseTradesFromRsc(html) {
  // The RSC payload uses \" for quotes inside the escaped string.
  // We look for `[{` immediately before the first `\"_txId\"` occurrence,
  // then walk forward to find the closing `]` of the array.
  const TXID_MARKER = '\\"_txId\\"';
  const firstTxId = html.indexOf(TXID_MARKER);

  if (firstTxId === -1) {
    // No trades on this page (e.g., politician has no trades or we hit the end)
    return [];
  }

  // Walk backward from the first _txId to find the opening [{ of the array
  let arrStart = -1;
  for (let i = firstTxId; i >= 0; i--) {
    if (html[i] === "[" && html[i + 1] === "{") {
      arrStart = i;
      break;
    }
  }

  if (arrStart === -1) {
    throw new Error("Could not locate start of trade array in Capitol Trades HTML");
  }

  // Walk forward to find the matching ] for the array.
  // Inside the RSC payload, quotes are escaped as \" so we skip those.
  // Un-escaped [ ] { } are structural.
  const BACKSLASH_CODE = 92; // char code for backslash
  let depth = 0;
  let arrEnd = arrStart;
  let i = arrStart;
  while (i < html.length) {
    if (html.charCodeAt(i) === BACKSLASH_CODE) {
      i += 2; // skip escaped character
      continue;
    }
    const ch = html[i];
    if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) {
        arrEnd = i;
        break;
      }
    }
    i++;
  }

  const escapedArr = html.slice(arrStart, arrEnd + 1);

  // Unescape: \" → "  and \\ → \
  const json = escapedArr.replace(/\\"/g, '"').replace(/\\\\/g, "\\");

  let rawTrades;
  try {
    rawTrades = JSON.parse(json);
  } catch (e) {
    throw new Error(`Failed to parse Capitol Trades array: ${e.message}`);
  }

  if (!Array.isArray(rawTrades)) {
    throw new Error("Expected trade data to be an array");
  }

  return rawTrades.map(normalizeTrade);
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Normalises a raw Capitol Trades trade object into a consistent shape.
 *
 * Raw field names (from the RSC payload):
 *   _txId, _issuerId, _politicianId, chamber, comment,
 *   issuer { issuerName, issuerTicker, sector, country },
 *   owner, politician { firstName, lastName, nickname, party },
 *   price, pubDate, reportingGap, txDate, txType, txTypeExtended, value
 *
 * @param {object} raw
 * @returns {Trade}
 */
function normalizeTrade(raw) {
  // Ticker: Capitol Trades uses "SYMBOL:US" format — strip the ":US" suffix
  const rawTicker = raw.issuer?.issuerTicker ?? null;
  const ticker = rawTicker ? rawTicker.replace(/:US$/i, "").trim() : null;

  const txType = (raw.txType ?? "").toLowerCase();
  // Capitol Trades uses "buy" / "sell" — but normalise just in case
  const type =
    txType === "purchase" ? "buy" : txType === "sale" ? "sell" : txType;

  const politician = raw.politician;
  const politicianName = politician
    ? `${politician.nickname ?? politician.firstName} ${politician.lastName}`
    : "Unknown";

  return {
    txId: raw._txId ?? null,
    ticker,
    company: raw.issuer?.issuerName ?? null,
    sector: raw.issuer?.sector ?? null,
    type: type || null,
    txDate: raw.txDate ?? null,
    pubDate: raw.pubDate ? raw.pubDate.slice(0, 10) : null, // ISO date only
    reportingGapDays: raw.reportingGap ?? null,
    estimatedValue: raw.value ?? null,
    owner: raw.owner ?? null,
    comment: raw.comment ?? null,
    politician: politicianName,
    politicianId: raw._politicianId ?? null,
    party: politician?.party ?? null,
  };
}

/**
 * @typedef {Object} Trade
 * @property {number|null}  txId               - Unique transaction ID
 * @property {string|null}  ticker             - Stock ticker (null for bonds, etc.)
 * @property {string|null}  company            - Issuer name
 * @property {string|null}  sector             - Sector (if known)
 * @property {string|null}  type               - "buy" | "sell"
 * @property {string|null}  txDate             - Transaction date (YYYY-MM-DD)
 * @property {string|null}  pubDate            - Disclosure date (YYYY-MM-DD)
 * @property {number|null}  reportingGapDays   - Days between trade and disclosure
 * @property {number|null}  estimatedValue     - Estimated dollar value of trade
 * @property {string|null}  owner              - "self" | "spouse" | "dependent"
 * @property {string|null}  comment            - Any notes from the disclosure
 * @property {string}       politician         - Politician name
 * @property {string|null}  politicianId       - Capitol Trades politician ID
 * @property {string|null}  party              - "republican" | "democrat" etc.
 */
