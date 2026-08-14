// ────────────────────────────────────────────────────────────────
// GitHub — the default theme (Primer).
//
// This theme is load-bearing in a way the others are not: it is what every
// existing user is already looking at, so its resolved tokens must match the
// hand-authored values that preceded the theme system exactly. Where the
// derivation would have produced something else, the value is authored
// explicitly (`accentEmphasis`, `canvasDot`) rather than the derivation being
// bent to fit one theme.
//
// The one intentional drift is the status tints: they used to be a mix of
// base and emphasis hues at two different alphas, which was inconsistent
// rather than deliberate. They are now uniformly the base hue at the standard
// alpha — a sub-perceptual change to a background wash.
// ────────────────────────────────────────────────────────────────

import { SYSTEM_MONO, SYSTEM_SANS } from './fonts.js';
import type { ThemeDef } from './types.js';

export const github: ThemeDef = {
  id: 'github',
  label: 'GitHub',
  description: 'Primer — the calibrated, low-chroma default. Neutral surfaces, colour only where it means something.',
  group: 'product',
  credit: 'After GitHub Primer',
  defaultAccent: 'blue',
  fonts: { sans: SYSTEM_SANS, mono: SYSTEM_MONO },
  radius: { DEFAULT: 6, lg: 8, xl: 10 },

  dark: {
    background: '#0d1117',
    card: '#161b22',
    popover: '#1c2129',
    raised: '#161b22',
    subtle: '#21262d',
    emphasis: '#30363d',

    foreground: '#e6edf3',
    mutedForeground: '#8b949e',
    onAccent: '#ffffff',

    border: '#30363d',
    borderMuted: '#21262d',
    canvasDot: 'rgba(48, 54, 61, 0.6)',

    hues: {
      red: '#f85149',
      orange: '#db6d28',
      yellow: '#d29922',
      green: '#3fb950',
      teal: '#39c5cf',
      cyan: '#56d4dd',
      blue: '#4493f8',
      purple: '#a371f7',
      pink: '#f778ba',
    },
    accentEmphasis: {
      blue: '#1f6feb',
      violet: '#8957e5',
      green: '#238636',
      orange: '#bc4c00',
      rose: '#bf4b8a',
      teal: '#1b7c83',
    },
    // Aligned with One Dark / VSCode Dark+, which is what a shell prompt
    // expects to look like regardless of the surrounding chrome.
    terminal: {
      black: '#1e1e1e',
      red: '#e06c75',
      green: '#98c379',
      yellow: '#d19a66',
      blue: '#61afef',
      magenta: '#c678dd',
      cyan: '#56b6c2',
      white: '#dcdfe4',
      brightBlack: '#5c6370',
      brightYellow: '#e5c07b',
      brightWhite: '#ffffff',
    },
  },

  light: {
    background: '#ffffff',
    card: '#f6f8fa',
    popover: '#ffffff',
    raised: '#f6f8fa',
    subtle: '#f0f3f6',
    emphasis: '#dfe2e5',

    foreground: '#1f2328',
    mutedForeground: '#656d76',
    onAccent: '#ffffff',

    border: '#d0d7de',
    borderMuted: '#d8dee4',
    canvasDot: 'rgba(208, 215, 222, 0.6)',

    hues: {
      red: '#d1242f',
      orange: '#bc4c00',
      yellow: '#9a6700',
      green: '#1a7f37',
      teal: '#1b7c83',
      cyan: '#1b7c83',
      blue: '#0969da',
      purple: '#8250df',
      pink: '#bf3989',
    },
    accentEmphasis: {
      blue: '#0969da',
      violet: '#8250df',
      green: '#1f883d',
      orange: '#bc4c00',
      rose: '#bf3989',
      teal: '#1b7c83',
    },
    terminal: {
      black: '#24292f',
      red: '#cf222e',
      green: '#116329',
      yellow: '#4d2d00',
      blue: '#0969da',
      magenta: '#8250df',
      cyan: '#1b7c83',
      white: '#6e7781',
      brightBlack: '#57606a',
      brightWhite: '#8c959f',
    },
  },
};
