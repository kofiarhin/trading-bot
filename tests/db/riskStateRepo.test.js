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
const { etDateString } = await import('../../src/utils/time.js');

function makeDoc(overrides = {}) {
  const raw = {
    key: 'risk-state',
    date: etDateString(),
    halted: false,
    dailyLossPct: 0,
    dailyRealizedLoss: 0,
    cooldowns: new Map(),
    toObject() {
      return {
        key: this.key,
        date: this.date,
        halted: this.halted,
        dailyLossPct: this.dailyLossPct,
        dailyRealizedLoss: this.dailyRealizedLoss,
        cooldowns: this.cooldowns,
      };
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
      const stateInput = { date: etDateString(), dailyRealizedLoss: 100, cooldowns: {} };
      const doc = makeDoc({ dailyRealizedLoss: 100 });
      RiskState.findOneAndUpdate.mockResolvedValue(doc);

      await saveRiskState(stateInput);
      expect(RiskState.findOneAndUpdate).toHaveBeenCalledWith(
        { key: 'risk-state' },
        expect.objectContaining({ dailyRealizedLoss: 100 }),
        expect.objectContaining({ upsert: true }),
      );
    });
  });

  describe('recordDailyLoss', () => {
    it('increments dailyRealizedLoss atomically', async () => {
      RiskState.findOne.mockResolvedValue(makeDoc());
      const doc = makeDoc({ dailyRealizedLoss: 150 });
      RiskState.findOneAndUpdate.mockResolvedValue(doc);

      await recordDailyLoss(50);
      expect(RiskState.findOneAndUpdate).toHaveBeenCalledWith(
        { key: 'risk-state' },
        expect.objectContaining({ $inc: { dailyRealizedLoss: 50 } }),
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
          return {
            key: this.key,
            date: this.date,
            halted: this.halted,
            dailyLossPct: this.dailyLossPct,
            dailyRealizedLoss: this.dailyRealizedLoss,
            cooldowns: this.cooldowns,
          };
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
          return {
            key: this.key,
            date: this.date,
            halted: this.halted,
            dailyLossPct: this.dailyLossPct,
            dailyRealizedLoss: this.dailyRealizedLoss,
            cooldowns: this.cooldowns,
          };
        },
      });
      RiskState.findOne.mockResolvedValue(doc);

      const result = await isInCooldown('BTCUSD');
      expect(result).toBe(false);
    });
  });

  describe('setCooldown', () => {
    it('sets cooldown expiry for a crypto symbol (6h)', async () => {
      RiskState.findOne.mockResolvedValue(makeDoc());
      RiskState.findOneAndUpdate.mockResolvedValue(makeDoc());

      await setCooldown('BTCUSD', 'crypto');
      expect(RiskState.findOneAndUpdate).toHaveBeenCalledWith(
        { key: 'risk-state' },
        expect.objectContaining({
          $set: expect.objectContaining({ 'cooldowns.BTCUSD': expect.any(String) }),
        }),
        expect.objectContaining({ upsert: true }),
      );
    });
  });
});
