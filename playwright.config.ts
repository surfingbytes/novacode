// node_modules
import { defineConfig, devices } from '@playwright/test';

// e2e
import { E2E_DASHBOARD_PORT, E2E_HOST } from './e2e/constants';

/** Smoke tests against a throwaway stack started by e2e/global-setup.ts. Run with `npm run test:e2e`. */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // one shared database and first-run setup: tests must run in order
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env['CI'] ? 'list' : [['list'], ['html', { open: 'never', outputFolder: 'e2e/.report' }]],
  outputDir: 'e2e/.results',
  use: {
    baseURL: `http://${E2E_HOST}:${E2E_DASHBOARD_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
