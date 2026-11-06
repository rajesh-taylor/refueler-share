// Playwright for the harness tests only (H2 Browser-KAT-1, H3 Smoke-1). Real built app, fake Worker,
// real CSP. tests/e2e/share-link.spec.js is the older headed check against the LIVE site and
// stays out of here on purpose: nothing in this config touches production.
//   dev/share-harness/build.sh && npx playwright test --project=webkit
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'dev/share-harness/tests',
  testMatch: '*.spec.mjs',
  outputDir: 'dev/share-harness/.out/test-results',
  // The fake Worker holds one set of failure switches (/_ctl), so tests never overlap.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: { baseURL: 'http://localhost:8765', acceptDownloads: true, trace: 'off' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [
    { command: 'node dev/share-harness/fake-worker.mjs', port: 8766, reuseExistingServer: false, stdout: 'ignore' },
    { command: 'node dev/share-harness/serve-app.mjs', port: 8765, reuseExistingServer: false },
    { command: 'node dev/share-harness/serve-gate.mjs', port: 8768, reuseExistingServer: false },
  ],
});
