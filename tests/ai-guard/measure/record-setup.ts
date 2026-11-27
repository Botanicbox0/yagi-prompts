/**
 * Threshold measurement, step 1 (docs/PROMPT-GUARD.md "How the thresholds were chosen"). Not a test file:
 * loaded as a setup file by `vitest.measure.config.ts` for a normal run of the existing tests, it records every
 * outgoing check the adopted sites make (what the model answered, the internal text, the exempt input and the
 * allowed lines) as one JSON line per check in `$PROMPT_GUARD_MEASURE_OUT`. Step 2 (`grid.test.ts`) counts
 * refusals per threshold over that file. The recording holds our internal text: write it outside the repo.
 *
 * The guard is off when `PROMPT_GUARD` is unset (the default), and the existing tests do not set it, so during
 * a measurement an unset value is read as `observe`: the requests are guarded and every answer is checked.
 *
 *   PROMPT_GUARD_MEASURE_OUT=<file outside the repo> npx vitest run --config tests/ai-guard/measure/vitest.measure.config.ts tests/brand-studio
 */
import { appendFileSync } from 'node:fs';
import { expect, vi } from 'vitest';

vi.mock('@/lib/flags', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/flags')>();
  return {
    ...original,
    promptGuardMode: (env: Record<string, string | undefined> = process.env, site?: string, organizationId?: string | null) =>
      original.promptGuardMode(env.PROMPT_GUARD?.trim() ? env : { ...env, PROMPT_GUARD: 'observe' }, site, organizationId),
  };
});

vi.mock('@/lib/ai-guard/outgoing', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/ai-guard/outgoing')>();
  const out = process.env.PROMPT_GUARD_MEASURE_OUT;
  return {
    ...original,
    checkOutgoing(input: Parameters<typeof original.checkOutgoing>[0], prepared?: Parameters<typeof original.checkOutgoing>[1]) {
      const verdict = original.checkOutgoing(input, prepared);
      if (out) {
        const state = expect.getState();
        appendFileSync(
          out,
          `${JSON.stringify({
            file: state.testPath ?? null,
            test: state.currentTestName ?? null,
            fields: input.fields,
            internal: input.internal,
            canary: input.canary,
            exempt: input.exempt ?? [],
            allow: input.allow ?? [],
            shapes: input.shapes ?? null,
            refusals: verdict.refusals,
          })}\n`,
        );
      }
      return verdict;
    },
  };
});
