import fs from 'node:fs';
import path from 'node:path';

const autopilotSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/autopilot.js'),
  'utf8'
);

describe('autopilot source integrity', () => {
  it('imports placeOrder from the canonical order manager', () => {
    expect(autopilotSource).toMatch(
      /import\s*\{\s*placeOrder\s*\}\s*from\s*['"]\.\/execution\/orderManager\.js['"]/u
    );
    expect(autopilotSource).not.toMatch(
      /from\s*['"]\.\/execution\/placeOrder\.js['"]/u
    );
  });

  it('imports evaluateBreakout from the canonical strategy module — not a local buildDecision', () => {
    expect(autopilotSource).toMatch(
      /import\s*\{[^}]*evaluateBreakout[^}]*\}\s*from\s*['"]\.\/strategies\/breakoutStrategy\.js['"]/u
    );
  });

  it('does not define a local buildDecision function', () => {
    // buildDecision was the old inline strategy logic — it must be removed.
    expect(autopilotSource).not.toMatch(/function\s+buildDecision\s*\(/u);
  });

  it('does not import maybeForceTrade (force-trade is disabled from live flow)', () => {
    expect(autopilotSource).not.toMatch(
      /import\s*\{[^}]*maybeForceTrade[^}]*\}\s*from/u
    );
  });
});
