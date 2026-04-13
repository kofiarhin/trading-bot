import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  process.env.CRON_SECRET = 'top-secret';
});

async function buildApp({ runtime = { status: 'idle' }, runResult = { cycleId: 'c1', status: 'completed', summary: { scanned: 0 } }, runError = null } = {}) {
  const getCycleRuntime = jest.fn(async () => runtime);
  const recoverStaleRunningCycle = jest.fn(async () => null);
  const runAutopilotCycle = jest.fn(async () => {
    if (runError) throw runError;
    return runResult;
  });

  class CycleAlreadyRunningError extends Error {
    constructor(cycleId) {
      super('Cycle already running');
      this.code = 'CYCLE_ALREADY_RUNNING';
      this.cycleId = cycleId;
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

describe('cycle routes', () => {
  it('GET /api/cycle/runtime returns runtime state', async () => {
    const { app } = await buildApp({ runtime: { status: 'running', stage: 'fetching_market_data', progressPct: 42 } });
    const res = await request(app).get('/api/cycle/runtime');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('running');
    expect(res.body.progressPct).toBe(42);
  });

  it('POST /api/cycle/run returns 401 without bearer secret', async () => {
    const { app, runAutopilotCycle } = await buildApp();
    const res = await request(app).post('/api/cycle/run');

    expect(res.status).toBe(401);
    expect(runAutopilotCycle).not.toHaveBeenCalled();
  });

  it('POST /api/cycle/run returns 409 on overlap', async () => {
    const overlapError = Object.assign(new Error('Cycle already running'), {
      code: 'CYCLE_ALREADY_RUNNING',
      cycleId: 'active-cycle-1',
    });
    const { app } = await buildApp({ runError: overlapError });
    const res = await request(app)
      .post('/api/cycle/run')
      .set('Authorization', 'Bearer top-secret');

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CYCLE_ALREADY_RUNNING');
    expect(res.body.cycleId).toBe('active-cycle-1');
  });

  it('POST /api/cycle/run executes cycle when authorized', async () => {
    const { app, runAutopilotCycle, recoverStaleRunningCycle } = await buildApp();
    const res = await request(app)
      .post('/api/cycle/run')
      .set('Authorization', 'Bearer top-secret');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(runAutopilotCycle).toHaveBeenCalledTimes(1);
    expect(recoverStaleRunningCycle).toHaveBeenCalledTimes(1);
  });
});
