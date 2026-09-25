// ────────────────────────────────────────────────────────────────
// Visual regression (D-34; docs/redesign/09-verification.md §4).
//
// Runs ONLY inside docker/vrt.Dockerfile (globalSetup refuses anything else).
// From any host: `pnpm vrt [--project stories] [--grep …] [--update]`.
//
//   stories   every Storybook story tagged `vrt` (on by default, `!vrt` opts
//             out), from the static build served on :6007; `vrt-themes`
//             stories in Instrument dark + Instrument light + Solarized light.
//   routes    TODO(P3-08): ~12 app routes against the seeded isolated server
//             (P2-00's scripts/redesign/sandbox.mjs topology: API :3197, app
//             :5197) at 1440×900 and 1100×760 (09 §4.2, §4.3). The project and
//             its webServer entries are declared behind GAI_VRT_ROUTES=1 so
//             P3-08 only has to add routes/*.vrt.ts and the baselines; until
//             then nothing matches and no server is started.
// ────────────────────────────────────────────────────────────────

import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const WEB_DIR = join(REPO, 'apps', 'web');

export const STORYBOOK_PORT = 6007;
const ROUTES = process.env['GAI_VRT_ROUTES'] === '1';

const storybookServer: NonNullable<PlaywrightTestConfig['webServer']> = {
  // The static build (build-storybook runs in the image), not `storybook dev`.
  command: `pnpm exec vite preview --outDir storybook-static --port ${STORYBOOK_PORT} --strictPort --host 127.0.0.1`,
  cwd: WEB_DIR,
  url: `http://127.0.0.1:${STORYBOOK_PORT}/index.json`,
  reuseExistingServer: false,
  timeout: 60_000,
};

export default defineConfig({
  testDir: HERE,
  testMatch: '**/*.vrt.ts',
  globalSetup: join(HERE, 'global-setup.ts'),
  // One platform only (the container), so no `-{platform}` suffix.
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  outputDir: join(REPO, 'agent-tests', 'test-results', 'vrt'),
  retries: 0,
  workers: 2,
  fullyParallel: true,
  forbidOnly: true,
  reporter: [['list'], ['html', { outputFolder: join(REPO, 'agent-tests', 'test-results', 'vrt-report'), open: 'never' }]],
  use: {
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    timezoneId: 'UTC',
    locale: 'en-US',
  },
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      threshold: 0.2,
      maxDiffPixelRatio: 0.0005,
      stylePath: join(HERE, 'vrt.css'),
    },
  },
  projects: [
    {
      name: 'stories',
      testMatch: 'stories.vrt.ts',
      use: { baseURL: `http://127.0.0.1:${STORYBOOK_PORT}` },
    },
    ...(ROUTES
      ? [
          {
            name: 'routes',
            testMatch: 'routes/**/*.vrt.ts',
            // Routes tolerate a little more anti-aliasing noise than stories (09 §4.4).
            expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.002 } },
            use: { baseURL: 'http://127.0.0.1:5197' },
          },
        ]
      : []),
  ],
  // TODO(P3-08): when ROUTES, add the seeded API server (:3197, temp DB_PATH/
  // ARTIFACTS_DIR/WORKSPACES_DIR, GENERATORAI_TEST_FAUX_HARNESS=true,
  // GENERATORAI_TEST_FAUX_SCRIPT=fixtures/sandbox.faux.json) and `vite preview`
  // of the app build (:5197, GENERATORAI_DEV_API_TARGET=http://127.0.0.1:3197),
  // then run seed.ts before the specs.
  webServer: [storybookServer],
});
