import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The single Vitest config for the web app (docs/redesign/09-verification.md
 * §1.1, §3.4). `pnpm --filter @generatorai/web test`, turbo, CI and the root
 * `vitest.config.ts` all run the web tests through this file.
 *
 * Already in the `projects` form so the Done loop's `--project unit` works;
 * P1-SB adds the `storybook` browser project next to `unit`.
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
  environment: 'happy-dom',
  setupFiles: [`${dirname}vitest.setup.ts`],
  include: ['src/**/*.test.{ts,tsx}'],
  root: dirname,
} as const;

export default defineConfig({
  // `@` is `apps/web/src` and nothing else — see `vite.config.ts`.
  resolve: { alias: { '@': `${dirname}src` } },
  test: {
    projects: [{ extends: true, test: unitProject }],
  },
});
