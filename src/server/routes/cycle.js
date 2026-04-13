import { Router } from 'express';

import { runAutopilotCycle } from '../../autopilot.js';
import {
  getCycleRuntime,
  recoverStaleRunningCycle,
  CycleAlreadyRunningError,
} from '../../repositories/cycleRuntimeRepo.mongo.js';

const router = Router();

function hasValidCronSecret(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const authHeader = req.headers.authorization ?? '';
  const [scheme, token] = authHeader.split(' ');
  return scheme === 'Bearer' && token === expected;
}

router.post('/run', async (req, res) => {
  try {
    if (!hasValidCronSecret(req)) {
      return res.status(401).json({
        ok: false,
        code: 'UNAUTHORIZED',
        message: 'Unauthorized',
      });
    }

    await recoverStaleRunningCycle();
    const result = await runAutopilotCycle();

    return res.status(200).json({
      ok: true,
      cycleId: result.cycleId ?? result.summary?.cycleId ?? null,
      status: result.status ?? 'completed',
      summary: result.summary ?? null,
    });
  } catch (error) {
    if (error instanceof CycleAlreadyRunningError || error?.code === 'CYCLE_ALREADY_RUNNING') {
      return res.status(409).json({
        ok: false,
        code: 'CYCLE_ALREADY_RUNNING',
        message: 'Cycle already running',
        cycleId: error.cycleId ?? null,
      });
    }

    return res.status(500).json({
      ok: false,
      code: 'CYCLE_RUN_FAILED',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

router.get('/runtime', async (_req, res) => {
  try {
    const runtime = await getCycleRuntime();
    return res.json(runtime);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
