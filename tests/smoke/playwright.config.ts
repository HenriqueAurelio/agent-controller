import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'app.spec.ts',
  workers: 1,
  reporter: 'list',
  outputDir: '../../test-results',
});
