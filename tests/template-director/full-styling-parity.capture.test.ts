import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { collectFullCompileOutputs, collectFullReadOutputs, digest } from './full-styling-parity.cases';

/**
 * Writes the full-block styling parity goldens. Runs only when asked:
 *   CAPTURE_FULL_STYLING_GOLDENS=1 CAPTURE_FULL_STYLING_FROM=<commit> npx vitest run tests/template-director/full-styling-parity.capture.test.ts
 * The committed goldens were captured on origin/main ead9f230, before a missing hair or makeup line read as the photo.
 */
const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'full-styling-parity.golden.json');

describe.runIf(process.env.CAPTURE_FULL_STYLING_GOLDENS === '1')('capture full-block styling parity goldens', () => {
  it('writes every case digest', async () => {
    const compile = await collectFullCompileOutputs();
    const read = collectFullReadOutputs();
    const golden = {
      capturedFrom: process.env.CAPTURE_FULL_STYLING_FROM ?? 'unknown',
      compile: Object.fromEntries(Object.entries(compile).map(([id, value]) => [id, `${value.length}:${digest(value)}`])),
      read: Object.fromEntries(Object.entries(read).map(([id, value]) => [id, `${value.length}:${digest(value)}`])),
    };
    mkdirSync(dirname(GOLDEN), { recursive: true });
    writeFileSync(GOLDEN, `${JSON.stringify(golden, null, 1)}\n`, 'utf8');
    expect(Object.keys(golden.compile).length).toBeGreaterThan(1000);
    expect(Object.keys(golden.read).length).toBeGreaterThan(100);
  }, 600_000);
});
