import { describe, it, expect } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

describe('canonical config consumers', () => {
  it('preFilter does not use direct env reads', () => {
    const source = fs.readFileSync(path.resolve('src/preFilter.js'), 'utf8');
    expect(source).toContain('runtimeConfig.prefilter');
    expect(source).not.toMatch(/process\.env/);
  });

  it('breakoutStrategy does not use direct env reads', () => {
    const source = fs.readFileSync(path.resolve('src/strategies/breakoutStrategy.js'), 'utf8');
    expect(source).toContain('runtimeConfig.strategy');
    expect(source).not.toMatch(/process\.env/);
  });

  it('portfolioRisk does not use direct env reads', () => {
    const source = fs.readFileSync(path.resolve('src/risk/portfolioRisk.js'), 'utf8');
    expect(source).toContain('runtimeConfig.risk');
    expect(source).not.toMatch(/process\.env/);
  });
});
