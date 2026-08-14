// ────────────────────────────────────────────────────────────────
// Nord — Polar Night (dark) / Snow Storm (light).
//
// Source: https://www.nordtheme.com (MIT). Nord is an arctic, blue-shifted
// sixteen-colour palette in four groups: Polar Night (surfaces), Snow Storm
// (text), Frost (accents) and Aurora (status).
//
// Nord's Aurora colours are chosen for harmony, not for contrast, and three
// of them fail our floors as-is:
//
//   • Aurora red #bf616a is 2.95:1 on Polar Night — a hair under the 3:1 that
//     a status colour has to clear to be a legitimate carrier of meaning.
//   • Frost 10 #5e81ac is 4.03:1 under white, so it cannot be a filled button.
//   • Snow Storm 4 #d8dee9 is too bright to read as *secondary* text.
//
// Each is nudged the minimum distance that fixes it and no further, which is
// why the values below are near-Nord rather than Nord. Being 3% off a hue
// nobody has memorised is a smaller cost than shipping a "failed" badge that
// disappears into its own background.
// ────────────────────────────────────────────────────────────────

import { HUMANIST_SANS, PLEX_MONO } from './fonts.js';
import type { ThemeDef } from './types.js';

export const nord: ThemeDef = {
  id: 'nord',
  label: 'Nord',
  description: 'Arctic, blue-shifted and deliberately desaturated. The quietest of the six — built for long, low-glare sessions.',
  group: 'reading',
  credit: 'Adapted from Nord (MIT)',
  defaultAccent: 'teal',
  fonts: { sans: HUMANIST_SANS, mono: PLEX_MONO },
  radius: { DEFAULT: 4, lg: 6, xl: 8 },

  dark: {
    background: '#2e3440', // nord0
    card: '#2b303b',
    popover: '#3b4252', // nord1
    raised: '#343b48',
    subtle: '#3b4252', // nord1
    emphasis: '#4c566a', // nord3

    foreground: '#eceff4', // nord6
    mutedForeground: '#aeb8c8', // between nord3 and nord4 — see header note
    onAccent: '#ffffff',

    border: '#4c566a', // nord3
    borderMuted: '#434c5e', // nord2

    hues: {
      red: '#cf7783', // Aurora 11, lightened to clear 3:1
      orange: '#d08770', // Aurora 12
      yellow: '#ebcb8b', // Aurora 13
      green: '#a3be8c', // Aurora 14
      teal: '#8fbcbb', // Frost 7
      cyan: '#88c0d0', // Frost 8
      blue: '#81a1c1', // Frost 9
      purple: '#c8a2c8', // Aurora 15, lightened to clear 3:1
      pink: '#d3a0bd',
    },
  },

  light: {
    background: '#eceff4', // nord6
    card: '#e5e9f0', // nord5
    popover: '#ffffff',
    raised: '#e5e9f0', // nord5
    subtle: '#dfe4ec',
    emphasis: '#d8dee9', // nord4

    foreground: '#2e3440', // nord0
    mutedForeground: '#4c566a', // nord3
    onAccent: '#ffffff',

    border: '#c7d0de',
    borderMuted: '#d8dee9', // nord4

    hues: {
      red: '#a4262f',
      orange: '#a35434',
      yellow: '#8a6516',
      green: '#4a6b3c',
      teal: '#3a6b6a',
      cyan: '#2f6d84',
      blue: '#3b5f87',
      purple: '#6f4b78',
      pink: '#95446b',
    },
  },
};
