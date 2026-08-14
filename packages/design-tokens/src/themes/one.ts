// ────────────────────────────────────────────────────────────────
// One — Atom One Dark / One Light.
//
// The most-installed syntax theme there is: One Dark Pro (12.6M) plus Atom One
// Dark (7.3M) on the VS Code marketplace, and the default in a long line of
// editors since Atom. If a developer has an opinion about what a dark theme
// looks like, this is usually the shape of it.
//
// One deviation, and it is the same one every port has to make: One Dark's
// comment grey (#5c6370) is 2.6:1 on its own background. That is survivable
// for comments in a buffer, where the code around them carries the meaning,
// and not survivable for the secondary text this app puts real content in
// (timestamps, paths, token counts). `mutedForeground` is lifted accordingly.
// ────────────────────────────────────────────────────────────────

import { CODE_MONO, SYSTEM_SANS } from './fonts.js';
import type { ThemeDef } from './types.js';

export const one: ThemeDef = {
  id: 'one',
  label: 'One',
  description: 'The Atom lineage — balanced slate blues with warm syntax. The most widely installed dark theme there is.',
  group: 'editor',
  credit: 'Adapted from Atom One Dark / One Light (MIT)',
  defaultAccent: 'blue',
  fonts: { sans: SYSTEM_SANS, mono: CODE_MONO },
  radius: { DEFAULT: 6, lg: 8, xl: 12 },

  dark: {
    background: '#282c34',
    card: '#21252b',
    popover: '#2f343d',
    raised: '#242830',
    subtle: '#2c313a',
    emphasis: '#3e4451',

    foreground: '#dce1e8',
    mutedForeground: '#a2aab8',
    onAccent: '#ffffff',

    border: '#3e4451',
    borderMuted: '#2c313a',

    hues: {
      red: '#e06c75',
      orange: '#d19a66',
      yellow: '#e5c07b',
      green: '#98c379',
      teal: '#56b6c2',
      cyan: '#71ccd8',
      blue: '#61afef',
      purple: '#c678dd',
      pink: '#e089b0',
    },
  },

  light: {
    background: '#fafafa',
    card: '#f0f0f1',
    popover: '#ffffff',
    raised: '#f0f0f1',
    subtle: '#eaeaeb',
    emphasis: '#d5d5d7',

    foreground: '#383a42',
    mutedForeground: '#5f626d',
    onAccent: '#ffffff',

    border: '#c9cacc',
    borderMuted: '#e0e0e1',

    hues: {
      red: '#ca3a2e',
      orange: '#a04f00',
      yellow: '#8a6300',
      green: '#3f8c3e',
      teal: '#0e7c8c',
      cyan: '#0d6d90',
      blue: '#3568d4',
      purple: '#9127a0',
      pink: '#b3125e',
    },
  },
};
