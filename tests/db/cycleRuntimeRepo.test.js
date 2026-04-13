import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../../src/models/CycleRuntime.js', () => ({
  default: {
    create: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  },
}));

const { default: CycleRuntime } = await import('../../src/models/CycleRuntime.js');
const {
  getCycleRuntime,
  startCycleRuntime,
  updateCycleRuntime,
  completeCycleRuntime,
  failCycleRuntime,
  recoverStaleRunningCycle,
} = await import('../../src/repositories/cycleRuntimeRepo.mongo.js');

describe('cycleRuntimeRepo.mongo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.CYCLE_RUNTIME_STALE_MINUTES;
  });

  it('returns existing runtime from getCycleRuntime', async () => {
    CycleRuntime.updateOne.mockResolvedValue({ acknowledged: true });
    CycleRuntime.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    CycleRuntime.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ singletonKey: 'cycle-runtime', status: 'idle' }) });

    const result = await getCycleRuntime();
    expect(result.status).toBe('idle');
  });

  it('throws overlap error on startCycleRuntime when already running', async () => {
    CycleRuntime.updateOne.mockResolvedValue({ acknowledged: true });
    CycleRuntime.findOneAndUpdate
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(null) })
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(null) });
    CycleRuntime.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ singletonKey: 'cycle-runtime', cycleId: 'abc-1', status: 'running' }) });

    await expect(startCycleRuntime({ cycleId: 'abc-2' })).rejects.toMatchObject({ code: 'CYCLE_ALREADY_RUNNING', cycleId: 'abc-1' });
  });

  it('updates stage and counters', async () => {
    CycleRuntime.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue({ singletonKey: 'cycle-runtime', stage: 'fetching_market_data', scanned: 10 }) });
    const result = await updateCycleRuntime({ stage: 'fetching_market_data', scanned: 10 });
    expect(result.stage).toBe('fetching_market_data');
    expect(result.scanned).toBe(10);
  });

  it('marks runtime completed', async () => {
    CycleRuntime.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue({ status: 'completed', progressPct: 100 }) });
    const result = await completeCycleRuntime({ scanned: 7 });
    expect(result.status).toBe('completed');
    expect(result.progressPct).toBe(100);
  });

  it('marks runtime failed', async () => {
    CycleRuntime.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue({ status: 'failed', lastError: { message: 'boom' } }) });
    const result = await failCycleRuntime({ message: 'boom' });
    expect(result.status).toBe('failed');
    expect(result.lastError.message).toBe('boom');
  });

  it('recovers stale running cycle', async () => {
    CycleRuntime.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue({ status: 'failed', message: 'Cycle failed (stale runtime recovered)' }) });
    const result = await recoverStaleRunningCycle();
    expect(result.status).toBe('failed');
  });

  it('uses 5 minute stale cutoff by default', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-04-13T12:00:00.000Z').getTime());
    CycleRuntime.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    await recoverStaleRunningCycle();

    const filter = CycleRuntime.findOneAndUpdate.mock.calls[0][0];
    expect(filter.heartbeatAt.$lte).toBe('2026-04-13T11:55:00.000Z');
    nowSpy.mockRestore();
  });

  it('honors CYCLE_RUNTIME_STALE_MINUTES override', async () => {
    process.env.CYCLE_RUNTIME_STALE_MINUTES = '9';
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-04-13T12:00:00.000Z').getTime());
    CycleRuntime.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    await recoverStaleRunningCycle();

    const filter = CycleRuntime.findOneAndUpdate.mock.calls[0][0];
    expect(filter.heartbeatAt.$lte).toBe('2026-04-13T11:51:00.000Z');
    nowSpy.mockRestore();
  });
});
