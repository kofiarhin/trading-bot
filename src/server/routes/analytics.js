import { Router } from 'express';
import { getShortlistConversionStats, getScoreDistribution } from '../../repositories/analyticsRepo.mongo.js';

const router = Router();

// GET /api/analytics/conversion?days=7
router.get('/conversion', async (req, res) => {
  try {
    const days = Math.max(1, parseInt(req.query.days ?? '7', 10) || 7);
    const stats = await getShortlistConversionStats(days);
    res.json(stats);
  } catch (err) {
    console.error('[/api/analytics/conversion]', err.message);
    res.status(500).json({ error: 'Failed to fetch conversion stats' });
  }
});

// GET /api/analytics/scores?days=7
router.get('/scores', async (req, res) => {
  try {
    const days = Math.max(1, parseInt(req.query.days ?? '7', 10) || 7);
    const distribution = await getScoreDistribution(days);
    res.json(distribution);
  } catch (err) {
    console.error('[/api/analytics/scores]', err.message);
    res.status(500).json({ error: 'Failed to fetch score distribution' });
  }
});

export default router;
