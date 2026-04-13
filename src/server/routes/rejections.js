import { Router } from 'express';
import { getRejectionStats } from '../../repositories/analyticsRepo.mongo.js';

const router = Router();

// GET /api/rejections?days=7
router.get('/', async (req, res) => {
  try {
    const days = Math.max(1, parseInt(req.query.days ?? '7', 10) || 7);
    const stats = await getRejectionStats(days);
    res.json(stats);
  } catch (err) {
    console.error('[/api/rejections]', err.message);
    res.status(500).json({ error: 'Failed to fetch rejection stats' });
  }
});

export default router;
