import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Vitest 4 no longer excludes build output by default, and `tsc` emits the
    // compiled __tests__ into dist/ — without this every case runs twice.
    exclude: [...configDefaults.exclude, '**/dist/**'],
    globals: true,
    // Git holds brief file locks on Windows; serialise + allow slow temp-repo
    // setup so `rm -rf` never races an in-flight git process (EBUSY).
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
