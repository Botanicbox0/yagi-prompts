/**
 * PROMPT_GUARD=off on the two product paths (docs/PROMPT-GUARD.md "Modes"): the free 설계 preview and the
 * paid run (prepare writes `final_prompt`, the engine moves the job, the allowance is used). The snapshots
 * under `__snapshots__/off-paths/` were written by this file on origin/main 889dcc1e, before the guard
 * existed; with the guard off every request, answer, job column, output, provider request and allowance
 * figure must still be exactly those.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { studioFixture, type StudioFixture } from '../brand-studio/server/helpers';
import type { AnswerKind } from './leaks';
import { PRODUCT_PATHS, runProductPath } from './product-paths';

const ENV_OFF = { GEMINI_API_KEY: 'test-key', PROMPT_GUARD: 'off' } as const;
const KINDS: readonly AnswerKind[] = ['benign', 'window60', 'canary'];

let f: StudioFixture;
beforeEach(async () => {
  f = await studioFixture({ capKrw: 5_000_000 });
});
afterEach(async () => {
  await f.db.close();
});

describe('PROMPT_GUARD=off: preview and paid run are exactly what origin/main did', () => {
  it.each(PRODUCT_PATHS.map((p) => [p.id, p] as const))('%s', async (_id, path) => {
    const record: Record<string, unknown> = {};
    for (const kind of KINDS) record[kind] = await runProductPath(f, path, kind, ENV_OFF);
    await expect(`${JSON.stringify(record, null, 2)}\n`).toMatchFileSnapshot(`./__snapshots__/off-paths/${path.id}.json`);
  });
});
