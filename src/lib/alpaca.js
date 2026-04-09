import 'dotenv/config';

const PAPER_TRADING_URL = 'https://paper-api.alpaca.markets';
const MARKET_DATA_URL = 'https://data.alpaca.markets';

function getEnvironmentValue(...names) {
  for (const name of names) {
    if (process.env[name]) {
      return process.env[name];
    }
  }

  return undefined;
}

function toQueryString(params = {}) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }

    if (Array.isArray(value)) {
      searchParams.set(key, value.join(','));
      continue;
    }

    searchParams.set(key, String(value));
  }

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

function toNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

export function getAlpacaConfig() {
  return {
    apiKey: getEnvironmentValue('ALPACA_API_KEY', 'APCA_API_KEY_ID'),
    secretKey: getEnvironmentValue('ALPACA_API_SECRET', 'ALPACA_SECRET_KEY', 'APCA_API_SECRET_KEY'),
    tradingBaseUrl: getEnvironmentValue('ALPACA_BASE_URL', 'APCA_API_BASE_URL') ?? PAPER_TRADING_URL,
    dataBaseUrl: getEnvironmentValue('ALPACA_DATA_URL') ?? MARKET_DATA_URL,
    feed: getEnvironmentValue('ALPACA_FEED', 'ALPACA_DATA_FEED') ?? 'iex',
  };
}

export function isPaperTradingConfigured() {
  return /paper-api\.alpaca\.markets/i.test(getAlpacaConfig().tradingBaseUrl);
}

export function isDryRunEnabled(options = {}) {
  if (typeof options.dryRun === 'boolean') {
    return options.dryRun;
  }

  if (process.argv.includes('--dry')) {
    return true;
  }

  const dryRunValue = getEnvironmentValue('DRY_RUN', 'AUTOPILOT_DRY_RUN', 'PAPER_DRY_RUN');
  return ['1', 'true', 'yes', 'on'].includes(String(dryRunValue ?? '').toLowerCase());
}

function getHeaders() {
  const config = getAlpacaConfig();

  if (!config.apiKey || !config.secretKey) {
    throw new Error('Missing Alpaca API credentials');
  }

  return {
    'APCA-API-KEY-ID': config.apiKey,
    'APCA-API-SECRET-KEY': config.secretKey,
    'Content-Type': 'application/json',
  };
}

async function request(baseUrl, resourcePath, options = {}) {
  const response = await fetch(`${baseUrl}${resourcePath}`, {
    method: options.method ?? 'GET',
    headers: getHeaders(),
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    const message = payload?.message ?? response.statusText;
    throw new Error(`Alpaca request failed: ${message}`);
  }

  return payload;
}

function normalizePosition(position) {
  return {
    ...position,
    qty: toNumber(position.qty, 0),
    avg_entry_price: toNumber(position.avg_entry_price, 0),
    current_price: toNumber(position.current_price, 0),
    market_value: toNumber(position.market_value, 0),
    unrealized_pl: toNumber(position.unrealized_pl, 0),
  };
}

function normalizeBars(barResponse = {}) {
  const bars = barResponse.bars ?? {};
  const normalized = {};

  for (const [symbol, symbolBars] of Object.entries(bars)) {
    normalized[symbol] = (symbolBars ?? []).map((bar) => ({
      symbol,
      timestamp: bar.t,
      open: toNumber(bar.o),
      high: toNumber(bar.h),
      low: toNumber(bar.l),
      close: toNumber(bar.c),
      volume: toNumber(bar.v),
    }));
  }

  return normalized;
}

export async function getAccount() {
  return request(getAlpacaConfig().tradingBaseUrl, '/v2/account');
}

export async function getPositions() {
  const positions = await request(getAlpacaConfig().tradingBaseUrl, '/v2/positions');
  return (positions ?? []).map(normalizePosition);
}

export async function getOrders(params = {}) {
  const resourcePath = `/v2/orders${toQueryString(params)}`;
  return request(getAlpacaConfig().tradingBaseUrl, resourcePath);
}

export async function submitOrder(orderPayload) {
  if (!isPaperTradingConfigured()) {
    throw new Error('Live trading is disabled. Configure Alpaca paper trading only.');
  }

  return request(getAlpacaConfig().tradingBaseUrl, '/v2/orders', {
    method: 'POST',
    body: orderPayload,
  });
}

export async function getBarsForSymbols(symbols, options = {}) {
  const uniqueSymbols = [...new Set((symbols ?? []).map((symbol) => String(symbol).trim()).filter(Boolean))];

  if (!uniqueSymbols.length) {
    return {};
  }

  const queryString = toQueryString({
    symbols: uniqueSymbols,
    timeframe: options.timeframe ?? '15Min',
    limit: options.limit ?? 60,
    adjustment: options.adjustment ?? 'raw',
    feed: options.feed ?? getAlpacaConfig().feed,
  });

  const response = await request(getAlpacaConfig().dataBaseUrl, `/v2/stocks/bars${queryString}`);
  return normalizeBars(response);
}
