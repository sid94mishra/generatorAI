// ────────────────────────────────────────────────────────────────
// Tokyo Night — Night (dark) / Day (light).
//
// Sources: enkia/tokyo-night-vscode-theme and folke/tokyonight.nvim (both MIT).
//
// The upstream README says outright that "many UI elements are intentionally
// low contrast so as not to distract" — which is a defensible choice for an
// editor chrome and an indefensible one for a monitoring surface where the
// low-contrast element is the *status* of a running job.
//
// So this adaptation keeps Tokyo Night's hues exactly and raises only the two
// text ramps: `foreground` uses the brighter variable colour (#c0caf5) rather
// than the editor foreground, and `mutedForeground` uses the markdown-text
// grey (#9aa5ce) rather than the comment colour (#565f89, which is 3.0:1 on
// the base background and fails as body text).
// ────────────────────────────────────────────────────────────────

import { CASCADIA_MONO, GEOMETRIC_SANS } from './fonts.js';
import type { ThemeDef } from './types.js';

export const tokyoNight: ThemeDef = {
  id: 'tokyo-night',
  label: 'Tokyo Night',
  description: 'Deep indigo night with neon signage. Cool surfaces, saturated accents, strong separation between chrome and content.',
  group: 'editor',
  credit: 'Adapted from Tokyo Night / Tokyo Night Day (MIT)',
  defaultAccent: 'blue',
  fonts: { sans: GEOMETRIC_SANS, mono: CASCADIA_MONO },
  radius: { DEFAULT: 6, lg: 10, xl: 14 },

  dark: {
    background: '#1a1b26',
    card: '#16161e',
    popover: '#24283b',
    raised: '#1f2335',
    subtle: '#24283b',
    emphasis: '#414868',

    foreground: '#c0caf5',
    mutedForeground: '#9aa5ce',
    onAccent: '#ffffff',

    border: '#3b4261',
    borderMuted: '#292e42',
    canvasBg: '#16161e',

    hues: {
      red: '#f7768e',
      orange: '#ff9e64',
      yellow: '#e0af68',
      green: '#9ece6a',
      teal: '#73daca',
      cyan: '#7dcfff',
      blue: '#7aa2f7',
      purple: '#bb9af7',
      pink: '#ff7ab2',
    },
    // Tokyo Night's own darker blue: the derived value lands close, but this
    // is the shade the upstream theme actually uses for a selected chip.
    accentEmphasis: { blue: '#3d59a1' },
  },

  light: {
    // Tokyo Night Day
    background: '#e1e2e7',
    card: '#d5d6db',
    popover: '#e9e9ec',
    raised: '#d5d6db',
    subtle: '#d0d5e3',
    emphasis: '#b7c1e3',

    foreground: '#343b58',
    mutedForeground: '#4c5372',
    onAccent: '#ffffff',

    border: '#a8aecb',
    borderMuted: '#c4c8da',

    hues: {
      red: '#c64343',
      orange: '#b15c00',
      yellow: '#8f5e15',
      green: '#587539',
      teal: '#0f7a66',
      cyan: '#007197',
      blue: '#2563c8',
      purple: '#7847bd',
      pink: '#bb4b8d',
    },
  },
};
