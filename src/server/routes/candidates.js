import { Router } from 'express';
import { buildCycleFunnel, getCandidatesForCycle } from '../../repositories/analyticsRepo.mongo.js';

const router = Router();

function toCandidateRow(d) {
  return {
    symbol: d.symbol ?? null,
    assetClass: d.assetClass ?? null,
    rank: d.rank ?? null,
    score: d.setupScore ?? null,
    setupScore: d.setupScore ?? null,
    setupGrade: d.setupGrade ?? null,
    shortlisted: d.shortlisted ?? false,
    rankedOut: d.rankedOut ?? false,
    stage: d.stage ?? null,
    rejectStage: d.rejectStage ?? null,
    approved: d.approved ?? false,
    reason: d.reason ?? null,
    scoreBreakdown: d.scoreBreakdown ?? null,
    metrics: d.metrics ?? null,
    cycleId: d.cycleId ?? null,
    timestamp: d.timestamp ?? null,
    recordedAt: d.recordedAt ?? null,
  };
}

function classifyBucket(d) {
  if (d.rankedOut || d.rejectStage === 'ranked_out' || d.reason === 'ranked_out') return 'rankedOut';
  if (d.rejectStage === 'strategy') return 'strategyRejected';
  if ((d.blockers ?? []).length > 0 && d.approved) return 'riskBlocked';
  if (d.approved && d.shortlisted) {
    return (d.blockers ?? []).length === 0 ? 'placed' : 'approved';
  }
  if (d.approved) return (d.blockers ?? []).length === 0 ? 'placed' : 'approved';
  return 'otherStageDecisions';
}

// GET /api/candidates?cycleId=<id>
router.get('/', async (req, res) => {
  try {
    const cycleId = typeof req.query.cycleId === 'string' && req.query.cycleId.trim()
      ? req.query.cycleId.trim()
      : null;

    const decisions = await getCandidatesForCycle(cycleId);
    const rows = decisions.map(toCandidateRow);
    const resolvedCycleId = rows[0]?.cycleId ?? cycleId;

    const response = {
      cycleId: resolvedCycleId ?? null,
      totals: buildCycleFunnel(decisions),
      shortlisted: [],
      rankedOut: [],
      strategyRejected: [],
      riskBlocked: [],
      approved: [],
      placed: [],
      otherStageDecisions: [],
    };

    for (let i = 0; i < rows.length; i += 1) {
      const bucket = classifyBucket(decisions[i]);
      if (bucket === 'approved') {
        response.approved.push(rows[i]);
      } else {
        response[bucket].push(rows[i]);
      }

      if (rows[i].shortlisted) {
        response.shortlisted.push(rows[i]);
      }
    }

    res.json(response);
  } catch (err) {
    console.error('[/api/candidates]', err.message);
    res.status(500).json({ error: 'Failed to fetch candidates' });
  }
});

export default router;
