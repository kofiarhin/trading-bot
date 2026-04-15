import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  process.env.ALLOW_MANUAL_TRIGGER = 'true';
});

async function buildApp({
  runtime = { status: 'idle', cycleId: null },
  runError = null,
} = {}) {
  const getCycleRuntime = jest.fn(async () => runtime);
  const recoverStaleRunningCycle = jest.fn(async () => null);
  const runAutopilotCycle = jest.fn(async (_symbols, _trigger, { onStarted } = {}) => {
    if (onStarted) onStarted(runtime.cycleId ?? 'test-cycle-1');
    if (runError) throw runError;
    return { cycleId: runtime.cycleId ?? 'test-cycle-1', status: 'completed', triggerSource: 'manual', summary: {} };
  });

  class CycleAlreadyRunningError extends Error {
    constructor(cycleId) {
      super('Cycle already running');
      this.name = 'CycleAlreadyRunningError';
      this.code = 'CYCLE_ALREADY_RUNNING';
      this.cycleId = cycleId ?? null;
    }
  }

  jest.unstable_mockModule('../../src/repositories/cycleRuntimeRepo.mongo.js', () => ({
    getCycleRuntime,
    recoverStaleRunningCycle,
    CycleAlreadyRunningError,
  }));

  jest.unstable_mockModule('../../src/autopilot.js', () => ({
    runAutopilotCycle,
  }));

  const { default: cycleRoutes } = await import('../../src/server/routes/cycle.js');
  const app = express();
  app.use(express.json());
  app.use('/api/cycle', cycleRoutes);
  return { app, getCycleRuntime, runAutopilotCycle, recoverStaleRunningCycle, CycleAlreadyRunningError };
}

describe('POST /api/cycle/manual-run', () => {
  it('returns 202 when idle', async () => {
    const { app, runAutopilotCycle, recoverStaleRunningCycle } = await buildApp({
      runtime: { status: 'running', cycleId: 'new-cycle-1' },
    });

    const res = await request(app).post('/api/cycle/manual-run');

    expect(res.status).toBe(202);
    expect(res.body.ok).toBe(true);
    expect(res.body.triggerSource).toBe('manual');
    expect(res.body.status).toBe('running');
    expect(recoverStaleRunningCycle).toHaveBeenCalledTimes(1);
    // fire-and-forget: runAutopilotCycle is called but we don't await it
    // give microtasks a tick to settle
    await new Promise((r) => setImmediate(r));
    expect(runAutopilotCycle).toHaveBeenCalledWith({}, 'manual', expect.objectContaining({ onStarted: expect.any(Function) }));
  });

  it('returns 409 when cycle is already running (lock error from runAutopilotCycle)', async () => {
    const alreadyRunningError = Object.assign(new Error('Cycle already running'), {
      name: 'CycleAlreadyRunningError',
      code: 'CYCLE_ALREADY_RUNNING',
      cycleId: 'active-cycle-99',
    });

    const getCycleRuntime = jest.fn(async () => ({ status: 'idle', cycleId: null }));
    const recoverStaleRunningCycle = jest.fn(async () => {
      throw alreadyRunningError;
    });
    const runAutopilotCycle = jest.fn();

    jest.unstable_mockModule('../../src/repositories/cycleRuntimeRepo.mongo.js', () => ({
      getCycleRuntime,
      recoverStaleRunningCycle,
      CycleAlreadyRunningError: class CycleAlreadyRunningError extends Error {
        constructor(cycleId) {
          super('Cycle already running');
          this.name = 'CycleAlreadyRunningError';
          this.code = 'CYCLE_ALREADY_RUNNING';
          this.cycleId = cycleId ?? null;
        }
      },
    }));

    jest.unstable_mockModule('../../src/autopilot.js', () => ({ runAutopilotCycle }));

    const { default: cycleRoutes } = await import('../../src/server/routes/cycle.js');
    const app = express();
    app.use(express.json());
    app.use('/api/cycle', cycleRoutes);

    const res = await request(app).post('/api/cycle/manual-run');

    expect(res.status).toBe(409);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('CYCLE_ALREADY_RUNNING');
  });

  it('returns 403 when ALLOW_MANUAL_TRIGGER is not true', async () => {
    process.env.ALLOW_MANUAL_TRIGGER = 'false';
    const { app, runAutopilotCycle } = await buildApp();

    const res = await request(app).post('/api/cycle/manual-run');

    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('MANUAL_TRIGGER_DISABLED');
    expect(runAutopilotCycle).not.toHaveBeenCalled();
  });

  it('returns 403 when ALLOW_MANUAL_TRIGGER is unset', async () => {
    delete process.env.ALLOW_MANUAL_TRIGGER;
    const { app, runAutopilotCycle } = await buildApp();

    const res = await request(app).post('/api/cycle/manual-run');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MANUAL_TRIGGER_DISABLED');
    expect(runAutopilotCycle).not.toHaveBeenCalled();
  });

  it('calls runAutopilotCycle with triggerSource manual', async () => {
    const { app, runAutopilotCycle } = await buildApp({
      runtime: { status: 'running', cycleId: 'manual-cycle-42' },
    });

    await request(app).post('/api/cycle/manual-run');
    await new Promise((r) => setImmediate(r));

    expect(runAutopilotCycle).toHaveBeenCalledWith({}, 'manual', expect.objectContaining({ onStarted: expect.any(Function) }));
  });
});
