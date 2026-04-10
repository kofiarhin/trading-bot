import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.unstable_mockModule('../../src/models/RiskState.js', () => ({
  default: {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  },
}));

const { default: RiskState } = await import('../../src/models/RiskState.js');
const {
  loadRiskState,
  saveRiskState,
  recordDailyLoss,
  getDailyLoss,
  setCooldown,
  isInCooldown,
} = await import('../../src/repositories/riskStateRepo.mongo.js');

function makeDoc(overrides = {}) {
  const raw = {
    date: '2026-04-10',
    dailyRealizedLoss: 0,
    cooldowns: new Map(),
    toObject() {
      return { date: this.date, dailyRealizedLoss: this.dailyRealizedLoss, cooldowns: this.cooldowns };
    },
    ...overrides,
  };
  return raw;
}

describe('riskStateRepo.mongo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('loadRiskState', () => {
    it('returns existing state for today', async () => {
      const doc = makeDoc({ dailyRealizedLoss: 50 });
      RiskState.findOne.mockResolvedValue(doc);

      const state = await loadRiskState();
      expect(state.dailyRealizedLoss).toBe(50);
    });

    it('creates a fresh state when none exists', async () => {
      RiskState.findOne.mockResolvedValue(null);
      const fresh = makeDoc();
      RiskState.findOneAndUpdate.mockResolvedValue(fresh);

      const state = await loadRiskState();
      expect(state.dailyRealizedLoss).toBe(0);
    });
  });

  describe('saveRiskState', () => {
    it('upserts the state document', async () => {
      const stateInput = { date: '2026-04-10', dailyRealizedLoss: 100, cooldowns: {} };
      const doc = makeDoc({ dailyRealizedLoss: 100 });
      RiskState.findOneAndUpdate.mockResolvedValue(doc);

      await saveRiskState(stateInput);
      expect(RiskState.findOneAndUpdate).toHaveBeenCalledWith(
        { date: '2026-04-10' },
        expect.objectContaining({ dailyRealizedLoss: 100 }),
        expect.objectContaining({ upsert: true }),
      );
    });
  });

  describe('recordDailyLoss', () => {
    it('increments dailyRealizedLoss atomically', async () => {
      const doc = makeDoc({ dailyRealizedLoss: 150 });
      RiskState.findOneAndUpdate.mockResolvedValue(doc);

      await recordDailyLoss(50);
      expect(RiskState.findOneAndUpdate).toHaveBeenCalledWith(
        expect.any(Object),
        { $inc: { dailyRealizedLoss: 50 } },
        expect.objectContaining({ upsert: true }),
      );
    });
  });

  describe('isInCooldown', () => {
    it('returns false when symbol has no cooldown', async () => {
      const doc = makeDoc({ cooldowns: new Map() });
      RiskState.findOne.mockResolvedValue(doc);

      const result = await isInCooldown('BTCUSD');
      expect(result).toBe(false);
    });

    it('returns true when symbol cooldown has not expired', async () => {
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const doc = makeDoc({
        cooldowns: new Map([['BTCUSD', future]]),
        toObject() {
          return { date: this.date, dailyRealizedLoss: this.dailyRealizedLoss, cooldowns: this.cooldowns };
        },
      });
      RiskState.findOne.mockResolvedValue(doc);

      const result = await isInCooldown('BTCUSD');
      expect(result).toBe(true);
    });

    it('returns false when symbol cooldown has expired', async () => {
      const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const doc = makeDoc({
        cooldowns: new Map([['BTCUSD', past]]),
        toObject() {
          return { date: this.date, dailyRealizedLoss: this.dailyRealizedLoss, cooldowns: this.cooldowns };
        },
      });
      RiskState.findOne.mockResolvedValue(doc);

      const result = await isInCooldown('BTCUSD');
      expect(result).toBe(false);
    });
  });

  describe('setCooldown', () => {
    it('sets cooldown expiry for a crypto symbol (6h)', async () => {
      RiskState.findOneAndUpdate.mockResolvedValue(makeDoc());

      await setCooldown('BTCUSD', 'crypto');
      expect(RiskState.findOneAndUpdate).toHaveBeenCalledWith(
        expect.any(Object),
        { $set: { 'cooldowns.BTCUSD': expect.any(String) } },
        expect.objectContaining({ upsert: true }),
      );
    });
  });
});
