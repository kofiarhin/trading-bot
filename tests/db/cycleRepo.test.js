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
  getLatestCycleRun,
  CANONICAL_TERMINAL_TYPES,
  LEGACY_TERMINAL_TYPES,
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

  describe('CANONICAL_TERMINAL_TYPES', () => {
    it('contains completed, skipped, and failed', () => {
      expect(CANONICAL_TERMINAL_TYPES).toEqual(expect.arrayContaining(['completed', 'skipped', 'failed']));
    });

    it('does not include skipped_outside_overlap', () => {
      expect(CANONICAL_TERMINAL_TYPES).not.toContain('skipped_outside_overlap');
    });

    it('LEGACY_TERMINAL_TYPES contains skipped_outside_overlap and nothing else', () => {
      expect(LEGACY_TERMINAL_TYPES).toContain('skipped_outside_overlap');
      expect(LEGACY_TERMINAL_TYPES).not.toContain('completed');
      expect(LEGACY_TERMINAL_TYPES).not.toContain('skipped');
      expect(LEGACY_TERMINAL_TYPES).not.toContain('failed');
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

  describe('getLatestCycleRun', () => {
    it('returns null when no terminal cycle exists', async () => {
      CycleRun.findOne.mockReturnValue({
        sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
      });
      const result = await getLatestCycleRun();
      expect(result).toBeNull();
    });

    it('queries for all canonical terminal types', async () => {
      CycleRun.findOne.mockReturnValue({
        sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
      });
      await getLatestCycleRun();
      const calledWith = CycleRun.findOne.mock.calls[0][0];
      expect(calledWith.type.$in).toEqual(expect.arrayContaining(['completed', 'skipped', 'failed']));
    });

    it('also queries legacy skipped_outside_overlap for DB read compatibility', async () => {
      CycleRun.findOne.mockReturnValue({
        sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
      });
      await getLatestCycleRun();
      const calledWith = CycleRun.findOne.mock.calls[0][0];
      expect(calledWith.type.$in).toContain('skipped_outside_overlap');
    });

    it('returns the latest terminal cycle doc', async () => {
      const doc = { type: 'skipped', reason: 'market closed', date: '2026-04-10' };
      CycleRun.findOne.mockReturnValue({
        sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(doc) }),
      });
      const result = await getLatestCycleRun();
      expect(result.type).toBe('skipped');
    });
  });
});
