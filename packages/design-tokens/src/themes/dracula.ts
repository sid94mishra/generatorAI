// ────────────────────────────────────────────────────────────────
// Dracula — Dracula / Alucard.
//
// 10.8M installs, and the most recognisable palette in the set: the bright
// pastels on #282a36 are close to a visual trademark.
//
// ── The one structural decision ──────────────────────────────────
//
// `onAccent` is the BACKGROUND colour, not white. Dracula's accents are
// deliberately bright — green #50fa7b, cyan #8be9fd, yellow #f1fa8c — and
// white on any of them is unreadable (#50fa7b under white is 1.6:1). Dark text
// on them is excellent, and it is also what Dracula's own UI does.
//
// This is exactly the case the `onAccent` token exists for: without it, every
// filled button in this theme would have been derived down to a muddy dark
// green and the palette would have lost the thing that makes it Dracula.
//
// Dracula ships no blue (its ANSI blue is the comment colour), so `blue` is a
// periwinkle interpolated between its purple and cyan rather than borrowed
// from outside the palette.
// ────────────────────────────────────────────────────────────────

import { CODE_MONO, SYSTEM_SANS } from './fonts.js';
import type { ThemeDef } from './types.js';

export const dracula: ThemeDef = {
  id: 'dracula',
  label: 'Dracula',
  description: 'Bright pastels on deep violet-grey. The loudest theme here, and the most recognisable.',
  group: 'editor',
  credit: 'Adapted from Dracula / Alucard (MIT)',
  defaultAccent: 'violet',
  fonts: { sans: SYSTEM_SANS, mono: CODE_MONO },
  radius: { DEFAULT: 6, lg: 10, xl: 14 },

  dark: {
    background: '#282a36',
    card: '#21222c',
    popover: '#343746',
    raised: '#252734',
    subtle: '#343746',
    emphasis: '#44475a',

    foreground: '#f8f8f2',
    mutedForeground: '#a4abd6',
    onAccent: '#282a36',

    border: '#44475a',
    borderMuted: '#343746',

    hues: {
      red: '#ff5555',
      orange: '#ffb86c',
      yellow: '#f1fa8c',
      green: '#50fa7b',
      teal: '#5df2d6',
      cyan: '#8be9fd',
      blue: '#8fa6ff',
      purple: '#bd93f9',
      pink: '#ff79c6',
    },
  },

  light: {
    // Alucard
    background: '#fffbeb',
    card: '#f7f3e0',
    popover: '#ffffff',
    raised: '#f7f3e0',
    subtle: '#efebd8',
    emphasis: '#ddd9c6',

    foreground: '#1f1f1f',
    mutedForeground: '#5d5840',
    onAccent: '#ffffff',

    border: '#cbc7b4',
    borderMuted: '#e2ded0',

    hues: {
      red: '#cb3a2a',
      orange: '#a34d14',
      yellow: '#846e15',
      green: '#14710a',
      teal: '#0d7268',
      cyan: '#036a96',
      blue: '#1d5cc4',
      purple: '#644ac9',
      pink: '#a3144d',
    },
  },
};
