// ────────────────────────────────────────────────────────────────
// Clay — warm ceramic. The register of Anthropic's Claude surfaces.
//
// Not a port: an adaptation of the *approach* rather than a copy of values.
// What makes that family recognisable is not one colour, it is a structural
// choice almost nothing else in this set makes — the neutrals are WARM. Every
// surface carries a few points of yellow, so the light variant reads as paper
// rather than as screen, and the dark variant as ink rather than as void.
//
// The terracotta is the only saturated colour in the chrome, which is why it
// is the default accent here: on a warm neutral ground it does the work that
// blue does on a cold one.
//
// Two structural details worth keeping:
//
//   • Light `card` is WHITE on a cream `background` — the card is lighter than
//     the page, the opposite of every cold theme in this set. That inversion
//     is most of why the light variant feels like the reference.
//   • Dark `card` is DARKER than `background`, so the rail recedes and the
//     content column is the lit surface.
// ────────────────────────────────────────────────────────────────

import { HUMANIST_SANS, PLEX_MONO } from './fonts.js';
import type { ThemeDef } from './types.js';

export const clay: ThemeDef = {
  id: 'clay',
  label: 'Clay',
  description: 'Warm ceramic neutrals and terracotta. Paper in the light, ink in the dark — the least screen-like of the set.',
  group: 'product',
  defaultAccent: 'orange',
  fonts: { sans: HUMANIST_SANS, mono: PLEX_MONO },
  radius: { DEFAULT: 10, lg: 14, xl: 20 },

  dark: {
    background: '#262624',
    card: '#1f1e1d',
    popover: '#333330',
    raised: '#2c2c29',
    subtle: '#302f2d',
    emphasis: '#45443f',

    foreground: '#f5f4ee',
    mutedForeground: '#b3b1a6',
    onAccent: '#ffffff',

    border: '#45443f',
    borderMuted: '#35342f',

    hues: {
      red: '#e5786d',
      orange: '#d97757',
      yellow: '#d9a441',
      green: '#84b06d',
      teal: '#6fb3a3',
      cyan: '#74aec4',
      blue: '#84a5d1',
      purple: '#b79ac4',
      pink: '#dd93a6',
    },
  },

  light: {
    background: '#faf9f5',
    card: '#ffffff',
    popover: '#ffffff',
    raised: '#ffffff',
    subtle: '#f0eee6',
    emphasis: '#e3e1d7',

    foreground: '#262624',
    mutedForeground: '#66655c',
    onAccent: '#ffffff',

    border: '#d7d5ca',
    borderMuted: '#e8e6dc',

    hues: {
      red: '#b3382c',
      orange: '#b0532c',
      yellow: '#8a6516',
      green: '#4d7a3d',
      teal: '#2d7a6c',
      cyan: '#296b84',
      blue: '#2d5f9e',
      purple: '#77519c',
      pink: '#a63f66',
    },
  },
};
