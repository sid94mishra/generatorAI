// ────────────────────────────────────────────────────────────────
// Gruvbox — Gruvbox Dark / Light, by morhetz.
//
// Retro groove: warm, high-saturation earth tones on a brown-grey ground. The
// only theme here whose light variant is genuinely *tinted paper* (#fbf1c7)
// rather than near-white, which is also what makes it the most forgiving
// option in a bright room.
//
// `onAccent` flips between the variants, and that flip is the whole trick:
//
//   dark   accents are bright (#fb4934, #b8bb26, #fabd2f) → dark text
//   light  accents are deep   (#9d0006, #79740e, #b57614) → light text
//
// Reading it the other way round in either variant produces unreadable
// buttons, which is the single most common way Gruvbox ports go wrong.
// ────────────────────────────────────────────────────────────────

import { CODE_MONO, SYSTEM_SANS } from './fonts.js';
import type { ThemeDef } from './types.js';

export const gruvbox: ThemeDef = {
  id: 'gruvbox',
  label: 'Gruvbox',
  description: 'Retro groove — warm earth tones on tinted paper or brown-grey. The most forgiving light variant in the set.',
  group: 'reading',
  credit: 'Adapted from Gruvbox by morhetz (MIT)',
  defaultAccent: 'orange',
  fonts: { sans: SYSTEM_SANS, mono: CODE_MONO },
  radius: { DEFAULT: 4, lg: 6, xl: 8 },

  dark: {
    background: '#282828', // bg0
    card: '#1d2021', // bg0_hard
    popover: '#3c3836', // bg1
    raised: '#32302f', // bg0_soft
    subtle: '#3c3836', // bg1
    emphasis: '#504945', // bg2

    foreground: '#ebdbb2', // fg1
    mutedForeground: '#bdae93', // fg3
    onAccent: '#1d2021',

    border: '#504945', // bg2
    borderMuted: '#3c3836', // bg1

    hues: {
      red: '#fb4934',
      orange: '#fe8019',
      yellow: '#fabd2f',
      green: '#b8bb26',
      teal: '#8ec07c', // aqua
      cyan: '#8dc3b8',
      blue: '#83a598',
      purple: '#d3869b',
      pink: '#e8a0b4',
    },
  },

  light: {
    background: '#fbf1c7', // bg0
    card: '#f4e8bf',
    popover: '#f9f5d7', // bg0_hard
    raised: '#f4e8bf',
    subtle: '#ebdbb2', // bg1
    emphasis: '#d5c4a1', // bg2

    foreground: '#3c3836', // fg1
    mutedForeground: '#665c54', // bg3
    onAccent: '#fbf1c7',

    border: '#bdae93', // bg4
    borderMuted: '#d5c4a1', // bg2

    hues: {
      red: '#9d0006',
      orange: '#af3a03',
      yellow: '#b57614',
      // Pushed green-ward from the authored #79740e: Gruvbox's olive green and
      // amber yellow are nearly the same colour at badge size, and "completed"
      // has to be distinguishable from "needs you" at a glance.
      green: '#4f7a20',
      teal: '#427b58', // aqua
      cyan: '#2c7a86',
      blue: '#076678',
      purple: '#8f3f71',
      pink: '#b0436d',
    },
  },
};
