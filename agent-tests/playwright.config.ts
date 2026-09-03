import { defineConfig, devices } from '@playwright/test';

// Dedicated config for the deterministic Web UI E2E suite under e2e/.
// Run:  cd agent-tests && pnpm test:e2e    (requires web :5173 + server :3100)
// Deliberately absent from the `test` task turbo runs in CI: these drive a
// live full stack, so they are opt-in rather than a per-PR gate.
// The legacy *.spec.ts at the agent-tests root are excluded; they predate the
// shared helpers/ foundation and are kept only for reference.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // One retry absorbs rare network jitter without masking real failures.
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'test-results/html-report' }],
  ],
  use: {
    baseURL: process.env.TARGET_URL || 'http://localhost:5173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Escape hatch for a broken or partial browser download. Playwright
        // pins one Chromium revision per version and refuses to start if that
        // exact build is missing or half-extracted — which is indistinguishable
        // from "Chromium does not work on this machine" unless you go looking
        // in the install directory. Point this at any working
        // chrome/chrome-headless-shell binary to run the suite anyway:
        //   PLAYWRIGHT_CHROMIUM_PATH=... pnpm test:e2e
        ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
          : {}),
      },
    },
  ],
});
