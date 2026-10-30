import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Vitest 4 no longer excludes build output by default, and `tsc` emits the
    // compiled __tests__ into dist/ — without this every case runs twice.
    exclude: [...configDefaults.exclude, '**/dist/**'],
    globals: true,
    environment: 'node',
    // The ACP conformance suite drives a real JSON-RPC child over stdio and
    // failed as a 30 s timeout under `turbo test` parallel load while passing
    // alone. See the same note in packages/core/vitest.config.ts.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
