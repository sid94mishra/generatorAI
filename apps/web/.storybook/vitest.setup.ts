// ────────────────────────────────────────────────────────────────
// Setup for the `storybook*` Vitest projects (apps/web/vitest.config.ts).
//
// It does not set the project annotations (09 §3.4's snippet predates 10.3):
// addon-vitest now applies preview.tsx plus every addon's annotations (a11y,
// pseudo-states, docs) itself, and switches that off when a setup file in this
// folder so much as MENTIONS the setter's name — so it must never appear here.
// ────────────────────────────────────────────────────────────────

import { beforeAll } from 'vitest';

// Load the bundled faces (src/styles/fonts.css, D-16) before the first story,
// so every story renders, lays out and is checked by axe with the app's real
// fonts rather than the fallback stack a lazy font swap would leave behind.
beforeAll(async () => {
  await Promise.all([
    document.fonts.load('400 13px "Instrument Sans Variable"'),
    document.fonts.load('600 13px "Instrument Sans Variable"'),
    document.fonts.load('400 13px "JetBrains Mono Variable"'),
  ]);
});
