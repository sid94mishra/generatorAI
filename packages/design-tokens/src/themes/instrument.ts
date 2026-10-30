// ────────────────────────────────────────────────────────────────
// Instrument — the default theme (D-11), and the palette the redesign's
// boards are drawn in (Foundations / ThemeInstrument).
//
// Neutral graphite / ivory surfaces; colour carries status and nothing else.
// The accent defaults to `ink` (the foreground), so the only chromatic pixels
// on a quiet screen are status colours.
//
// Values are the boards' `.t-dark` / `.t-light` tokens (02 §4.1), with two
// deliberate departures so the contrast suite passes (02 §14.2):
//   • `border` is one step stronger than the board's `--line` (#27272c dark is
//     1.13:1 on popover, #e2e2de light is 1.15:1 on card; dividers need 1.2).
//   • The boards define only run/ok/warn/err hues; orange, teal, cyan, purple
//     and pink are authored here for syntax, terminal, charts and the
//     violet/rose/teal/orange accents.
// Board accent hexes are used where white text on them clears 4.5:1 (blue,
// violet, rose, teal); green and orange are derived.
// ────────────────────────────────────────────────────────────────

import { BUNDLED_MONO, INSTRUMENT_SANS } from './fonts.js';
import type { ThemeDef } from './types.js';

export const instrument: ThemeDef = {
  id: 'instrument',
  label: 'Instrument',
  description: 'The default. Neutral surfaces, Instrument Sans and JetBrains Mono; colour means status, nothing else.',
  group: 'product',
  defaultAccent: 'ink',
  fonts: { sans: INSTRUMENT_SANS, mono: BUNDLED_MONO },
  radius: { DEFAULT: 6, lg: 8, xl: 10 },

  dark: {
    background: '#0b0b0c',
    card: '#111113',
    popover: '#1d1d21',
    raised: '#17171a',
    subtle: '#1a1a1d',
    emphasis: '#2a2a30',
    sunken: '#0d0d0f',

    foreground: '#ededef',
    mutedForeground: '#a1a1aa',
    onAccent: '#ffffff',

    // Board #27272c is 1.13:1 on popover; the suite needs ≥ 1.2.
    border: '#2c2c31',
    borderMuted: '#1c1c20',

    hues: {
      red: '#ff6369',
      orange: '#ff8f4d',
      yellow: '#f0b429',
      green: '#4cc38a',
      teal: '#2cc2b5',
      cyan: '#56c7e8',
      blue: '#6aa6ff',
      purple: '#a48cff',
      pink: '#f27aae',
    },
    accentEmphasis: { blue: '#2f6fed', violet: '#7152e0', rose: '#c8325f', teal: '#0f7f7a' },
  },

  light: {
    background: '#ffffff',
    card: '#f1f1ef',
    popover: '#ffffff',
    raised: '#fafaf9',
    subtle: '#efefec',
    emphasis: '#dcdcd7',
    sunken: '#f6f6f4',

    foreground: '#18181b',
    mutedForeground: '#55555d',
    onAccent: '#ffffff',

    // Board #e2e2de is 1.15:1 on card; the suite needs ≥ 1.2.
    border: '#dcdcd7',
    borderMuted: '#ecece9',

    hues: {
      red: '#d1242f',
      orange: '#c2410c',
      yellow: '#935f00',
      green: '#16804c',
      teal: '#0f7f7a',
      cyan: '#0e7490',
      blue: '#1d6ae5',
      purple: '#7152e0',
      pink: '#c8325f',
    },
    accentEmphasis: { blue: '#2f6fed', violet: '#7152e0', rose: '#c8325f', teal: '#0f7f7a' },
  },
};
