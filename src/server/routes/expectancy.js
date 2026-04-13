import { Router } from 'express';
import { getClosedTradesForPeriod } from '../../repositories/analyticsRepo.mongo.js';
import { computePerformance } from '../../analytics/performance.js';

const router = Router();

// GET /api/expectancy?days=30
router.get('/', async (req, res) => {
  try {
    const days = Math.max(1, parseInt(req.query.days ?? '30', 10) || 30);
    const trades = await getClosedTradesForPeriod(days);
    const { expectancy, profitFactor, winRate, totalTrades, avgWinR, avgLossR } = computePerformance(trades);
    res.json({ expectancy, profitFactor, winRate, totalTrades, avgWinR, avgLossR });
  } catch (err) {
    console.error('[/api/expectancy]', err.message);
    res.status(500).json({ error: 'Failed to compute expectancy' });
  }
});

export default router;
