import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

async function buildApp({ runtime = { status: 'idle', stage: null, progressPct: 0, metrics: {} }, runResult = { summary: { scanned: 0 } }, runError = null } = {}) {
  const getCycleRuntime = jest.fn(async () => runtime);
  const runAutopilotCycle = jest.fn(async () => {
    if (runError) throw runError;
    return runResult;
  });

  jest.unstable_mockModule('../../src/repositories/cycleRuntimeRepo.mongo.js', () => ({
    getCycleRuntime,
  }));

  jest.unstable_mockModule('../../src/autopilot.js', () => ({
    runAutopilotCycle,
  }));

  const { default: cycleRoutes } = await import('../../src/server/routes/cycle.js');
  const app = express();
  app.use(express.json());
  app.use('/api/cycle', cycleRoutes);
  return { app, getCycleRuntime, runAutopilotCycle };
}

describe('cycle routes', () => {
  it('GET /api/cycle/runtime returns runtime state', async () => {
    const { app } = await buildApp({ runtime: { status: 'running', stage: 'fetching_market_data', progressPct: 42, metrics: { scanned: 8 } } });
    const res = await request(app).get('/api/cycle/runtime');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('running');
    expect(res.body.progressPct).toBe(42);
  });

  it('POST /api/cycle/run returns 409 when cycle already running', async () => {
    const { app, runAutopilotCycle } = await buildApp({ runtime: { status: 'running', stage: 'placing_orders', progressPct: 80, metrics: {} } });
    const res = await request(app).post('/api/cycle/run');

    expect(res.status).toBe(409);
    expect(runAutopilotCycle).not.toHaveBeenCalled();
  });

  it('POST /api/cycle/run executes cycle when idle', async () => {
    const { app, runAutopilotCycle } = await buildApp({ runtime: { status: 'idle', stage: null, progressPct: 0, metrics: {} }, runResult: { summary: { scanned: 12, approved: 2 } } });
    const res = await request(app).post('/api/cycle/run');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(runAutopilotCycle).toHaveBeenCalledTimes(1);
  });
});
