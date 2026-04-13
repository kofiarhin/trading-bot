// Tests that performance summary calculations exclude broker_sync records,
// so journal stats only reflect real strategy trades.
import { beforeAll, afterAll, beforeEach, describe, expect, it } from '@jest/globals';
import { clearMongoHarness, startMongoHarness, stopMongoHarness } from '../helpers/mongoHarness.js';

let upsertClosedTrade;
let getClosedTrades;

beforeAll(async () => {
  await startMongoHarness('journal-summary-stats-test');
  ({ upsertClosedTrade } = await import('../../src/repositories/tradeJournalRepo.mongo.js'));
  ({ getClosedTrades } = await import('../../src/journal/tradeJournal.js'));
});

beforeEach(async () => {
  await clearMongoHarness();
});

afterAll(async () => {
  await stopMongoHarness();
});

function makeClosedTrade(overrides = {}) {
  const { randomUUID } = await import('node:crypto');
  return {
    tradeId: Math.random().toString(36).slice(2),
    symbol: overrides.symbol ?? 'AAPL',
    normalizedSymbol: overrides.normalizedSymbol ?? 'AAPL',
    assetClass: overrides.assetClass ?? 'stock',
    strategyName: overrides.strategyName ?? 'momentum_breakout_atr_v1',
    status: 'closed',
    side: 'buy',
    entryPrice: overrides.entryPrice ?? 150,
    exitPrice: overrides.exitPrice ?? 162,
    quantity: overrides.quantity ?? 5,
    riskAmount: overrides.riskAmount ?? 25,
    pnl: overrides.pnl ?? 60,
    pnlPct: overrides.pnlPct ?? 8,
    openedAt: new Date().toISOString(),
    closedAt: new Date().toISOString(),
    exitReason: overrides.exitReason ?? 'target_hit',
    ...overrides,
  };
}

describe('Journal summary stats — broker_sync exclusion', () => {
  it('getClosedTrades returns both strategy and broker_sync records', async () => {
    // Persist one real strategy trade and one broker_sync trade.
    await upsertClosedTrade(makeClosedTrade({ strategyName: 'momentum_breakout_atr_v1', pnl: 60 }));
    await upsertClosedTrade(makeClosedTrade({ symbol: 'TSLA', strategyName: 'broker_sync', pnl: -10 }));

    const all = await getClosedTrades();
    expect(all).toHaveLength(2);
  });

  it('filtering out broker_sync records gives correct trade count and pnl', async () => {
    await upsertClosedTrade(makeClosedTrade({ strategyName: 'momentum_breakout_atr_v1', pnl: 60 }));
    await upsertClosedTrade(makeClosedTrade({ symbol: 'TSLA', strategyName: 'broker_sync', pnl: -10 }));

    const all = await getClosedTrades();
    const strategyOnly = all.filter((t) => t.strategyName !== 'broker_sync' && t.pnl != null);

    expect(strategyOnly).toHaveLength(1);
    expect(strategyOnly[0].pnl).toBe(60);
    // broker_sync pnl (-10) must NOT be included in the total
    const totalPnl = strategyOnly.reduce((sum, t) => sum + t.pnl, 0);
    expect(totalPnl).toBe(60);
  });

  it('win rate calculation excludes broker_sync trades', async () => {
    // Two strategy wins, one strategy loss, one broker_sync loss.
    await upsertClosedTrade(makeClosedTrade({ strategyName: 'momentum_breakout_atr_v1', pnl: 50 }));
    await upsertClosedTrade(makeClosedTrade({ symbol: 'MSFT', strategyName: 'momentum_breakout_atr_v1', pnl: 30 }));
    await upsertClosedTrade(makeClosedTrade({ symbol: 'NVDA', strategyName: 'momentum_breakout_atr_v1', pnl: -20 }));
    await upsertClosedTrade(makeClosedTrade({ symbol: 'TSLA', strategyName: 'broker_sync', pnl: -100 }));

    const all = await getClosedTrades();
    const strategyOnly = all.filter((t) => t.strategyName !== 'broker_sync' && t.pnl != null);

    const winners = strategyOnly.filter((t) => t.pnl > 0);
    const winRate = (winners.length / strategyOnly.length) * 100;

    // 2 wins out of 3 strategy trades = 66.67%, not affected by broker_sync loss
    expect(strategyOnly).toHaveLength(3);
    expect(winRate).toBeCloseTo(66.67, 0);
  });
});

describe('Canonical riskAmount — total planned dollar risk', () => {
  it('riskAmount on a closed trade reflects total dollar risk (accountEquity × riskPercent)', async () => {
    // accountEquity = 10_000, riskPercent = 0.005 → riskAmount should be ~50
    const { evaluateBreakout } = await import('../../src/strategies/breakoutStrategy.js');

    // Build a minimal set of valid breakout bars.
    const count = 30;
    const bars = [];
    for (let i = 0; i < count; i++) {
      const c = 100 + i * 0.05;
      bars.push({ t: new Date(Date.now() - (count - i) * 900_000).toISOString(), o: c - 0.1, h: c + 0.5, l: c - 0.5, c, v: 1_500_000 });
    }
    // Last bar breaks out at ~0.8% above prior highest high.
    const highestHigh = Math.max(...bars.slice(-21, -1).map((b) => b.h));
    const breakoutClose = highestHigh * 1.008;
    bars[bars.length - 1] = { ...bars[bars.length - 1], h: breakoutClose + 0.5, c: breakoutClose, v: 2_500_000 };

    const decision = evaluateBreakout({
      symbol: 'AAPL',
      assetClass: 'stock',
      bars,
      accountEquity: 10_000,
      riskPercent: 0.005,
    });

    expect(decision.approved).toBe(true);
    // Total planned risk ≈ 10_000 × 0.005 = 50
    expect(decision.riskAmount).toBeCloseTo(50, 0);
    // Verify it is NOT equal to per-share risk (which would be much smaller, ~0.7–1.5)
    const riskPerShare = decision.entryPrice - decision.stopLoss;
    expect(decision.riskAmount).toBeGreaterThan(riskPerShare * 2);
  });
});
