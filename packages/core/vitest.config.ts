import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Suites here spawn real child processes (PtyHostAdapter, the voice
    // worker). Under `turbo test` several packages run at once on one machine
    // and those cases failed as 30 s timeouts while passing alone. A longer
    // timeout does not slow a passing run; it only lengthens how long a
    // genuinely stuck test takes to give up.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
