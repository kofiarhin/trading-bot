// Daily reset keeps cooldowns that have not expired (in-memory MongoDB).
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { startMongoHarness, stopMongoHarness } from '../helpers/mongoHarness.js';

let RiskState;
let loadRiskState;

beforeAll(async () => {
  await startMongoHarness('risk-state-reset');
  RiskState = (await import('../../src/models/RiskState.js')).default;
  ({ loadRiskState } = await import('../../src/repositories/riskStateRepo.mongo.js'));
});

afterAll(async () => {
  await stopMongoHarness();
});

describe('loadRiskState daily reset', () => {
  it('resets daily loss but keeps unexpired cooldowns', async () => {
    const future = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const past = new Date(Date.now() - 3_600_000).toISOString();
    await RiskState.create({
      key: 'risk-state',
      date: '2000-01-01',
      dailyRealizedLoss: 999,
      halted: true,
      cooldowns: { SOLUSD: future, AAPL: past },
    });

    const state = await loadRiskState();

    expect(state.dailyRealizedLoss).toBe(0);
    expect(state.halted).toBe(false);
    expect(state.cooldowns).toEqual({ SOLUSD: future });
  });
});
