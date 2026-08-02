import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Git holds brief file locks on Windows; serialise + allow slow temp-repo
    // setup so `rm -rf` never races an in-flight git process (EBUSY).
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
