import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // One Electron app at a time: the tests drive real windows and real shells.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: '../../test-results',
  use: { trace: 'retain-on-failure' },
});
