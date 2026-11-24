import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NO_LOCKS, parseTemplateLocks } from '@/lib/template-director';
import { PARITY_BASES, collectCompileOutputs, collectTurnOutputs, digest } from './no-locks-parity.cases';

/**
 * docs/PERSONAL-STUDIO.md §3.3 (C1) — the invariant: a prompt WITHOUT a `Template locks:` header compiles, rewrites
 * and answers byte-identically to origin/main 10124dc0, with the edit-sheet flag on or off and with or without a key.
 * The goldens were captured on 10124dc0 before the locks code existed (see `no-locks-parity.cases.ts`).
 */
const golden = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'no-locks-parity.golden.json'), 'utf8'),
) as { capturedFrom: string; compile: Record<string, string>; turns: Record<string, string> };

function mismatches(expected: Record<string, string>, actual: Record<string, string>): string[] {
  const ids = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  return [...ids].filter((id) => !actual[id] || expected[id] !== `${actual[id]!.length}:${digest(actual[id]!)}`);
}

describe('no-locks parity with origin/main 10124dc0', () => {
  it('the goldens come from 10124dc0 and cover the matrix', () => {
    expect(golden.capturedFrom).toBe('10124dc0');
    expect(Object.keys(golden.compile)).toHaveLength(1710);
    expect(Object.keys(golden.turns)).toHaveLength(264);
  });

  it('no parity base has a header', () => {
    for (const base of Object.values(PARITY_BASES)) expect(parseTemplateLocks(base)).toBe(NO_LOCKS);
  });

  it('compile: prompt, path and rewrite bodies are string-equal to the goldens (flag on/off, key/no key/failing key)', async () => {
    const actual = await collectCompileOutputs();
    expect(mismatches(golden.compile, actual).slice(0, 10)).toEqual([]);
  });

  it('Stage 1: request bodies and results are string-equal without `locks`', async () => {
    const actual = await collectTurnOutputs();
    expect(mismatches(golden.turns, actual).slice(0, 10)).toEqual([]);
  });

  it('Stage 1: request bodies and results are string-equal with `locks: NO_LOCKS`', async () => {
    const actual = await collectTurnOutputs({ locks: NO_LOCKS });
    expect(mismatches(golden.turns, actual).slice(0, 10)).toEqual([]);
  });
});
