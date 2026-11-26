/**
 * PROMPT_GUARD=off changes nothing, byte for byte (docs/PROMPT-GUARD.md "Modes"). The snapshots under
 * `__snapshots__/off/` were written by this file on origin/main 889dcc1e, before the guard existed: every
 * request body the two reference sites sent and every answer they returned, for each case and each fake
 * model answer of the proof harness (benign and the five leaks). With the guard off the same inputs must
 * still produce exactly those bytes.
 */
import { describe, expect, it } from 'vitest';
import { ANSWER_KINDS, leakingFetch } from './leaks';
import { REFERENCE_CASES, runSite } from './reference-cases';

const ENV_OFF = { GEMINI_API_KEY: 'test-key', PROMPT_GUARD: 'off' } as const;

describe('PROMPT_GUARD=off: the reference sites send and answer exactly what origin/main did', () => {
  it.each(REFERENCE_CASES.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    const record: Record<string, unknown> = {};
    for (const kind of ANSWER_KINDS) {
      const { calls, fetchImpl } = leakingFetch(kind, c);
      const fallbacks: string[] = [];
      const result = await runSite(c, ENV_OFF, fetchImpl, (reason) => fallbacks.push(reason));
      record[kind] = { calls, result, fallbacks };
    }
    await expect(`${JSON.stringify(record, null, 2)}\n`).toMatchFileSnapshot(`./__snapshots__/off/${c.id}.json`);
  });
});
