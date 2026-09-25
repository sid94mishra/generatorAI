// ────────────────────────────────────────────────────────────────
// Storybook 10 — the kit workshop (D-10; docs/redesign/09-verification.md §3).
//
// react-vite loads apps/web/vite.config.ts itself, so stories get the app's
// @tailwindcss/vite pipeline, the `@` alias and `__APP_VERSION__` for free.
// Only `ui/` and `blocks/` have stories; `features/` never do (09 §3.2).
// ────────────────────────────────────────────────────────────────

import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  framework: { name: '@storybook/react-vite', options: {} },
  // Title = folder path with the layer as prefix (09 §3.6): ui/primitives/Button.
  stories: [
    { directory: '../src/ui', titlePrefix: 'ui', files: '**/*.stories.@(ts|tsx)' },
    { directory: '../src/blocks', titlePrefix: 'blocks', files: '**/*.stories.@(ts|tsx)' },
  ],
  addons: [
    '@storybook/addon-docs',
    '@storybook/addon-a11y',
    '@storybook/addon-vitest',
    // MCP over HTTP at http://localhost:6006/mcp while `storybook dev` runs
    // (09 §3.5; registered for Claude Code in the repo-root .mcp.json).
    '@storybook/addon-mcp',
    // `parameters.pseudo` for Hover / Active stories (09 §3.6).
    'storybook-addon-pseudo-states',
  ],
  // The component manifest the MCP server lists (components, props, stories).
  // 10.6 names the flag `componentsManifest` (09 §3.2 anticipated the rename of
  // `experimentalComponentsManifest`); addon-mcp also turns it on itself.
  features: { componentsManifest: true },
  core: { disableTelemetry: true },
  async viteFinal(cfg) {
    // The bundle visualizer only makes sense for the app build.
    cfg.plugins = (cfg.plugins ?? [])
      .flat()
      .filter((p) => !(p && typeof p === 'object' && 'name' in p && p.name === 'visualizer'));
    // Stories never call /api (09 §3.2).
    cfg.server = { ...cfg.server, proxy: undefined };
    return cfg;
  },
};

export default config;
