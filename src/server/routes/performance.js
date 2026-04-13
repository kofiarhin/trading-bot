import { Router } from 'express';
import { getClosedTradesForPeriod } from '../../repositories/analyticsRepo.mongo.js';
import { computePerformance } from '../../analytics/performance.js';

const router = Router();

// GET /api/performance?days=30
router.get('/', async (req, res) => {
  try {
    const days = Math.max(1, parseInt(req.query.days ?? '30', 10) || 30);
    const trades = await getClosedTradesForPeriod(days);
    const performance = computePerformance(trades);
    res.json(performance);
  } catch (err) {
    console.error('[/api/performance]', err.message);
    res.status(500).json({ error: 'Failed to compute performance' });
  }
});

export default router;
