import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  test: {
    include: ['tests/core/**/*.test.ts', 'tests/shared/**/*.test.ts'],
    environment: 'node',
    // Generous on purpose: ending a process tree on a slow CI machine can take many seconds.
    testTimeout: 60000,
    hookTimeout: 60000,
    pool: 'forks',
  },
});
