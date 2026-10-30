import { defineConfig, devices } from '@playwright/test';

// 09 §8.2 — transcript virtualization spike. Headed, local Chrome; CI runs it
// headless as reporting-only (frame timing on shared runners is not a gate).
//   pnpm --filter @generatorai/agent-tests exec playwright test -c perf/playwright.perf.config.ts --headed
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.TARGET_URL || 'http://localhost:5173',
    viewport: { width: 1440, height: 900 },
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  },
  projects: [{ name: 'perf', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
