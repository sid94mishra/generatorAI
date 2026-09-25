// ────────────────────────────────────────────────────────────────
// Storybook preview — the app's CSS pipeline, fonts and appearance toolbar
// (docs/redesign/09-verification.md §3.3).
//
// One appearance writer (D-25): the decorator hands the toolbar globals to
// `applyAppearance`, exactly what ThemeProvider does for the app. Storybook
// never touches localStorage, so the workshop cannot leak a theme into the
// app running on the same origin.
// ────────────────────────────────────────────────────────────────

import { useLayoutEffect } from 'react';
import type { Decorator, Preview } from '@storybook/react-vite';
import {
  ACCENT_IDS,
  ACCENT_LABELS,
  DEFAULT_ACCENT,
  DEFAULT_DENSITY,
  DEFAULT_FONT_SIZE,
  DEFAULT_THEME,
  DENSITIES,
  FONT_SIZES,
  THEMES,
} from '@generatorai/design-tokens';
import { appearanceFromGlobals } from './appearance';
import { applyAppearance } from '../src/ui/lib/appearance';
import '../src/styles/fonts';
import '../src/styles/globals.css';

const withAppearance: Decorator = (Story, ctx) => {
  const appearance = appearanceFromGlobals(ctx.globals);
  useLayoutEffect(() => {
    applyAppearance(appearance);
    // `appearance` is rebuilt every render; its fields are the real deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appearance.resolved, appearance.theme, appearance.accent, appearance.density, appearance.fontSize, appearance.reduceMotion]);
  // Shell and template stories own the whole canvas (layout: 'fullscreen').
  if (ctx.parameters['layout'] === 'fullscreen') return <Story />;
  return (
    <div className="bg-surface p-4 text-fg">
      <Story />
    </div>
  );
};

const preview: Preview = {
  globalTypes: {
    mode: {
      description: 'Appearance mode',
      toolbar: {
        title: 'Mode',
        icon: 'mirror',
        items: [
          { value: 'dark', title: 'Dark' },
          { value: 'light', title: 'Light' },
        ],
        dynamicTitle: true,
      },
    },
    theme: {
      description: 'Theme (design-tokens registry)',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: THEMES.map((t) => ({ value: t.id, title: t.label })),
        dynamicTitle: true,
      },
    },
    accent: {
      description: 'Accent',
      toolbar: {
        title: 'Accent',
        icon: 'circle',
        items: ACCENT_IDS.map((id) => ({ value: id, title: ACCENT_LABELS[id] })),
        dynamicTitle: true,
      },
    },
    density: {
      description: 'Density',
      toolbar: {
        title: 'Density',
        icon: 'component',
        items: DENSITIES.map((d) => ({ value: d, title: d === 'compact' ? 'Compact' : 'Comfortable' })),
        dynamicTitle: true,
      },
    },
    fontSize: {
      description: 'Interface font size',
      toolbar: {
        title: 'Font size',
        icon: 'paragraph',
        items: FONT_SIZES.map((s) => ({ value: s, title: `${s} px` })),
        dynamicTitle: true,
      },
    },
    reduceMotion: {
      description: 'Reduce motion',
      toolbar: {
        title: 'Motion',
        icon: 'play',
        items: [
          { value: 'off', title: 'Motion on' },
          { value: 'on', title: 'Reduce motion' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    mode: 'dark',
    theme: DEFAULT_THEME,
    accent: DEFAULT_ACCENT,
    density: DEFAULT_DENSITY,
    fontSize: DEFAULT_FONT_SIZE,
    reduceMotion: 'off',
  },
  decorators: [withAppearance],
  parameters: {
    layout: 'centered',
    // The surface comes from the tokens, never from the backgrounds addon.
    backgrounds: { disable: true },
    // A violation fails `test:stories`. A story may disable one rule only with
    // `parameters.a11y.config.rules` plus a comment with the reason, and never
    // `color-contrast`: contrast is owned by the tokens (09 §3.3, §9.5).
    a11y: { test: 'error' },
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
  // `vrt` is on for every story; a story opts out with `!vrt` (09 §3.6, §4.1).
  tags: ['autodocs', 'vrt'],
};

export default preview;
