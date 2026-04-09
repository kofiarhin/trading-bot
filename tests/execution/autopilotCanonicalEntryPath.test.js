import fs from 'node:fs';
import path from 'node:path';

describe('autopilot canonical entry execution path', () => {
  it('imports placeOrder from the canonical order manager', () => {
    const autopilotSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/autopilot.js'),
      'utf8'
    );

    expect(autopilotSource).toMatch(
      /import\s*\{\s*placeOrder\s*\}\s*from\s*['"]\.\/execution\/orderManager\.js['"]/u
    );
    expect(autopilotSource).not.toMatch(
      /from\s*['"]\.\/execution\/placeOrder\.js['"]/u
    );
  });
});
