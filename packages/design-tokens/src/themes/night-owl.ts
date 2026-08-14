// ────────────────────────────────────────────────────────────────
// Night Owl — Night Owl / Light Owl.
//
// Source: github.com/sdras/night-owl-vscode-theme (MIT). 3.6M installs.
//
// The only theme in this set whose author states accessibility as a design
// input rather than an afterthought: "Color choices have taken into
// consideration what is accessible to people with colorblindness and in
// low-light circumstances." It shows — the hues are separated by luminance as
// well as by hue, which is exactly the property this app needs for a row of
// status badges to survive a colour-vision deficiency.
//
// The deep navy ground (#011627) is also the darkest *chromatic* background
// here. Everything else that dark is neutral, so this fills a real gap.
//
// `mutedForeground` uses #8badc1, which is the sidebar foreground the theme's
// own README recommends — not the comment grey, which is too dim for content.
// ────────────────────────────────────────────────────────────────

import { CODE_MONO, SYSTEM_SANS } from './fonts.js';
import type { ThemeDef } from './types.js';

export const nightOwl: ThemeDef = {
  id: 'night-owl',
  label: 'Night Owl',
  description: 'Deep navy tuned for low light, with hues separated by luminance as well as by colour.',
  group: 'editor',
  credit: 'Adapted from Night Owl / Light Owl by Sarah Drasner (MIT)',
  defaultAccent: 'blue',
  fonts: { sans: SYSTEM_SANS, mono: CODE_MONO },
  radius: { DEFAULT: 6, lg: 10, xl: 14 },

  dark: {
    background: '#011627',
    card: '#001122',
    popover: '#0b2942',
    raised: '#011c31',
    subtle: '#0b2942',
    emphasis: '#1d3b53',

    foreground: '#d6deeb',
    mutedForeground: '#8badc1',
    onAccent: '#011627',

    border: '#1d3b53',
    borderMuted: '#0b2942',

    hues: {
      red: '#ef5350',
      orange: '#f78c6c',
      yellow: '#ecc48d',
      green: '#addb67',
      teal: '#21c7a8',
      cyan: '#7fdbca',
      blue: '#82aaff',
      purple: '#c792ea',
      pink: '#ff6b9d',
    },
  },

  light: {
    background: '#fbfbfb',
    card: '#f0f0f2',
    popover: '#ffffff',
    raised: '#f0f0f2',
    subtle: '#e9e9ec',
    emphasis: '#d7d7dc',

    foreground: '#403f53',
    mutedForeground: '#5c5b70',
    onAccent: '#ffffff',

    border: '#cbcbd2',
    borderMuted: '#e2e2e6',

    hues: {
      red: '#c93b39',
      orange: '#a8551a',
      yellow: '#8a6a00',
      green: '#0a7a5c',
      teal: '#0c7a80',
      cyan: '#0b6b8f',
      blue: '#3b64c4',
      purple: '#8340ad',
      pink: '#b02b73',
    },
  },
};
