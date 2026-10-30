import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
    // Ink patches the console on render via `new console.Console(...)`. Vitest 4
    // replaces the global console with one that has no `Console` constructor, so
    // every TUI test's render threw before painting a frame. Keep Node's own.
    disableConsoleIntercept: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/__tests__/**'],
    },
  },
});
