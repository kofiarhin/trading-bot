import { Router } from 'express';
import { getCandidatesForCycle } from '../../repositories/analyticsRepo.mongo.js';

const router = Router();

// GET /api/candidates?cycleId=<id>
router.get('/', async (req, res) => {
  try {
    const { cycleId } = req.query;
    const decisions = await getCandidatesForCycle(cycleId ?? null);

    const candidates = decisions.map((d, i) => ({
      // Use the persisted rank from the pipeline; fall back to array position
      rank: d.rank ?? (i + 1),
      symbol: d.symbol,
      timestamp: d.timestamp ?? null,
      assetClass: d.assetClass ?? null,
      // Pipeline stage tracking
      stage: d.stage ?? null,
      rejectStage: d.rejectStage ?? null,
      reason: d.reason ?? null,
      shortlisted: d.shortlisted ?? false,
      approved: d.approved ?? false,
      // Score
      setupScore: d.setupScore ?? null,
      setupGrade: d.setupGrade ?? null,
      scoreBreakdown: d.scoreBreakdown ?? null,
      context: d.context ?? null,
      // Trade levels
      entryPrice: d.entryPrice ?? null,
      stopLoss: d.stopLoss ?? null,
      takeProfit: d.takeProfit ?? null,
      riskReward: d.riskReward ?? null,
      riskAmount: d.riskAmount ?? null,
      // Market metrics
      closePrice: d.closePrice ?? null,
      breakoutLevel: d.breakoutLevel ?? null,
      atr: d.atr ?? null,
      volumeRatio: d.volumeRatio ?? null,
      distanceToBreakoutPct: d.distanceToBreakoutPct ?? null,
    }));

    res.json(candidates);
  } catch (err) {
    console.error('[/api/candidates]', err.message);
    res.status(500).json({ error: 'Failed to fetch candidates' });
  }
});

export default router;
