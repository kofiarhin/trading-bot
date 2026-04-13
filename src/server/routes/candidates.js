import { Router } from 'express';
import { getCandidatesForCycle } from '../../repositories/analyticsRepo.mongo.js';

const router = Router();

// GET /api/candidates?cycleId=<id>
router.get('/', async (req, res) => {
  try {
    const { cycleId } = req.query;
    const decisions = await getCandidatesForCycle(cycleId ?? null);

    const candidates = decisions.map((d, i) => ({
      rank: i + 1,
      symbol: d.symbol,
      setupScore: d.setupScore ?? null,
      setupGrade: d.setupGrade ?? null,
      riskReward: d.riskReward ?? null,
      context: d.context ?? null,
      entryPrice: d.entryPrice ?? null,
    }));

    res.json(candidates);
  } catch (err) {
    console.error('[/api/candidates]', err.message);
    res.status(500).json({ error: 'Failed to fetch candidates' });
  }
});

export default router;
