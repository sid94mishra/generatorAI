// ────────────────────────────────────────────────────────────────
// Catppuccin — Mocha (dark) / Latte (light).
//
// Source: https://catppuccin.com/palette (MIT). The surface ramp, text ramp
// and 26-colour hue set are used verbatim; only the *assignment* of palette
// entries to our semantic roles is ours.
//
// Deviations from upstream, all forced by our contrast bar:
//
//   • Latte `mutedForeground` uses Subtext 1 (#5c5f77), not Subtext 0.
//     Subtext 0 lands at 4.40:1 on Base — under the 4.5:1 we hold secondary
//     text to, because we use it for paths and counts, not decoration.
//   • Mocha's `onAccent` is Crust, not white. The Mocha hues are pastels;
//     white on them is unreadable, dark text on them is excellent. This is
//     also what the upstream style guide recommends.
//   • Four Latte hues are darkened: Green (2.96:1 on Base), Yellow (2.31:1),
//     Peach (2.66:1) and Pink (2.34:1). Latte is a genuinely low-contrast
//     light theme — fine for syntax inside a buffer, not fine for a "failed"
//     badge or a chart series. Each is pulled down the minimum distance that
//     clears the floor, so the palette still reads as Latte.
// ────────────────────────────────────────────────────────────────

import { CODE_MONO, ROUNDED_SANS } from './fonts.js';
import type { ThemeDef } from './types.js';

export const catppuccin: ThemeDef = {
  id: 'catppuccin',
  label: 'Catppuccin',
  description: 'Soothing pastels on deep violet-grey. Low chroma contrast, high hue variety — easy on long sessions.',
  group: 'editor',
  credit: 'Adapted from Catppuccin Mocha / Latte (MIT)',
  defaultAccent: 'violet',
  fonts: { sans: ROUNDED_SANS, mono: CODE_MONO },
  radius: { DEFAULT: 8, lg: 12, xl: 16 },

  dark: {
    // Mocha
    background: '#1e1e2e', // base
    card: '#181825', // mantle
    popover: '#313244', // surface0
    raised: '#181825', // mantle
    subtle: '#313244', // surface0
    emphasis: '#45475a', // surface1

    foreground: '#cdd6f4', // text
    mutedForeground: '#a6adc8', // subtext0
    onAccent: '#11111b', // crust

    border: '#45475a', // surface1
    borderMuted: '#313244', // surface0
    canvasBg: '#11111b', // crust

    hues: {
      red: '#f38ba8',
      orange: '#fab387', // peach
      yellow: '#f9e2af',
      green: '#a6e3a1',
      teal: '#94e2d5',
      cyan: '#89dceb', // sky
      blue: '#89b4fa',
      purple: '#cba6f7', // mauve
      pink: '#f5c2e7',
    },
  },

  light: {
    // Latte
    background: '#eff1f5', // base
    card: '#e6e9ef', // mantle
    popover: '#ffffff',
    raised: '#e6e9ef', // mantle
    subtle: '#dce0e8', // crust
    emphasis: '#ccd0da', // surface0

    foreground: '#4c4f69', // text
    mutedForeground: '#5c5f77', // subtext1 — see header note
    onAccent: '#ffffff',

    border: '#bcc0cc', // surface1
    borderMuted: '#ccd0da', // surface0

    hues: {
      red: '#d20f39',
      orange: '#dc5608', // peach, darkened — see header note
      yellow: '#b37115', // darkened — see header note
      green: '#3c9528', // darkened — see header note
      teal: '#179299',
      cyan: '#17798d', // sapphire, darkened — see header note
      blue: '#1e66f5',
      purple: '#8839ef', // mauve
      pink: '#c664ab', // darkened — see header note
    },
  },
};
