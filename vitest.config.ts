import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': root.replace(/[\\/]$/, ''),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // PGlite boots a WASM Postgres per suite; give migrations room on cold CI runners.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
  },
});
