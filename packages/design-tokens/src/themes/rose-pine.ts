// ────────────────────────────────────────────────────────────────
// Rosé Pine — Main (dark) / Dawn (light).
//
// Source: https://rosepinetheme.com (MIT). "All natural pine, faux fur and a
// bit of soho vibes."
//
// Rosé Pine has no green. That is fine for an editor — nothing in a buffer
// has to mean "succeeded" — but this app puts a green badge next to every
// completed run, and borrowing Pine (a teal) for it would collide with the
// Foam used for informational state. So a sage green is introduced in each
// variant, tuned to sit inside the palette's low-chroma, blue-shifted
// character rather than looking like a stock #22c55e dropped into it.
//
// Dawn's `mutedForeground` is Muted (#6e6a86) darkened: Subtle (#797593) is
// 3.98:1 on Dawn's base and Muted itself is 4.31:1 on the Overlay surface,
// both below our secondary-text floor.
// ────────────────────────────────────────────────────────────────

import { CODE_MONO, HUMANIST_SANS } from './fonts.js';
import type { ThemeDef } from './types.js';

export const rosePine: ThemeDef = {
  id: 'rose-pine',
  label: 'Rosé Pine',
  description: 'Muted plum and dusk rose. Warm, low-saturation and quiet — the least "terminal-looking" of the set.',
  group: 'editor',
  credit: 'Adapted from Rosé Pine / Rosé Pine Dawn (MIT)',
  defaultAccent: 'violet',
  fonts: { sans: HUMANIST_SANS, mono: CODE_MONO },
  radius: { DEFAULT: 10, lg: 14, xl: 18 },

  dark: {
    background: '#191724', // base
    card: '#1f1d2e', // surface
    popover: '#26233a', // overlay
    raised: '#1f1d2e', // surface
    subtle: '#21202e', // highlight low
    emphasis: '#403d52', // highlight med

    foreground: '#e0def4', // text
    mutedForeground: '#908caa', // subtle
    onAccent: '#191724', // base

    border: '#403d52', // highlight med
    borderMuted: '#26233a', // overlay
    canvasBg: '#16141f',

    hues: {
      red: '#eb6f92', // love
      orange: '#ea9d6d',
      yellow: '#f6c177', // gold
      green: '#9ccfae', // sage — see header note
      teal: '#9ccfd8', // foam
      cyan: '#7fc7d9',
      blue: '#6ea9c4', // pine, lightened for contrast
      purple: '#c4a7e7', // iris
      pink: '#ebbcba', // rose
    },
  },

  light: {
    // Dawn
    background: '#faf4ed', // base
    card: '#fffaf3', // surface
    popover: '#fffaf3', // surface
    raised: '#fffaf3', // surface
    subtle: '#f2e9e1', // overlay
    emphasis: '#dfdad9', // highlight med

    foreground: '#464261', // text
    mutedForeground: '#655f7a', // muted, darkened — see header note
    onAccent: '#ffffff',

    border: '#cecacd', // highlight high
    borderMuted: '#dfdad9', // highlight med

    hues: {
      red: '#b4637a', // love
      orange: '#c1662d',
      yellow: '#a8701c', // gold, darkened for contrast
      green: '#4f7d5e', // sage — see header note
      teal: '#56949f', // foam
      cyan: '#3f7f8c',
      blue: '#286983', // pine
      purple: '#907aa9', // iris
      pink: '#c06b67', // rose, darkened for contrast
    },
  },
};
