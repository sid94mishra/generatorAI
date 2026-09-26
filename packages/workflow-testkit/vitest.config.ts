import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Whole-run scenarios drive real timers (the reconciler tick, heartbeats,
    // retry backoff) scaled down by the testkit; a lone case stays well under
    // this, but the full `turbo test` run shares the machine.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
