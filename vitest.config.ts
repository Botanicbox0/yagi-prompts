import { defineConfig } from 'vitest/config';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': root.replace(/[\\/]$/, ''),
      // `server-only` throws unless the bundler resolves it with the `react-server` condition (Next does, vitest
      // does not). Tests run on the server side, so they get the marker's empty build, as Server Components do.
      // Keeps the studio's server-only modules (e.g. lib/brand-studio/workflows/presets, loaded by prepare.ts,
      // jobs.ts and workflows/service.ts) importable in every test file without a per-file
      // `vi.mock('server-only', …)`; files that still mock it keep working. The build itself still fails if
      // client code ever imports one of them.
      'server-only': join(root, 'node_modules/server-only/empty.js'),
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
