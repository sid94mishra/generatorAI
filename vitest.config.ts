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
];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'web',
          globals: true,
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
