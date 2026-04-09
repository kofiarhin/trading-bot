const CANONICAL_TRADE_FIELDS = [
  'tradeId',
  'symbol',
  'normalizedSymbol',
  'assetClass',
  'strategyName',
  'entryPrice',
  'stopLoss',
  'takeProfit',
  'quantity',
  'riskAmount',
  'status',
  'openedAt',
  'closedAt',
  'exitPrice',
  'pnl',
  'pnlPct',
  'exitReason',
  'metrics',
];

const READ_ALIASES = {
  tradeId: ['tradeId', 'id'],
  symbol: ['symbol'],
  normalizedSymbol: ['normalizedSymbol'],
  assetClass: ['assetClass'],
  strategyName: ['strategyName', 'strategy'],
  entryPrice: ['entryPrice'],
  stopLoss: ['stopLoss', 'stop'],
  takeProfit: ['takeProfit', 'target'],
  quantity: ['quantity', 'qty'],
  riskAmount: ['riskAmount', 'risk'],
  status: ['status'],
  openedAt: ['openedAt'],
  closedAt: ['closedAt'],
  exitPrice: ['exitPrice'],
  pnl: ['pnl'],
  pnlPct: ['pnlPct'],
  exitReason: ['exitReason'],
  metrics: ['metrics'],
};

const TRADE_MARKERS = new Set([
  'tradeId',
  'id',
  'symbol',
  'normalizedSymbol',
  'assetClass',
  'strategyName',
  'strategy',
  'entryPrice',
  'stopLoss',
  'stop',
  'takeProfit',
  'target',
  'quantity',
  'qty',
  'riskAmount',
  'risk',
  'status',
  'openedAt',
  'closedAt',
  'exitPrice',
  'pnl',
  'pnlPct',
  'exitReason',
  'metrics',
]);

const STRONG_TRADE_MARKERS = new Set([
  'tradeId',
  'id',
  'entryPrice',
  'stopLoss',
  'stop',
  'takeProfit',
  'target',
  'quantity',
  'qty',
  'openedAt',
  'closedAt',
  'exitPrice',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isDefined(value) {
  return value !== undefined && value !== null;
}

function pickFirst(source, keys) {
  for (const key of keys) {
    if (isDefined(source?.[key])) {
      return source[key];
    }
  }

  return undefined;
}

function omitUndefined(source) {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined)
  );
}

function normalizeSymbol(symbol) {
  if (typeof symbol !== 'string') {
    return symbol;
  }

  return symbol.trim().toUpperCase();
}

export function looksLikeTradeRecord(value) {
  if (!isObject(value)) {
    return false;
  }

  const keys = Object.keys(value);
  let markerCount = 0;
  let strongMarkerCount = 0;

  for (const key of keys) {
    if (TRADE_MARKERS.has(key)) {
      markerCount += 1;
    }

    if (STRONG_TRADE_MARKERS.has(key)) {
      strongMarkerCount += 1;
    }
  }

  return strongMarkerCount >= 2 || markerCount >= 4;
}

export function normalizeTradeRecord(trade = {}) {
  if (!isObject(trade)) {
    return trade;
  }

  const canonicalTrade = {
    tradeId: pickFirst(trade, READ_ALIASES.tradeId),
    symbol: pickFirst(trade, READ_ALIASES.symbol),
    normalizedSymbol:
      pickFirst(trade, READ_ALIASES.normalizedSymbol) ??
      normalizeSymbol(pickFirst(trade, READ_ALIASES.symbol)),
    assetClass: pickFirst(trade, READ_ALIASES.assetClass),
    strategyName: pickFirst(trade, READ_ALIASES.strategyName),
    entryPrice: pickFirst(trade, READ_ALIASES.entryPrice),
    stopLoss: pickFirst(trade, READ_ALIASES.stopLoss),
    takeProfit: pickFirst(trade, READ_ALIASES.takeProfit),
    quantity: pickFirst(trade, READ_ALIASES.quantity),
    riskAmount: pickFirst(trade, READ_ALIASES.riskAmount),
    status: pickFirst(trade, READ_ALIASES.status),
    openedAt: pickFirst(trade, READ_ALIASES.openedAt),
    closedAt: pickFirst(trade, READ_ALIASES.closedAt),
    exitPrice: pickFirst(trade, READ_ALIASES.exitPrice),
    pnl: pickFirst(trade, READ_ALIASES.pnl),
    pnlPct: pickFirst(trade, READ_ALIASES.pnlPct),
    exitReason: pickFirst(trade, READ_ALIASES.exitReason),
    metrics: pickFirst(trade, READ_ALIASES.metrics),
  };

  return omitUndefined(canonicalTrade);
}

export function normalizeTradeForRead(trade = {}) {
  return normalizeTradeRecord(trade);
}

export function normalizeTradeForStorage(trade = {}) {
  const canonicalTrade = normalizeTradeRecord(trade);

  return Object.fromEntries(
    CANONICAL_TRADE_FIELDS
      .filter((field) => canonicalTrade[field] !== undefined)
      .map((field) => [field, canonicalTrade[field]])
  );
}

export function normalizeTradePayloadForRead(payload) {
  if (Array.isArray(payload)) {
    return payload.map((item) => normalizeTradePayloadForRead(item));
  }

  if (!isObject(payload)) {
    return payload;
  }

  if (looksLikeTradeRecord(payload)) {
    return normalizeTradeForRead(payload);
  }

  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [
      key,
      normalizeTradePayloadForRead(value),
    ])
  );
}

export function normalizeTradePayloadForStorage(payload) {
  if (Array.isArray(payload)) {
    return payload.map((item) => normalizeTradePayloadForStorage(item));
  }

  if (!isObject(payload)) {
    return payload;
  }

  if (looksLikeTradeRecord(payload)) {
    return normalizeTradeForStorage(payload);
  }

  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [
      key,
      normalizeTradePayloadForStorage(value),
    ])
  );
}

export function normalizeExecutionArgs(args = []) {
  return args.map((arg) => {
    if (looksLikeTradeRecord(arg)) {
      return normalizeTradeForRead(arg);
    }

    if (!isObject(arg)) {
      return arg;
    }

    return Object.fromEntries(
      Object.entries(arg).map(([key, value]) => [
        key,
        looksLikeTradeRecord(value) ? normalizeTradeForRead(value) : value,
      ])
    );
  });
}

export function normalizeExecutionResult(result) {
  if (Array.isArray(result)) {
    return result.map((item) => normalizeExecutionResult(item));
  }

  if (looksLikeTradeRecord(result)) {
    return normalizeTradeForRead(result);
  }

  if (!isObject(result)) {
    return result;
  }

  return Object.fromEntries(
    Object.entries(result).map(([key, value]) => [
      key,
      looksLikeTradeRecord(value) ? normalizeTradeForRead(value) : value,
    ])
  );
}

export function shouldNormalizeTradeFile(filePath = '') {
  const normalizedPath = String(filePath).replace(/\\/g, '/').toLowerCase();

  if (!normalizedPath.includes('/storage/')) {
    return false;
  }

  if (
    normalizedPath.includes('/storage/logs/') ||
    normalizedPath.includes('/storage/decisions/') ||
    normalizedPath.endsWith('/riskstate.json')
  ) {
    return false;
  }

  return (
    normalizedPath.includes('/storage/journal/') ||
    normalizedPath.includes('/trade') ||
    normalizedPath.includes('/position')
  );
}

export { CANONICAL_TRADE_FIELDS };

// Alias used by tradeJournal.js and orderManager.js
export const normalizeTradeForWrite = normalizeTradeForStorage;
