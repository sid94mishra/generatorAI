// ────────────────────────────────────────────────────────────────
// Ayu — Ayu Dark / Ayu Light.
//
// Source: github.com/ayu-theme/ayu-colors (MIT). 4.2M installs.
//
// Ayu's signature is the gold accent (#e6b450) against an almost-black
// #0b0e14, which is why `orange` rather than `blue` is the default accent
// here — a blue-accented Ayu does not read as Ayu.
//
// Two adaptations:
//
//   • The surface ramp is widened. Ayu's own steps between the editor, the
//     panel and the line highlight are 1–2 points of luminance, which is
//     invisible once you are drawing cards and popovers rather than an editor
//     gutter.
//   • `onAccent` is the background. Ayu's palette is uniformly bright-on-dark
//     — gold, #aad94c green, #39bae6 cyan — and dark text is the only readable
//     option on any of them.
// ────────────────────────────────────────────────────────────────

import { CASCADIA_MONO, GEOMETRIC_SANS } from './fonts.js';
import type { ThemeDef } from './types.js';

export const ayu: ThemeDef = {
  id: 'ayu',
  label: 'Ayu',
  description: 'Gold on near-black. High-chroma accents over a very dark, very neutral ground.',
  group: 'editor',
  credit: 'Adapted from Ayu Dark / Ayu Light (MIT)',
  defaultAccent: 'orange',
  fonts: { sans: GEOMETRIC_SANS, mono: CASCADIA_MONO },
  radius: { DEFAULT: 6, lg: 8, xl: 12 },

  dark: {
    background: '#0b0e14',
    card: '#131721',
    popover: '#1c222d',
    raised: '#151a24',
    subtle: '#1c222d',
    emphasis: '#2d3644',

    foreground: '#bfbdb6',
    mutedForeground: '#8a9199',
    onAccent: '#0b0e14',

    border: '#2d3644',
    borderMuted: '#1c222d',

    hues: {
      red: '#f07178',
      orange: '#ff8f40',
      yellow: '#e6b450',
      green: '#aad94c',
      teal: '#95e6cb',
      cyan: '#39bae6',
      blue: '#59c2ff',
      purple: '#d2a6ff',
      pink: '#f29fc0',
    },
  },

  light: {
    background: '#fcfcfc',
    card: '#f2f3f4',
    popover: '#ffffff',
    raised: '#f2f3f4',
    subtle: '#eaebec',
    emphasis: '#d8dade',

    foreground: '#3d4245',
    mutedForeground: '#5f646a',
    onAccent: '#ffffff',

    border: '#cdcfd3',
    borderMuted: '#e3e4e6',

    hues: {
      red: '#d33a3a',
      orange: '#c05d10',
      yellow: '#a86e00',
      green: '#4d8a24',
      teal: '#0e7f6d',
      cyan: '#16708f',
      blue: '#1f6fb8',
      purple: '#7a4fc0',
      pink: '#b83c74',
    },
  },
};
