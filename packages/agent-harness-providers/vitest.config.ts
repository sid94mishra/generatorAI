import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // The ACP conformance suite drives a real JSON-RPC child over stdio and
    // failed as a 30 s timeout under `turbo test` parallel load while passing
    // alone. See the same note in packages/core/vitest.config.ts.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
