import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Smoke tests against the real agents. They use the logged-in account and consume credits, so
// they run on demand (`npm run test:smoke`), never in the regular CI.
export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(__dirname, '../../src/core'),
      '@shared': resolve(__dirname, '../../src/shared'),
    },
  },
  test: {
    root: resolve(__dirname, '../..'),
    include: ['tests/smoke/**/*.smoke.ts'],
    environment: 'node',
    testTimeout: 240_000,
    hookTimeout: 120_000,
    pool: 'forks',
    fileParallelism: false,
    sequence: { concurrent: false },
    disableConsoleIntercept: true,
  },
});
