import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Two projects, because the web tests need two things nothing else does: the
 * `@` alias and a DOM.
 *
 * Before this, `apps/web/src/__tests__` could not even RESOLVE its imports —
 * vitest reported each file as a failed suite with "no tests", so ~140 tests
 * looked like coverage while contributing nothing. `environmentMatchGlobs`
 * would have been the smaller change but is inert in Vitest 3.
 */
const EXCLUDE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.{idea,git,cache,output,temp}/**',
  // Sub-agent worktrees (.claude/worktrees/**, gitignored) carry their own
  // full checkout, including this same test suite. Without this, running
  // vitest from repo root silently double-runs (and double-reports) every
  // test that happens to exist in both trees — found during end-to-end
  // review when a single test file printed results twice.
  '**/.claude/**',
  // Playwright specs, not vitest ones. `agent-tests/` has its own
  // `playwright.config.ts`; collecting these here made all 18 fail with
  // "Playwright Test did not expect test.describe() to be called here",
  // which is a runner mismatch rather than anything about the code. Every
  // `*.spec.ts` in the repo lives under `agent-tests/`, so nothing else is
  // caught by this. The `*.test.ts` files there DO run under vitest and are
  // deliberately left in.
  'agent-tests/**/*.spec.ts',
];

/**
 * The suite leaks throwaway `gai-*` temp workspaces on Windows: the per-test
 * `rm` races SQLite / child-process handle release, fails with EPERM, and every
 * call site passes `force: true`, which swallows it. 6,807 directories
 * totalling 18.8 GB had accumulated over six days and taken the system disk to
 * 244 MB free.
 *
 * Sweeping after the run is the right place — the handles are gone by then, and
 * it cannot break a test.
 *
 * Two details that a first attempt got wrong, both of which produce a hook
 * that silently never runs:
 *   - Vitest has no `globalTeardown` option. A global setup FILE exports a
 *     `teardown`, and the option is `globalSetup`.
 *   - It must be declared PER PROJECT: an option sitting beside `projects` is
 *     ignored.
 */
const GLOBAL_SETUP = [resolve(import.meta.dirname, 'scripts/vitest-temp-teardown.mjs')];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'web',
          globals: true,
          globalSetup: GLOBAL_SETUP,
          passWithNoTests: true,
          environment: 'jsdom',
          setupFiles: [resolve(import.meta.dirname, 'apps/web/vitest.setup.ts')],
          include: ['apps/web/**/*.{test,spec}.{ts,tsx}'],
          exclude: EXCLUDE,
        },
        // `@` is `apps/web/src` and nothing else — see `apps/web/vite.config.ts`.
        resolve: {
          alias: { '@': resolve(import.meta.dirname, 'apps/web/src') },
        },
      },
      {
        test: {
          name: 'node',
          globals: true,
          globalSetup: GLOBAL_SETUP,
          // `packages/git`, `packages/changes` and `packages/checkpoints` each
          // declare `testTimeout: 30_000` in their OWN config, because their
          // cases shell out to real git — clone, worktree, commit, push. Those
          // configs are not consulted when the suite runs from this root one,
          // so the 5 s default applied instead and 30 cases failed as timeouts
          // rather than on anything they asserted. Matching the value the
          // packages already chose is the fix; it does not slow a passing run,
          // only lengthens how long a genuinely stuck test takes to give up.
          testTimeout: 30_000,
          hookTimeout: 30_000,
          passWithNoTests: true,
          include: ['**/*.{test,spec}.?(c|m)[jt]s?(x)'],
          exclude: [...EXCLUDE, 'apps/web/**'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
    },
  },
});
