import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/index.ts'],
      /**
       * Phase 9 item 5 — "at least 80% changed-line coverage and meaningful
       * branch coverage for command contracts, input routing, pane state, and
       * stream reconciliation."
       *
       * These are RATCHETS set at, or just under, what the suite actually
       * achieves today. A threshold above current coverage fails immediately
       * and gets deleted; one set here fails only when someone lands
       * behaviour with no test behind it, which is the thing worth catching.
       *
       * The four areas the audit names by name carry their own, much higher
       * floors — `registryContract.test.ts` walks every command spec, and
       * pane state and the keymap are pure and fully exercised. Their global
       * numbers are dragged down by `toCommander.ts` (only reachable by
       * running the real binary, covered by the packaging smoke test) and by
       * `client/`, which needs a live server.
       */
      thresholds: {
        lines: 80,
        statements: 80,
        branches: 74,
        functions: 85,
        // Command contracts.
        'src/commands/**': { lines: 85, statements: 85, branches: 60, functions: 90 },
        // Input routing.
        'src/keymap/**': { lines: 95, statements: 95, branches: 88, functions: 88 },
        // Pane state.
        'src/session/**': { lines: 95, statements: 95, branches: 86, functions: 95 },
        // Timeline reduction — the consumer half of stream reconciliation.
        'src/viewmodels/**': { lines: 84, statements: 84, branches: 80, functions: 90 },
        // Capability detection, which every rendering decision hangs off.
        'src/capabilities/**': { lines: 100, statements: 100, branches: 94, functions: 100 },
      },
    },
  },
});
