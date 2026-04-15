import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const getCandidatesForCycle = jest.fn();
const buildCycleFunnel = jest.fn();

jest.unstable_mockModule('../../src/repositories/analyticsRepo.mongo.js', () => ({
  getCandidatesForCycle,
  buildCycleFunnel,
}));

const { default: candidatesRouter } = await import('../../src/server/routes/candidates.js');

function makeApp() {
  const app = express();
  app.use('/api/candidates', candidatesRouter);
  return app;
}

describe('/api/candidates route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns funnel contract grouped by stage with persisted rank', async () => {
    const docs = [
      { symbol: 'AAPL', cycleId: 'cycle-1', rank: 1, shortlisted: true, approved: true, stage: 'strategy', setupScore: 82, setupGrade: 'A', blockers: [], metrics: { closePrice: 100 } },
      { symbol: 'MSFT', cycleId: 'cycle-1', rank: 4, shortlisted: false, rankedOut: true, rejectStage: 'ranked_out', reason: 'ranked_out', approved: false, blockers: [] },
      { symbol: 'NVDA', cycleId: 'cycle-1', rank: 2, shortlisted: true, rejectStage: 'strategy', approved: false, blockers: [] },
    ];

    getCandidatesForCycle.mockResolvedValue(docs);
    buildCycleFunnel.mockReturnValue({ scanned: 3, prefilterRejected: 0, scored: 3, shortlisted: 2, rankedOut: 1, strategyRejected: 1, riskBlocked: 0, approved: 1, placed: 1 });

    const res = await request(makeApp()).get('/api/candidates').query({ cycleId: 'cycle-1' });

    expect(res.status).toBe(200);
    expect(res.body.cycleId).toBe('cycle-1');
    expect(res.body.totals.scanned).toBe(3);
    expect(res.body.shortlisted).toHaveLength(2);
    expect(res.body.rankedOut).toHaveLength(1);
    expect(res.body.strategyRejected).toHaveLength(1);
    expect(res.body.placed).toHaveLength(1);
    expect(res.body.rankedOut[0].rank).toBe(4);
    expect(getCandidatesForCycle).toHaveBeenCalledWith('cycle-1');
  });
});
