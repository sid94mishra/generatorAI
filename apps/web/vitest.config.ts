import { fileURLToPath } from 'node:url';
import { defineConfig, type TestProjectInlineConfiguration } from 'vitest/config';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import tailwindcss from '@tailwindcss/vite';

/**
 * The single Vitest config for the web app (docs/redesign/09-verification.md
 * §1.1, §3.4). `pnpm --filter @generatorai/web test`, turbo, CI and the root
 * `vitest.config.ts` all run the web tests through this file.
 *
 *   unit                         happy-dom component and logic tests
 *   storybook                    every story, rendered in headless Chromium:
 *                                play function + axe (a11y.test = 'error')
 *   storybook-instrument-light   the `vrt-themes` stories again, in the light
 *   storybook-solarized-light    and Solarized light combos (09 §9.1)
 *
 * `pnpm test` runs `unit`; `pnpm test:stories` runs the three storybook projects (listed by name: a quoted glob
 * is not portable to Windows cmd, an unquoted one expands to storybook-static/).
 */
const dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Exported so the repo-root `vitest.config.ts` runs the same project: Vitest
 * does not expand a `projects` list nested inside a referenced config.
 * Paths are absolute so they hold from either root.
 */
export const unitProject = {
  name: 'unit',
  globals: true,
  // A hang detector, not a speed check: every unit test waits on state
  // (findBy / waitFor / act), none on the clock. The page-level
  // characterization tests render whole screens in happy-dom (0.2–0.7 s
  // alone); when the whole repo's suites run at once on a laptop they run
  // 20–30× slower and the 5 s default failed a different handful each run,
  // always "timed out", never an assertion (final-review-2 addendum).
  testTimeout: 20_000,
  environment: 'happy-dom',
  setupFiles: [`${dirname}vitest.setup.ts`],
  include: ['src/**/*.test.{ts,tsx}'],
  root: dirname,
} as const;

/**
 * One browser project per appearance combo. Storybook pins the toolbar globals
 * per project (`initialGlobals`), so axe sees exactly what a user of that
 * theme sees. Chromium comes from Playwright's own download, not the Chrome
 * channel: CI has no Chrome (09 §3.4).
 */
function storybookProject(
  name: string,
  options: { initialGlobals?: Record<string, string>; includeTags?: string[] } = {},
): TestProjectInlineConfiguration {
  return {
    extends: true,
    plugins: [
      // A vitest.config.ts replaces vite.config.ts, so the app's Tailwind
      // pipeline must be added here: without it globals.css reaches the browser
      // unprocessed, every utility is missing and axe checks unstyled markup.
      tailwindcss(),
      storybookTest({
        configDir: `${dirname}.storybook`,
        storybookScript: 'pnpm storybook --ci',
        ...(options.initialGlobals ? { initialGlobals: options.initialGlobals } : {}),
        ...(options.includeTags ? { tags: { include: options.includeTags } } : {}),
      }),
    ],
    test: {
      name,
      setupFiles: [`${dirname}.storybook/vitest.setup.ts`],
      // The first story of a file also pays for its module graph and the
      // Tailwind-processed globals.css; on a loaded machine that alone passed
      // the 15 s default (three projects run at once).
      testTimeout: 60_000,
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        instances: [{ browser: 'chromium' }],
        // On a cold cache the page connects only after Vite's dependency scan
        // and pre-bundle (~55 s measured here, three projects sharing one
        // Storybook cache dir); the 60 s default failed the first run.
        connectTimeout: 180_000,
      },
    },
  };
}

export default defineConfig({
  // `@` is `apps/web/src` and nothing else — see `vite.config.ts`.
  resolve: { alias: { '@': `${dirname}src` } },
  test: {
    projects: [
      { extends: true, test: unitProject },
      storybookProject('storybook'),
      storybookProject('storybook-instrument-light', {
        initialGlobals: { mode: 'light', theme: 'instrument' },
        includeTags: ['vrt-themes'],
      }),
      storybookProject('storybook-solarized-light', {
        initialGlobals: { mode: 'light', theme: 'solarized' },
        includeTags: ['vrt-themes'],
      }),
    ],
  },
});
