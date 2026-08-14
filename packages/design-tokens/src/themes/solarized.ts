// ────────────────────────────────────────────────────────────────
// Solarized — Solarized Dark / Light, by Ethan Schoonover.
//
// The original precision-designed pair, and still the only widely used scheme
// where the light and dark variants are the SAME sixteen colours with the
// background ramp inverted. That is the property this app wants most: a user
// who switches mode does not get a different theme, they get the same theme
// with the lights on.
//
// One family of deviations, and it is the well-known one. Solarized Dark's
// body text is base0 (#839496), which lands at 4.08:1 on base02 — the surface
// our cards use. Schoonover chose that deliberately for low-contrast comfort
// on a terminal; it is the wrong trade for a monitoring surface where the text
// in question is a failure message. So:
//
//   • body text is base2 and secondary text is base1, one stop up each
//   • red and orange are lifted (2.81:1 and 2.82:1 on base02 as authored —
//     under the 3:1 a status colour needs to carry meaning)
//   • violet is lifted, for the same reason, as an accent
// ────────────────────────────────────────────────────────────────

import { PLEX_MONO, SYSTEM_SANS } from './fonts.js';
import type { ThemeDef } from './types.js';

export const solarized: ThemeDef = {
  id: 'solarized',
  label: 'Solarized',
  description: 'The original precision palette — one set of hues, two symmetric backgrounds. Light and dark are genuinely the same theme.',
  group: 'reading',
  credit: 'Adapted from Solarized by Ethan Schoonover (MIT)',
  defaultAccent: 'blue',
  fonts: { sans: SYSTEM_SANS, mono: PLEX_MONO },
  radius: { DEFAULT: 4, lg: 6, xl: 10 },

  dark: {
    background: '#002b36', // base03
    card: '#073642', // base02
    popover: '#0a4a5a',
    raised: '#073642', // base02
    subtle: '#073642', // base02
    emphasis: '#586e75', // base01

    foreground: '#eee8d5', // base2
    mutedForeground: '#93a1a1', // base1 — see header note
    onAccent: '#002b36',

    border: '#586e75', // base01
    borderMuted: '#0a4a5a',

    hues: {
      red: '#e3453f', // lifted — see header note
      orange: '#d9581f', // lifted — see header note
      yellow: '#b58900',
      // Pushed green-ward from the authored #859900: Solarized's green and
      // yellow are one hue step apart, which is fine for syntax and not fine
      // for a "completed" badge sitting next to a "needs you" badge.
      green: '#6fae3d',
      teal: '#2aa198', // cyan
      cyan: '#3fc4b9',
      blue: '#268bd2',
      purple: '#8b90d8', // violet, lifted for contrast
      pink: '#d33682', // magenta
    },
  },

  light: {
    background: '#fdf6e3', // base3
    card: '#eee8d5', // base2
    popover: '#fdf6e3', // base3
    raised: '#eee8d5', // base2
    subtle: '#e8e1cb',
    emphasis: '#d5cdb4',

    foreground: '#073642', // base02
    mutedForeground: '#4a6068',
    onAccent: '#fdf6e3',

    border: '#c9c1a8',
    borderMuted: '#ded7c0',

    hues: {
      red: '#c0272b',
      orange: '#bb4410',
      yellow: '#96730b',
      green: '#4d7a1f',
      teal: '#1f7f78',
      cyan: '#1b6f7d',
      blue: '#20729f',
      purple: '#5a5fb0',
      pink: '#bd2f75',
    },
  },
};
