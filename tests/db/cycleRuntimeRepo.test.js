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
} = await import('../../src/repositories/cycleRuntimeRepo.mongo.js');

describe('cycleRuntimeRepo.mongo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns existing runtime from getCycleRuntime', async () => {
    CycleRuntime.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ key: 'cycle-runtime', status: 'idle' }) });
    const result = await getCycleRuntime();
    expect(result.status).toBe('idle');
  });

  it('creates default runtime when missing', async () => {
    CycleRuntime.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    CycleRuntime.create.mockResolvedValue({ toObject: () => ({ key: 'cycle-runtime', status: 'idle' }) });
    const result = await getCycleRuntime();
    expect(CycleRuntime.create).toHaveBeenCalled();
    expect(result.status).toBe('idle');
  });

  it('returns null on startCycleRuntime when already running', async () => {
    CycleRuntime.updateOne.mockResolvedValue({ acknowledged: true });
    CycleRuntime.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    const result = await startCycleRuntime();
    expect(result).toBeNull();
  });

  it('updates stage and metrics', async () => {
    CycleRuntime.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue({ key: 'cycle-runtime', stage: 'fetching_market_data', metrics: { scanned: 10 } }) });
    const result = await updateCycleRuntime({ stage: 'fetching_market_data', metrics: { scanned: 10 } });
    expect(result.stage).toBe('fetching_market_data');
    expect(result.metrics.scanned).toBe(10);
  });

  it('marks runtime completed', async () => {
    CycleRuntime.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue({ status: 'completed', progressPct: 100 }) });
    const result = await completeCycleRuntime({ metrics: { scanned: 7 } });
    expect(result.status).toBe('completed');
    expect(result.progressPct).toBe(100);
  });

  it('marks runtime failed', async () => {
    CycleRuntime.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue({ status: 'failed', lastError: { message: 'boom' } }) });
    const result = await failCycleRuntime({ message: 'boom' });
    expect(result.status).toBe('failed');
    expect(result.lastError.message).toBe('boom');
  });
});
