import { defineConfig, devices } from '@playwright/test'

// Minimal Playwright scaffold for the Spectre apps. This is a runnable
// starting point - a human extends it. By design it does NOT auto-start dev
// servers (webServer is left commented) so CI never hangs waiting on a port,
// and browsers are not downloaded in CI by default.
//
// To run locally against a live server:
//   1. npx playwright install chromium   (one-time browser download)
//   2. Start the app:  npm run dev:research  (and/or dev:trading)
//   3. E2E_BASE_URL=http://localhost:5180 npx playwright test
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5180',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'research',
      use: { ...devices['Desktop Chrome'], baseURL: process.env.E2E_RESEARCH_URL || process.env.E2E_BASE_URL || 'http://localhost:5180' },
    },
    {
      name: 'trading',
      use: { ...devices['Desktop Chrome'], baseURL: process.env.E2E_TRADING_URL || 'http://localhost:5181' },
    },
  ],
  // webServer intentionally disabled. Uncomment to let Playwright boot the
  // dev servers itself - but keep it off in CI to avoid hanging on ports.
  // webServer: [
  //   { command: 'npm run dev:research', port: 5180, reuseExistingServer: true },
  //   { command: 'npm run dev:trading', port: 5181, reuseExistingServer: true },
  // ],
})
