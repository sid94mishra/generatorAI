import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Vitest 4 no longer excludes build output by default, and `tsc` emits the
    // compiled __tests__ into dist/ — without this every case runs twice.
    exclude: [...configDefaults.exclude, '**/dist/**'],
    globals: true,
    // Real git operations (clone/worktree/push) are slow on Windows CI —
    // give each test and hook generous headroom.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Temp-dir teardown can race with git's background file handles on
    // Windows; run serially to keep locking deterministic.
    fileParallelism: false,
  },
});
