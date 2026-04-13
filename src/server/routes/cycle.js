import { Router } from 'express';

import { runAutopilotCycle } from '../../autopilot.js';
import { getCycleRuntime } from '../../repositories/cycleRuntimeRepo.mongo.js';

const router = Router();

router.post('/run', async (_req, res) => {
  try {
    const runtime = await getCycleRuntime();
    if (runtime?.status === 'running') {
      return res.status(409).json({
        ok: false,
        error: 'cycle_already_running',
        runtime,
      });
    }

    const result = await runAutopilotCycle();
    return res.status(200).json({ ok: true, summary: result.summary });
  } catch (error) {
    if (error?.code === 'CYCLE_ALREADY_RUNNING') {
      const runtime = await getCycleRuntime();
      return res.status(409).json({ ok: false, error: 'cycle_already_running', runtime });
    }

    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

router.get('/runtime', async (_req, res) => {
  try {
    const runtime = await getCycleRuntime();
    return res.json({
      status: runtime.status,
      stage: runtime.stage,
      progressPct: runtime.progressPct,
      metrics: runtime.metrics ?? {},
      startedAt: runtime.startedAt ?? null,
      completedAt: runtime.completedAt ?? null,
      failedAt: runtime.failedAt ?? null,
      updatedAt: runtime.updatedAt ?? null,
      lastError: runtime.lastError ?? null,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
