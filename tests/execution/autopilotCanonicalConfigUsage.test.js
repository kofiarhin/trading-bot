import { describe, it, expect } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

describe('autopilot canonical config usage', () => {
  it('does not read legacy/raw env keys directly inside runtime pipeline', () => {
    const source = fs.readFileSync(path.resolve('src/autopilot.js'), 'utf8');
    expect(source).not.toMatch(/process\.env\.(AUTOPILOT_SYMBOLS|SYMBOLS|WATCHLIST|TICKERS|ENABLE_STOCKS|ENABLE_CRYPTO|MAX_CANDIDATES_PER_CYCLE)/);
  });

  it('uses canonical config values for symbol/universe and cycle limits', () => {
    const source = fs.readFileSync(path.resolve('src/autopilot.js'), 'utf8');
    expect(source).toContain('config.trading.symbols');
    expect(source).toContain('config.trading.enableStocks');
    expect(source).toContain('config.trading.enableCrypto');
    expect(source).toContain('config.trading.maxCandidatesPerCycle');
  });
});
