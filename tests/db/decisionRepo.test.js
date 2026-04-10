import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.unstable_mockModule('../../src/models/Decision.js', () => ({
  default: {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  },
}));

const { default: Decision } = await import('../../src/models/Decision.js');
const {
  saveDecision,
  getDecisionsForDate,
  getLatestDecisionDate,
  loadDecisionLog,
} = await import('../../src/repositories/decisionRepo.mongo.js');

function makeDecision(overrides = {}) {
  return {
    symbol: 'AAPL',
    approved: true,
    reason: 'breakout_confirmed',
    timestamp: new Date().toISOString(),
    recordedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('decisionRepo.mongo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('saveDecision', () => {
    it('creates a decision with a date field', async () => {
      const record = makeDecision();
      const saved = { ...record, date: '2026-04-10', _id: 'id', __v: 0 };
      Decision.create.mockResolvedValue({ toObject: () => saved });

      const result = await saveDecision(record);
      expect(Decision.create).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'AAPL' }));
      expect(result.date).toBeDefined();
      expect(result._id).toBeUndefined();
    });
  });

  describe('getDecisionsForDate', () => {
    it('queries by date and returns sorted docs', async () => {
      const docs = [makeDecision({ _id: 'a' }), makeDecision({ symbol: 'MSFT', _id: 'b' })];
      Decision.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(docs),
        }),
      });

      const result = await getDecisionsForDate('2026-04-10');
      expect(result).toHaveLength(2);
      expect(Decision.find).toHaveBeenCalledWith({ date: '2026-04-10' });
    });
  });

  describe('getLatestDecisionDate', () => {
    it('returns null when no decisions exist', async () => {
      Decision.findOne.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(null),
        }),
      });
      const result = await getLatestDecisionDate();
      expect(result).toBeNull();
    });

    it('returns the date of the latest decision', async () => {
      Decision.findOne.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ date: '2026-04-10', symbol: 'AAPL' }),
        }),
      });
      const result = await getLatestDecisionDate();
      expect(result).toBe('2026-04-10');
    });
  });

  describe('loadDecisionLog', () => {
    it('returns isFallback: false when records exist for the date', async () => {
      Decision.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([makeDecision()]),
        }),
      });

      const result = await loadDecisionLog({ date: '2026-04-10' });
      expect(result.isFallback).toBe(false);
      expect(result.records).toHaveLength(1);
    });

    it('falls back to latest when requested date has no records', async () => {
      let callCount = 0;
      Decision.find.mockImplementation(() => ({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(
            // First call (for requested date) returns empty, second call (for latest date) returns data
            callCount++ === 0 ? [] : [makeDecision()],
          ),
        }),
      }));

      Decision.findOne.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ date: '2026-04-09' }),
        }),
      });

      const result = await loadDecisionLog({ date: '2026-04-10', fallbackToLatest: true });
      expect(result.isFallback).toBe(true);
    });
  });
});
