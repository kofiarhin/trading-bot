import { Router } from 'express';
import { getPositions } from '../../lib/alpaca.js';
import { getOpenTrades } from '../../journal/tradeJournal.js';
import { getAccount } from '../../lib/alpaca.js';
import { computeExposure } from '../../analytics/exposure.js';

const router = Router();

// GET /api/exposure
router.get('/', async (req, res) => {
  try {
    const [openTrades, brokerPositions, account] = await Promise.all([
      getOpenTrades(),
      getPositions(),
      getAccount(),
    ]);

    const accountEquity = Number(account?.equity ?? 0);
    const exposure = computeExposure({ openTrades, brokerPositions, accountEquity });
    res.json(exposure);
  } catch (err) {
    console.error('[/api/exposure]', err.message);
    res.status(500).json({ error: 'Failed to compute exposure' });
  }
});

export default router;
