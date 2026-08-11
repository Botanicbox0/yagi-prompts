import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': root.replace(/[\\/]$/, ''),
    },
  },
  // The §6.1 renderer-contract suite renders real components with `react-dom/server`. tsconfig keeps
  // `jsx: preserve` for Next, so the test transform needs the automatic runtime spelled out here.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // PGlite boots a WASM Postgres per suite; give migrations room on cold CI runners.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
  },
});
