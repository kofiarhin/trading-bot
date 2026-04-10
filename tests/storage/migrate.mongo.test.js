import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { clearMongoHarness, startMongoHarness, stopMongoHarness } from '../helpers/mongoHarness.js';

let migrateStorageToMongo;
let readJson;

beforeAll(async () => {
  await startMongoHarness('migration-behavior-test');
  ({ migrateStorageToMongo } = await import('../../src/db/migrate.js'));
  ({ readJson } = await import('../../src/lib/storage.js'));
});

afterAll(async () => {
  await stopMongoHarness();
});

beforeEach(async () => {
  await clearMongoHarness();
});

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

describe('migrateStorageToMongo', () => {
  it('imports legacy JSON storage safely and idempotently', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trading-bot-migrate-'));

    try {
      writeJsonFile(path.join(tempRoot, 'trades', 'open.json'), [
        {
          tradeId: 'open-1',
          symbol: 'AAPL',
          normalizedSymbol: 'AAPL',
          status: 'open',
          openedAt: '2026-04-10T10:00:00.000Z',
        },
      ]);
      writeJsonFile(path.join(tempRoot, 'trades', 'closed.json'), [
        {
          tradeId: 'closed-1',
          symbol: 'MSFT',
          normalizedSymbol: 'MSFT',
          status: 'closed',
          openedAt: '2026-04-10T09:00:00.000Z',
          closedAt: '2026-04-10T11:00:00.000Z',
          pnl: 12,
        },
      ]);
      writeJsonFile(path.join(tempRoot, 'trades', 'events.json'), [
        {
          tradeId: 'closed-1',
          symbol: 'MSFT',
          type: 'trade_closed',
          timestamp: '2026-04-10T11:00:00.000Z',
          pnl: 12,
        },
      ]);
      writeJsonFile(path.join(tempRoot, 'decisions', '2026-04-10.json'), [
        {
          decisionId: 'decision-1',
          symbol: 'NVDA',
          approved: true,
          timestamp: '2026-04-10T10:30:00.000Z',
        },
      ]);
      writeJsonFile(path.join(tempRoot, 'logs', '2026-04-10.json'), [
        {
          cycleId: 'cycle-1',
          type: 'cycle_complete',
          timestamp: '2026-04-10T10:45:00.000Z',
          recordedAt: '2026-04-10T10:45:01.000Z',
          approved: 1,
        },
      ]);
      writeJsonFile(path.join(tempRoot, 'journal', '2026-04-10.json'), [
        {
          id: 'journal-1',
          type: 'trade_closed',
          tradeId: 'closed-1',
          symbol: 'MSFT',
          timestamp: '2026-04-10T11:00:00.000Z',
          pnl: 12,
        },
      ]);
      writeJsonFile(path.join(tempRoot, 'riskState.json'), {
        date: '2026-04-10',
        halted: false,
        dailyLossPct: 0.5,
        dailyRealizedLoss: 100,
        cooldowns: { NVDA: '2026-04-10T16:00:00.000Z' },
      });

      await migrateStorageToMongo({ storageRoot: tempRoot });
      await migrateStorageToMongo({ storageRoot: tempRoot });

      const [openTrades, closedTrades, events, decisions, logs, journal, riskState] = await Promise.all([
        readJson(path.join(tempRoot, 'trades', 'open.json'), []),
        readJson(path.join(tempRoot, 'trades', 'closed.json'), []),
        readJson(path.join(tempRoot, 'trades', 'events.json'), []),
        readJson(path.join(tempRoot, 'decisions', '2026-04-10.json'), []),
        readJson(path.join(tempRoot, 'logs', '2026-04-10.json'), []),
        readJson(path.join(tempRoot, 'journal', '2026-04-10.json'), []),
        readJson(path.join(tempRoot, 'riskState.json'), {}),
      ]);

      expect(openTrades).toHaveLength(1);
      expect(closedTrades).toHaveLength(1);
      expect(events).toHaveLength(1);
      expect(decisions).toHaveLength(1);
      expect(logs).toHaveLength(1);
      expect(journal).toEqual([
        expect.objectContaining({ tradeId: 'closed-1', type: 'trade_closed', symbol: 'MSFT' }),
      ]);
      expect(riskState).toEqual(expect.objectContaining({ dailyRealizedLoss: 100, dailyLossPct: 0.5 }));
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
