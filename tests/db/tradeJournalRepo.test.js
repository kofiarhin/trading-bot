import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock Mongoose models before importing the repo
function withLean(value) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

function withSortLean(value) {
  return {
    sort: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(value),
    }),
  };
}

jest.unstable_mockModule('../../src/models/OpenTrade.js', () => ({
  default: {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    deleteOne: jest.fn(),
  },
}));

jest.unstable_mockModule('../../src/models/ClosedTrade.js', () => ({
  default: {
    find: jest.fn(),
    findOneAndUpdate: jest.fn(),
  },
}));

jest.unstable_mockModule('../../src/models/TradeEvent.js', () => ({
  default: {
    find: jest.fn(),
    create: jest.fn(),
  },
}));

const { default: OpenTrade } = await import('../../src/models/OpenTrade.js');
const { default: ClosedTrade } = await import('../../src/models/ClosedTrade.js');
const { default: TradeEvent } = await import('../../src/models/TradeEvent.js');

const {
  getOpenTrades,
  getOpenTradeById,
  upsertOpenTrade,
  removeOpenTrade,
  getClosedTrades,
  upsertClosedTrade,
  getTradeEvents,
  appendTradeEvent,
} = await import('../../src/repositories/tradeJournalRepo.mongo.js');

function makeTrade(overrides = {}) {
  return {
    tradeId: 'trade-abc-123',
    symbol: 'BTC/USD',
    normalizedSymbol: 'BTCUSD',
    status: 'open',
    ...overrides,
  };
}

describe('tradeJournalRepo.mongo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getOpenTrades', () => {
    it('returns normalized lean docs', async () => {
      const raw = [{ tradeId: 'trade-abc-123', symbol: 'BTC/USD', status: 'open' }];
      OpenTrade.find.mockReturnValue(withSortLean(raw));

      const result = await getOpenTrades();
      expect(result).toHaveLength(1);
      expect(result[0].tradeId).toBe('trade-abc-123');
      expect(result[0]._id).toBeUndefined();
    });
  });

  describe('getOpenTradeById', () => {
    it('returns null when not found', async () => {
      OpenTrade.findOne.mockReturnValue(withLean(null));
      const result = await getOpenTradeById('not-found');
      expect(result).toBeNull();
    });

    it('returns stripped doc when found', async () => {
      OpenTrade.findOne.mockReturnValue(withLean({ tradeId: 'x' }));
      const result = await getOpenTradeById('x');
      expect(result.tradeId).toBe('x');
    });
  });

  describe('upsertOpenTrade', () => {
    it('calls findOneAndUpdate with upsert', async () => {
      const trade = makeTrade();
      OpenTrade.findOneAndUpdate.mockReturnValue(withLean({ ...trade }));
      await upsertOpenTrade(trade);
      expect(OpenTrade.findOneAndUpdate).toHaveBeenCalledWith(
        { tradeId: trade.tradeId },
        expect.objectContaining({ tradeId: trade.tradeId }),
        expect.objectContaining({ upsert: true }),
      );
    });
  });

  describe('removeOpenTrade', () => {
    it('calls deleteOne with tradeId', async () => {
      OpenTrade.deleteOne.mockResolvedValue({ deletedCount: 1 });
      await removeOpenTrade('trade-abc-123');
      expect(OpenTrade.deleteOne).toHaveBeenCalledWith({ tradeId: 'trade-abc-123' });
    });
  });

  describe('upsertClosedTrade', () => {
    it('upserts into ClosedTrade collection', async () => {
      const trade = makeTrade({ status: 'closed' });
      ClosedTrade.findOneAndUpdate.mockReturnValue(withLean({ ...trade }));
      await upsertClosedTrade(trade);
      expect(ClosedTrade.findOneAndUpdate).toHaveBeenCalledWith(
        { tradeId: trade.tradeId },
        expect.objectContaining({ tradeId: trade.tradeId }),
        expect.objectContaining({ upsert: true }),
      );
    });
  });

  describe('appendTradeEvent', () => {
    it('creates a trade event with date field', async () => {
      const event = { id: 'evt-1', type: 'trade_open', tradeId: 'trade-abc-123', symbol: 'BTC/USD', timestamp: new Date().toISOString() };
      const saved = { ...event, eventId: 'evt-1', date: '2026-04-10' };
      TradeEvent.create.mockResolvedValue({ toObject: () => saved });

      const result = await appendTradeEvent(event);
      expect(TradeEvent.create).toHaveBeenCalledWith(expect.objectContaining({ id: 'evt-1', eventId: 'evt-1', type: 'trade_open' }));
      expect(result.date).toBeDefined();
    });
  });

  describe('getTradeEvents', () => {
    it('returns all trade events', async () => {
      TradeEvent.find.mockReturnValue(withSortLean([{ id: 'e1', eventId: 'e1', type: 'trade_open' }]));
      const result = await getTradeEvents();
      expect(result).toHaveLength(1);
    });
  });
});
