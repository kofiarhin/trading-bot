import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.unstable_mockModule('../../src/models/CycleRun.js', () => ({
  default: {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
  },
}));

const { default: CycleRun } = await import('../../src/models/CycleRun.js');
const {
  appendCycleEvent,
  getCyclesForDate,
  getLatestCompletedCycle,
} = await import('../../src/repositories/cycleRepo.mongo.js');

describe('cycleRepo.mongo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('appendCycleEvent', () => {
    it('creates a cycle event with date and recordedAt', async () => {
      const record = { type: 'completed', scanned: 11, approved: 2, placed: 1 };
      const saved = { ...record, date: '2026-04-10', recordedAt: new Date().toISOString() };
      CycleRun.create.mockResolvedValue({ toObject: () => saved });

      const result = await appendCycleEvent(record);
      expect(CycleRun.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'completed', scanned: 11 }),
      );
      expect(result.date).toBeDefined();
      expect(result.recordedAt).toBeDefined();
    });
  });

  describe('getCyclesForDate', () => {
    it('queries by date and returns sorted docs', async () => {
      const docs = [
        { type: 'cycle_start', date: '2026-04-10' },
        { type: 'completed', date: '2026-04-10', scanned: 11 },
      ];
      CycleRun.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(docs),
        }),
      });

      const result = await getCyclesForDate('2026-04-10');
      expect(result).toHaveLength(2);
      expect(CycleRun.find).toHaveBeenCalledWith({ date: '2026-04-10' });
    });
  });

  describe('getLatestCompletedCycle', () => {
    it('returns null when no completed cycle exists', async () => {
      CycleRun.findOne.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(null),
        }),
      });
      const result = await getLatestCompletedCycle();
      expect(result).toBeNull();
    });

    it('returns the latest completed cycle', async () => {
      const doc = { type: 'completed', scanned: 11, date: '2026-04-10' };
      CycleRun.findOne.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(doc),
        }),
      });
      const result = await getLatestCompletedCycle();
      expect(result.type).toBe('completed');
    });
  });
});
