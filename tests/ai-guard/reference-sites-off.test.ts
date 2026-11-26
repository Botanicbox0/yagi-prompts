/**
 * PROMPT_GUARD off changes nothing, byte for byte (docs/PROMPT-GUARD.md "Modes"). The snapshots under
 * `__snapshots__/off/` were written by this file on origin/main 889dcc1e, before the guard existed: every
 * request body the two reference sites sent and every answer they returned, for each case and each fake
 * model answer of the proof harness (benign and the six leaks). With the guard off (`PROMPT_GUARD=off`, and
 * the variable unset, which is the default) the same inputs must still produce exactly those bytes.
 */
import { describe, expect, it } from 'vitest';
import { ANSWER_KINDS, leakingFetch } from './leaks';
import { ROWS } from './rows';

const TABLE = ROWS.flatMap((row) => row.cases.map((c) => [c.id, row, c] as const));

async function record(row: (typeof ROWS)[number], c: (typeof ROWS)[number]['cases'][number], env: Record<string, string | undefined>) {
  const out: Record<string, unknown> = {};
  for (const kind of ANSWER_KINDS) {
    const { calls, fetchImpl } = leakingFetch(kind, c);
    const fallbacks: string[] = [];
    const result = await row.record(c, env, fetchImpl, (reason) => fallbacks.push(reason));
    out[kind] = { calls, result, fallbacks };
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

describe('PROMPT_GUARD=off: the reference sites send and answer exactly what origin/main did', () => {
  it.each(TABLE)('%s', async (_id, row, c) => {
    await expect(await record(row, c, { GEMINI_API_KEY: 'test-key', PROMPT_GUARD: 'off' })).toMatchFileSnapshot(`./__snapshots__/off/${c.id}.json`);
  });
});

describe('PROMPT_GUARD unset (the default): the same bytes as origin/main', () => {
  it.each(TABLE)('%s', async (_id, row, c) => {
    await expect(await record(row, c, { GEMINI_API_KEY: 'test-key' })).toMatchFileSnapshot(`./__snapshots__/off/${c.id}.json`);
    await expect(await record(row, c, { GEMINI_API_KEY: 'test-key', PROMPT_GUARD: '' })).toMatchFileSnapshot(`./__snapshots__/off/${c.id}.json`);
  });
});
