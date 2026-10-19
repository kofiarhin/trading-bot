import { Router } from 'express';

import { getOpenTrades } from '../../journal/tradeJournal.js';
import { EXIT_FAILURE_ALERT_THRESHOLD } from '../../journal/tradeStatus.js';

const router = Router();

/**
 * Lists the safety problems on open trades, derived from the journal only
 * (read-only, no broker calls):
 *   protection_<status>  — no active broker-side stop (unfilled/missing/partial/failed/filled)
 *   entry_unverified     — entry price could not be verified
 *   exit_pending         — exit order accepted but not filled
 *   exit_failing         — repeated failed exit attempts
 */
export function collectSafetyAlerts(trades = []) {
  const alerts = [];
  for (const trade of trades) {
    if (!['open', 'closing'].includes(trade.status)) continue;
    const base = { tradeId: trade.tradeId, symbol: trade.symbol };
    const protection = trade.protection;

    if (protection && protection.status !== 'active') {
      alerts.push({
        ...base,
        type: `protection_${protection.status}`,
        severity: 'critical',
        owner: protection.owner ?? null,
        since: protection.unfilledSince ?? protection.checkedAt ?? null,
      });
    }
    if (trade.entryPriceSource === 'unverified') {
      alerts.push({ ...base, type: 'entry_unverified', severity: 'warning' });
    }
    if (trade.status === 'closing') {
      alerts.push({ ...base, type: 'exit_pending', severity: 'warning', since: trade.closingAt ?? null });
    }
    if (Number(trade.exitAttempts ?? 0) >= EXIT_FAILURE_ALERT_THRESHOLD) {
      alerts.push({
        ...base,
        type: 'exit_failing',
        severity: 'critical',
        exitAttempts: trade.exitAttempts,
        lastExitError: trade.lastExitError ?? null,
      });
    }
  }
  return alerts;
}

router.get('/', async (_req, res) => {
  try {
    const alerts = collectSafetyAlerts(await getOpenTrades());
    return res.json({
      ok: !alerts.some((a) => a.severity === 'critical'),
      alerts,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
