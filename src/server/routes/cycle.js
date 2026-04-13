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

// POST /api/cycle/manual-run
// Called by the dashboard. No CRON_SECRET required.
// Auth: env flag (ALLOW_MANUAL_TRIGGER=true) for v1.
router.post('/manual-run', async (req, res) => {
  if (process.env.ALLOW_MANUAL_TRIGGER !== 'true') {
    return res.status(403).json({ ok: false, code: 'MANUAL_TRIGGER_DISABLED' });
  }

  try {
    await recoverStaleRunningCycle();

    // Fire and forget — return 202 immediately
    runAutopilotCycle({}, 'manual').catch(() => {
      // Background errors are logged by runAutopilotCycle itself
    });

    const runtime = await getCycleRuntime({ recoverStale: false });
    return res.status(202).json({
      ok: true,
      cycleId: runtime?.cycleId,
      status: 'running',
      triggerSource: 'manual',
    });
  } catch (err) {
    if (err instanceof CycleAlreadyRunningError || err?.code === 'CYCLE_ALREADY_RUNNING') {
      return res.status(409).json({
        ok: false,
        code: 'CYCLE_ALREADY_RUNNING',
        cycleId: err.cycleId ?? null,
      });
    }
    return res.status(500).json({ ok: false, code: 'CYCLE_RUN_FAILED', message: err.message });
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
