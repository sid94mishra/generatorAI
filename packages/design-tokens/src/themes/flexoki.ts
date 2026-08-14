// ────────────────────────────────────────────────────────────────
// Flexoki — an inky colour scheme for prose and code.
//
// Source: stephango.com/flexoki (MIT), by Steph Ango.
//
// The most rigorously constructed palette in this set. It is built from a
// 15-step warm base ramp (paper → black) plus eight accents at fixed 400/600
// stops, and the light and dark variants are the SAME hues at different stops
// rather than two hand-tuned palettes. That structure is why it survives being
// re-mapped onto an application's semantic tokens with almost no adjustment —
// most editor palettes do not.
//
// It is also the only theme here designed for *reading* first, which makes it
// the natural pick for long streaming transcripts.
//
// Two stops moved, both because our secondary text carries content:
//   • dark  `mutedForeground` is base-400, not base-500 (4.15:1 on `subtle`)
//   • light `mutedForeground` is base-700, not base-600 (3.97:1 on `subtle`)
// ────────────────────────────────────────────────────────────────

import { HUMANIST_SANS, PLEX_MONO } from './fonts.js';
import type { ThemeDef } from './types.js';

export const flexoki: ThemeDef = {
  id: 'flexoki',
  label: 'Flexoki',
  description: 'Analog printing inks on warm paper. Built for reading — the calmest option for long transcripts.',
  group: 'reading',
  credit: 'Adapted from Flexoki by Steph Ango (MIT)',
  defaultAccent: 'blue',
  fonts: { sans: HUMANIST_SANS, mono: PLEX_MONO },
  radius: { DEFAULT: 4, lg: 6, xl: 10 },

  dark: {
    background: '#100f0f', // black
    card: '#1c1b1a', // base-950
    popover: '#282726', // base-900
    raised: '#1c1b1a', // base-950
    subtle: '#282726', // base-900
    emphasis: '#403e3c', // base-800

    foreground: '#cecdc3', // base-200
    mutedForeground: '#9f9d96', // base-400 — see header note
    onAccent: '#100f0f',

    border: '#403e3c', // base-800
    borderMuted: '#343331', // base-850

    // The 400 stops — Flexoki's "light colors", used on dark grounds.
    hues: {
      red: '#d14d41',
      orange: '#da702c',
      yellow: '#d0a215',
      green: '#879a39',
      teal: '#3aa99f', // cyan-400
      cyan: '#5abdac', // cyan-300
      blue: '#4385be',
      purple: '#8b7ec8',
      pink: '#ce5d97', // magenta-400
    },
  },

  light: {
    background: '#fffcf0', // paper
    card: '#f2f0e5', // base-50
    popover: '#fffcf0', // paper
    raised: '#f2f0e5', // base-50
    subtle: '#e6e4d9', // base-100
    emphasis: '#dad8ce', // base-150

    foreground: '#100f0f', // black
    mutedForeground: '#575653', // base-700 — see header note
    onAccent: '#fffcf0',

    border: '#cecdc3', // base-200
    borderMuted: '#dad8ce', // base-150

    // The 600 stops — Flexoki's "dark colors", used on light grounds.
    hues: {
      red: '#af3029',
      orange: '#bc5215',
      yellow: '#ad8301',
      green: '#66800b',
      teal: '#24837b', // cyan-600
      cyan: '#1c6c66', // cyan-700
      blue: '#205ea6',
      purple: '#5e409d',
      pink: '#a02f6f', // magenta-600
    },
  },
};
