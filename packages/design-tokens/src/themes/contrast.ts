// ────────────────────────────────────────────────────────────────
// Contrast — an original, and the only theme here that is a specification
// rather than an aesthetic.
//
// Every other palette in the set targets WCAG AA (4.5:1 body text, 3:1 for
// status). This one targets AAA: 7:1 for body AND secondary text, and 4.5:1
// for every status colour and accent — the *text* threshold applied to things
// that are only required to meet the non-text one.
//
// It exists because "accessible" is not a single bar. AA is the level a
// product ships at; AAA is what someone with low vision, a glare-heavy
// environment, or a failing external monitor actually needs, and no amount of
// picking carefully among the sixteen aesthetic palettes gets you there —
// Dracula and Catppuccin are AA-compliant and still unusable in direct
// sunlight.
//
// Deliberately austere:
//   • Pure #000 / #ffffff grounds. Any tint costs contrast headroom.
//   • Surfaces separated by luminance AND a full-strength border, so the
//     layout survives being viewed in greyscale.
//   • Hues chosen for luminance separation first and hue second, so status
//     stays distinguishable under every common colour-vision deficiency.
//   • A dedicated AAA assertion in the token test suite guards all of this.
// ────────────────────────────────────────────────────────────────

import { HUMANIST_SANS, PLEX_MONO } from './fonts.js';
import type { ThemeDef } from './types.js';

export const contrast: ThemeDef = {
  id: 'contrast',
  label: 'High Contrast',
  description: 'Targets WCAG AAA, not AA — 7:1 body text and full-strength borders. For low vision, glare, or a failing monitor.',
  group: 'reading',
  defaultAccent: 'blue',
  fonts: { sans: HUMANIST_SANS, mono: PLEX_MONO },
  radius: { DEFAULT: 4, lg: 6, xl: 8 },

  dark: {
    background: '#000000',
    card: '#0f0f0f',
    popover: '#1a1a1a',
    raised: '#141414',
    subtle: '#1a1a1a',
    emphasis: '#3d3d3d',

    foreground: '#ffffff',
    mutedForeground: '#c9c9c9',
    onAccent: '#000000',

    border: '#6e6e6e',
    borderMuted: '#454545',
    canvasDot: 'rgba(255, 255, 255, 0.22)',

    hues: {
      red: '#ff8a80',
      orange: '#ffb95e',
      yellow: '#ffe066',
      green: '#7bff9e',
      teal: '#5fead4',
      cyan: '#7fd8ff',
      blue: '#9dc0ff',
      purple: '#d7b3ff',
      pink: '#ff9ecb',
    },
  },

  light: {
    background: '#ffffff',
    card: '#f2f2f2',
    popover: '#ffffff',
    raised: '#f2f2f2',
    subtle: '#e8e8e8',
    emphasis: '#c9c9c9',

    foreground: '#000000',
    mutedForeground: '#454545',
    onAccent: '#ffffff',

    border: '#767676',
    borderMuted: '#a6a6a6',
    canvasDot: 'rgba(0, 0, 0, 0.22)',

    hues: {
      red: '#a80710',
      orange: '#8a3d00',
      yellow: '#6b4e00',
      green: '#0a5c33',
      teal: '#005f57',
      cyan: '#00506b',
      blue: '#0f3fa8',
      purple: '#5a1f9e',
      pink: '#8f0c4d',
    },
  },
};
