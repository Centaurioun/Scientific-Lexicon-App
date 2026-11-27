import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/qualification',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: 'qualification-results/production-traces',
  use: {
    baseURL: 'http://127.0.0.1:3200',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npm run start -- --port 3200',
    url: 'http://127.0.0.1:3200',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
