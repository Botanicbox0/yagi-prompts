/**
 * The repository's vitest config plus the measurement recorder (record-setup.ts). Used only for the
 * threshold measurement (docs/PROMPT-GUARD.md "How the thresholds were chosen"):
 *
 *   PROMPT_GUARD_MEASURE_OUT=<file outside the repo> npx vitest run --config tests/ai-guard/measure/vitest.measure.config.ts tests/brand-studio
 */
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';
import base from '../../../vitest.config';

export default mergeConfig(
  base,
  defineConfig({
    test: { setupFiles: [fileURLToPath(new URL('./record-setup.ts', import.meta.url))] },
  }),
);
