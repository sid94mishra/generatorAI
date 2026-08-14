// ────────────────────────────────────────────────────────────────
// Everforest — Everforest Dark / Light (medium and hard contrast), by sainnhe.
//
// Source: github.com/sainnhe/everforest (MIT).
//
// The only green-grounded theme in the set, and that is why it is here: with
// sixteen palettes the risk is not that one is missing, it is that they all
// occupy the same three hue families (blue-grey, violet-grey, neutral).
// Everforest's #2d353b is a desaturated forest green, and nothing else here
// looks like it.
//
// The light variant uses the HARD background (#fffbef) rather than the medium
// (#fdf6e3), because medium is byte-identical to Solarized Light's base3 —
// two themes that render the same page background are two themes a user cannot
// tell apart in the picker.
//
// Everforest's own accents are pastel by design and several fall under 3:1 on
// its light ground (yellow #dfa000, green #8da101, aqua #35a77c). Those are
// deepened for the light variant; the dark variant is used as authored.
// ────────────────────────────────────────────────────────────────

import { HUMANIST_SANS, PLEX_MONO } from './fonts.js';
import type { ThemeDef } from './types.js';

export const everforest: ThemeDef = {
  id: 'everforest',
  label: 'Everforest',
  description: 'Desaturated forest green with soft warm accents. The only green-grounded palette here, and the easiest on tired eyes.',
  group: 'reading',
  credit: 'Adapted from Everforest by sainnhe (MIT)',
  defaultAccent: 'green',
  fonts: { sans: HUMANIST_SANS, mono: PLEX_MONO },
  radius: { DEFAULT: 6, lg: 10, xl: 14 },

  dark: {
    background: '#2d353b', // bg0
    card: '#232a2e', // bg_dim
    popover: '#3d484d', // bg2
    raised: '#343f44', // bg1
    subtle: '#343f44', // bg1
    emphasis: '#56635f', // bg5

    foreground: '#d3c6aa', // fg
    mutedForeground: '#a8b3a9',
    onAccent: '#2d353b',

    border: '#4f585e', // bg4
    borderMuted: '#3d484d', // bg2

    hues: {
      red: '#e67e80',
      orange: '#e69875',
      // Warmed away from `green`: as authored, Everforest's sand yellow and
      // sage green are close enough that a "needs you" badge and a "completed"
      // badge read as the same colour at badge size.
      yellow: '#e5b04f',
      green: '#a7c080',
      teal: '#83c092', // aqua
      cyan: '#9ad0c4',
      blue: '#7fbbb3',
      purple: '#d699b6',
      pink: '#e0a3b8',
    },
  },

  light: {
    // Hard contrast variant — see header note.
    background: '#fffbef', // bg0 (hard)
    card: '#f8f5e4', // bg1
    popover: '#ffffff',
    raised: '#f8f5e4', // bg1
    subtle: '#f2efdf', // bg2
    emphasis: '#e8e5d5', // bg4

    foreground: '#414d54',
    mutedForeground: '#5c6a72', // fg
    onAccent: '#fffbef',

    border: '#d5d2be',
    borderMuted: '#edeada', // bg3

    hues: {
      red: '#d13c39',
      orange: '#c25f18',
      yellow: '#a8730a',
      green: '#4f8033',
      teal: '#237f5f', // aqua
      cyan: '#1f7189',
      blue: '#2c6f9b',
      purple: '#a84a8c',
      pink: '#bd4670',
    },
  },
};
