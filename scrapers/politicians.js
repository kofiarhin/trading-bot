// scraper/capitolTradesCrawler.js
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PlaywrightCrawler, Dataset, log } from "crawlee";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT_DIR, "_suggested_trade");
const START_URL = "https://www.capitoltrades.com/politicians";
const OUTPUT_FILE = "politicians.json";

const SELECTORS = {
  politicianCards: 'a.index-card-link[href^="/politicians/"]',
  detailTableRows: "table tbody tr, tr[data-state]",
};

const MONTH_MAP = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

function cleanText(value) {
  return value?.replace(/\s+/g, " ").trim() || null;
}

function normalizeTicker(value) {
  const ticker = cleanText(value);
  if (!ticker || ticker.toUpperCase() === "N/A") return null;
  return ticker;
}

function normalizeTradeType(value) {
  const type = cleanText(value)?.toLowerCase() || null;
  if (!type) return null;

  const allowed = new Set(["buy", "sell", "exchange"]);
  return allowed.has(type) ? type : type;
}

function normalizeDate(value) {
  const raw = cleanText(value);
  if (!raw) return null;

  const compact = raw.replace(/\s+/g, " ");
  const match = compact.match(/^(\d{1,2})\s+([A-Za-z]+)\s*(\d{4})$/);

  if (!match) return raw;

  const [, dayRaw, monthRaw, year] = match;
  const month = MONTH_MAP[monthRaw.toLowerCase()];
  if (!month) return raw;

  const day = dayRaw.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function ensureOutputDir() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

async function writeJsonFile(filename, data) {
  const filePath = path.join(OUTPUT_DIR, filename);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  return filePath;
}

async function extractListingCards(page) {
  return page.$$eval(SELECTORS.politicianCards, (anchors) =>
    anchors.map((anchor) => {
      const text = (selector) => {
        const el = anchor.querySelector(selector);
        return el ? el.textContent.replace(/\s+/g, " ").trim() : null;
      };

      const href = anchor.getAttribute("href");
      const url = href
        ? new URL(href, window.location.origin).toString()
        : null;

      return {
        profileUrl: url,
        profilePath: href,
        name: text("section.index-card-body h2.font-medium.leading-snug"),
      };
    }),
  );
}

async function extractDetailHeader(page) {
  const header = await page.evaluate(() => {
    const headerName =
      document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() ||
      document
        .querySelector("h2.font-medium.leading-snug")
        ?.textContent?.replace(/\s+/g, " ")
        .trim() ||
      null;

    return {
      name: headerName,
    };
  });

  return {
    name: cleanText(header.name),
  };
}

async function extractTradeRowsFromCurrentPage(page) {
  const rows = await page.$$eval(SELECTORS.detailTableRows, (trs) =>
    trs.map((tr) => {
      const cellTexts = Array.from(tr.querySelectorAll("td")).map((td) =>
        td.textContent.replace(/\s+/g, " ").trim(),
      );

      const issuerName =
        tr
          .querySelector("h3.q-fieldset.issuer-name, .issuer-name")
          ?.textContent?.replace(/\s+/g, " ")
          .trim() || null;

      const issuerTicker =
        tr
          .querySelector("span.q-field.issuer-ticker, .issuer-ticker")
          ?.textContent?.replace(/\s+/g, " ")
          .trim() || null;

      return {
        issuerName,
        issuerTicker,
        traded: cellTexts[2] || null,
        type: cellTexts[4] || null,
        size: cellTexts[5] || null,
      };
    }),
  );

  return rows.filter((row) => row.issuerName || row.issuerTicker || row.type);
}

async function getPaginationInfo(page) {
  return page.evaluate(() => {
    const pagerText = document.body.innerText.match(
      /Page\s+(\d+)\s+of\s+(\d+)/i,
    );

    if (!pagerText) {
      return { currentPage: 1, totalPages: 1 };
    }

    return {
      currentPage: Number(pagerText[1]),
      totalPages: Number(pagerText[2]),
    };
  });
}

async function clickNextTradesPage(page) {
  const currentFirstRow = await page
    .locator(SELECTORS.detailTableRows)
    .first()
    .textContent()
    .catch(() => null);

  const nextCandidates = [
    page.locator('button[aria-label*="next" i]'),
    page.locator('a[aria-label*="next" i]'),
    page.locator('button:has-text("Next")'),
    page.locator('a:has-text("Next")'),
    page.locator('button:has-text("›")'),
    page.locator('a:has-text("›")'),
    page.locator('button:has-text("»")'),
    page.locator('a:has-text("»")'),
  ];

  let nextLocator = null;

  for (const candidate of nextCandidates) {
    const count = await candidate.count();
    if (count > 0) {
      nextLocator = candidate.last();
      break;
    }
  }

  if (!nextLocator) return false;

  const disabled =
    (await nextLocator.getAttribute("disabled")) !== null ||
    (await nextLocator.getAttribute("aria-disabled")) === "true" ||
    (await nextLocator
      .evaluate((el) => {
        const htmlEl = /** @type {HTMLElement} */ (el);
        return (
          htmlEl.classList.contains("disabled") ||
          htmlEl.dataset.disabled === "true"
        );
      })
      .catch(() => false));

  if (disabled) return false;

  await nextLocator.click({ timeout: 15000 }).catch(() => null);

  await page
    .waitForFunction(
      ({ selector, previousText }) => {
        const firstRow = document.querySelector(selector);
        if (!firstRow) return false;
        return firstRow.textContent !== previousText;
      },
      { selector: SELECTORS.detailTableRows, previousText: currentFirstRow },
      { timeout: 15000 },
    )
    .catch(() => null);

  const nextFirstRow = await page
    .locator(SELECTORS.detailTableRows)
    .first()
    .textContent()
    .catch(() => null);

  return Boolean(nextFirstRow && nextFirstRow !== currentFirstRow);
}

function buildLeanTrade(row) {
  const issuerName = cleanText(row.issuerName);
  const ticker = normalizeTicker(row.issuerTicker);
  const type = normalizeTradeType(row.type);
  const traded = normalizeDate(row.traded);
  const size = cleanText(row.size);

  if (!type || !traded) return null;

  return {
    ticker,
    issuerName: ticker ? undefined : issuerName,
    type,
    traded,
    size,
  };
}

async function scrapeAllTradePages(page) {
  const allTrades = [];
  const seenKeys = new Set();

  const { totalPages } = await getPaginationInfo(page);

  for (let pageIndex = 1; pageIndex <= totalPages; pageIndex += 1) {
    await page.waitForSelector(SELECTORS.detailTableRows, { timeout: 30000 });

    const rows = await extractTradeRowsFromCurrentPage(page);

    for (const row of rows) {
      const trade = buildLeanTrade(row);
      if (!trade) continue;

      const dedupeSymbol = trade.ticker || trade.issuerName || "UNKNOWN";
      const dedupeKey = [dedupeSymbol, trade.type, trade.traded].join("|");

      if (!seenKeys.has(dedupeKey)) {
        seenKeys.add(dedupeKey);

        allTrades.push(
          Object.fromEntries(
            Object.entries(trade).filter(([, value]) => value !== undefined),
          ),
        );
      }
    }

    if (pageIndex < totalPages) {
      const moved = await clickNextTradesPage(page);
      if (!moved) break;
    }
  }

  return allTrades;
}

function buildPoliticianRecord({ listingData, detailData, trades }) {
  const politician = cleanText(detailData.name || listingData.name);
  return {
    politician,
    trades,
  };
}

async function main() {
  await ensureOutputDir();

  const listingLookup = new Map();
  const scrapedPoliticians = [];

  const crawler = new PlaywrightCrawler({
    requestHandlerTimeoutSecs: 120,
    maxConcurrency: 3,
    maxRequestsPerCrawl: 100,
    headless: true,
    async requestHandler({ request, page, enqueueLinks, log, pushData }) {
      if (request.label === "LIST") {
        log.info(`Listing page: ${request.url}`);

        await page.waitForSelector(SELECTORS.politicianCards, {
          timeout: 30000,
        });

        const cards = await extractListingCards(page);
        const filteredCards = cards.filter((card) => card.profileUrl);

        for (const card of filteredCards) {
          listingLookup.set(card.profileUrl, card);
        }

        await enqueueLinks({
          selector: SELECTORS.politicianCards,
          label: "DETAIL",
          transformRequestFunction: (req) => {
            if (!req.url) return false;
            if (!listingLookup.has(req.url)) return false;
            return req;
          },
        });

        log.info(
          `Enqueued ${filteredCards.length} politician profile links from first page`,
        );
        return;
      }

      if (request.label === "DETAIL") {
        log.info(`Scraping profile: ${request.url}`);

        await page.waitForLoadState("domcontentloaded");
        await page.waitForSelector(SELECTORS.detailTableRows, {
          timeout: 30000,
        });

        const listingData = listingLookup.get(request.url) || {};
        const detailData = await extractDetailHeader(page);
        const trades = await scrapeAllTradePages(page);

        const record = buildPoliticianRecord({
          listingData,
          detailData,
          trades,
        });

        scrapedPoliticians.push(record);
        await pushData(record);

        log.info(
          `Collected ${record.politician} with ${record.trades.length} lean trades`,
        );
      }
    },
    failedRequestHandler({ request, error, log }) {
      log.error(`Request failed: ${request.url}`, { error: error?.message });
    },
  });

  await crawler.run([
    {
      url: START_URL,
      label: "LIST",
    },
  ]);

  const output = scrapedPoliticians;

  const outputPath = await writeJsonFile(OUTPUT_FILE, output);

  const dataset = await Dataset.open();
  const datasetInfo = await dataset.getInfo();

  log.info(`Done. Saved lean combined file only: ${outputPath}`);
  log.info(`Dataset item count: ${datasetInfo?.itemCount ?? 0}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
