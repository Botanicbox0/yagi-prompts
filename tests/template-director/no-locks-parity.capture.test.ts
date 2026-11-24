import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { collectCompileOutputs, collectTurnOutputs, digest } from './no-locks-parity.cases';

/**
 * Writes the no-locks parity goldens. Runs only when asked:
 *   CAPTURE_NO_LOCKS_GOLDENS=1 npx vitest run tests/template-director/no-locks-parity.capture.test.ts
 * The committed goldens were captured on origin/main 10124dc0, before `lib/template-director/locks.ts` existed.
 */
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'no-locks-parity.golden.json');

describe.runIf(process.env.CAPTURE_NO_LOCKS_GOLDENS === '1')('capture no-locks parity goldens', () => {
  it('writes every case digest', async () => {
    const compile = await collectCompileOutputs();
    const turns = await collectTurnOutputs();
    const golden = {
      capturedFrom: process.env.CAPTURE_NO_LOCKS_FROM ?? 'unknown',
      compile: Object.fromEntries(Object.entries(compile).map(([id, value]) => [id, `${value.length}:${digest(value)}`])),
      turns: Object.fromEntries(Object.entries(turns).map(([id, value]) => [id, `${value.length}:${digest(value)}`])),
    };
    mkdirSync(dirname(GOLDEN), { recursive: true });
    writeFileSync(GOLDEN, `${JSON.stringify(golden, null, 1)}\n`, 'utf8');
    expect(Object.keys(golden.compile).length).toBeGreaterThan(1000);
    expect(Object.keys(golden.turns).length).toBeGreaterThan(100);
  });
});
