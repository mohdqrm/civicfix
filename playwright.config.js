// End-to-end tests drive a real Chrome browser against the running app.
//   npm run build && npm run start   (Express serves the API and the built React app on :4000)
//   npm run test:e2e
// Uses the development database and the demo admin from `npm run db:seed`.
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:4000';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Use an installed Chrome when available (set PW_CHROME=/path/to/chrome), else Playwright's Chromium.
    launchOptions: process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } }, testIgnore: /responsive/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /responsive/ },
  ],
  webServer: {
    command: 'npm run build && npm run start',
    url: `${baseURL}/api/health`,
    reuseExistingServer: true,
    // Browser tests log in many times from one IP; raise the login limit for the test server only.
    env: { RATE_LIMIT_AUTH: '1000' },
    timeout: 120_000,
  },
});
