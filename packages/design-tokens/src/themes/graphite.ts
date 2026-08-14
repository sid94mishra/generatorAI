// ────────────────────────────────────────────────────────────────
// Graphite — an original theme, not a port.
//
// The other five are adaptations of well-known editor palettes. This one
// exists because the aesthetic that actually dominates current agent tooling
// — Linear, Vercel, Raycast, the Claude and ChatGPT consoles — is not an
// editor palette at all. It is near-monochrome: an almost-black or pure-white
// canvas, surfaces separated by 2–4% luminance steps rather than by hue, and
// exactly one saturated colour on screen at a time.
//
// That look is easy to get wrong in a *monitoring* product, because taking
// hue out of the chrome leaves nothing to distinguish a running stage from a
// failed one at a glance. The resolution here is deliberate asymmetry:
//
//   • Surfaces are strictly achromatic (r == g == b within a point or two).
//   • Hues are reserved entirely for status, and are pitched brighter than
//     any other theme in the set precisely because they land on grey.
//
// The tight radius (4px) and neo-grotesque type stack are part of the same
// idea: this theme should read as an instrument panel, not as an editor.
// ────────────────────────────────────────────────────────────────

import { GEOMETRIC_SANS, CODE_MONO } from './fonts.js';
import type { ThemeDef } from './types.js';

export const graphite: ThemeDef = {
  id: 'graphite',
  label: 'Graphite',
  description: 'Near-monochrome instrument panel. Achromatic surfaces, one saturated colour at a time — colour means status, nothing else.',
  group: 'product',
  defaultAccent: 'blue',
  fonts: { sans: GEOMETRIC_SANS, mono: CODE_MONO },
  radius: { DEFAULT: 4, lg: 6, xl: 8 },

  dark: {
    background: '#08090a',
    card: '#0e0f11',
    popover: '#161719',
    raised: '#111214',
    subtle: '#191a1c',
    emphasis: '#26282b',

    foreground: '#f2f3f5',
    mutedForeground: '#9ca1a8',
    onAccent: '#ffffff',

    border: '#26282b',
    borderMuted: '#1a1b1e',
    canvasDot: 'rgba(255, 255, 255, 0.08)',

    hues: {
      red: '#ff5f57',
      orange: '#ff9f45',
      yellow: '#e9c46a',
      green: '#46d18a',
      teal: '#3ecfcf',
      cyan: '#5cd0f5',
      blue: '#5b9dff',
      purple: '#b18cff',
      pink: '#ff6fb0',
    },
  },

  light: {
    background: '#ffffff',
    card: '#fafafa',
    popover: '#ffffff',
    raised: '#fafafa',
    subtle: '#f4f4f5',
    emphasis: '#e4e4e7',

    foreground: '#0a0a0b',
    mutedForeground: '#61646a',
    onAccent: '#ffffff',

    border: '#e0e0e3',
    borderMuted: '#efeff1',

    hues: {
      red: '#c62828',
      orange: '#b45309',
      yellow: '#8a6100',
      green: '#12794a',
      teal: '#0f766e',
      cyan: '#0369a1',
      blue: '#1d4ed8',
      purple: '#6d28d9',
      pink: '#b3246b',
    },
  },
};
