// ────────────────────────────────────────────────────────────────
// Carbon — the near-black, single-accent register of the current
// generation of agent desktop apps (OpenAI Codex / ChatGPT).
//
// Not a port: those apps ship no public palette, so this is an adaptation of
// the *system* rather than a copy of the values — a #0d0d0d canvas, a slightly
// lifted #171717 rail, #212121 cards, and exactly one saturated colour (the
// signal green) carrying every affirmative action.
//
// ── Why this is not just Graphite again ──────────────────────────
//
// Graphite is also monochrome, and two near-identical themes would be worse
// than one. They differ on the axis that actually matters at a glance:
//
//   Graphite  achromatic to the point of coldness, blue accent, 4px radius,
//             surfaces separated by ~2% luminance steps
//   Carbon    warmer neutrals, green accent, 8px radius, wider luminance
//             steps so the rail and the canvas read as separate planes
//
// The wider steps are the substantive choice. A chat-shaped app has a
// persistent rail and a scrolling column, and reading them as two planes
// matters more here than the hairline separation Graphite is going for.
// ────────────────────────────────────────────────────────────────

import { GEOMETRIC_SANS, CODE_MONO } from './fonts.js';
import type { ThemeDef } from './types.js';

export const carbon: ThemeDef = {
  id: 'carbon',
  label: 'Carbon',
  description: 'Near-black with warm neutrals and a single signal green. The register of the current agent desktop apps.',
  group: 'product',
  defaultAccent: 'green',
  fonts: { sans: GEOMETRIC_SANS, mono: CODE_MONO },
  radius: { DEFAULT: 8, lg: 12, xl: 16 },

  dark: {
    background: '#0d0d0d',
    card: '#171717',
    popover: '#232323',
    raised: '#1c1c1c',
    subtle: '#212121',
    emphasis: '#353535',

    foreground: '#ececec',
    mutedForeground: '#a4a4a4',
    onAccent: '#ffffff',

    border: '#353535',
    borderMuted: '#242424',
    canvasDot: 'rgba(255, 255, 255, 0.07)',

    hues: {
      red: '#f2555a',
      orange: '#ff9d4d',
      yellow: '#e3b341',
      green: '#19c37d',
      teal: '#12a594',
      cyan: '#4fc3f7',
      blue: '#5b9bff',
      purple: '#ab7bff',
      pink: '#f472b6',
    },
  },

  light: {
    background: '#ffffff',
    card: '#f7f7f7',
    popover: '#ffffff',
    raised: '#f7f7f7',
    subtle: '#f0f0f0',
    emphasis: '#e3e3e3',

    foreground: '#0d0d0d',
    mutedForeground: '#5d5d5d',
    onAccent: '#ffffff',

    border: '#dcdcdc',
    borderMuted: '#ebebeb',

    hues: {
      red: '#c62b32',
      orange: '#b05310',
      yellow: '#8a6100',
      green: '#0d7a52',
      teal: '#0e7267',
      cyan: '#0369a1',
      blue: '#1a5fd0',
      purple: '#6d28d9',
      pink: '#b3246b',
    },
  },
};
