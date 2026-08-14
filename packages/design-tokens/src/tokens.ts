// ────────────────────────────────────────────────────────────────
// Non-colour design tokens + the file-icon palette.
//
// Colour lives in `themes/` — one file per theme, all of them expanded
// through the same derivation in `themes/types.ts`. This module holds the
// things that are the same in every theme (type scale, spacing, motion) plus
// the one palette that deliberately ignores the theme system.
//
// Three consumers read this package:
//
//   • apps/web    — via the generated token layers in styles/globals.css
//   • apps/mobile — via the generated theme/tokens.generated.ts
//   • tests       — contrast assertions run against these values directly
//
// Anything that reads a colour from somewhere else is a bug: that is exactly
// how the web and the mobile app drift apart within one release.
// ────────────────────────────────────────────────────────────────

import { SYSTEM_MONO, SYSTEM_SANS } from './themes/fonts.js';
import type { Appearance } from './themes/types.js';

// ── File-type icon palette ──────────────────────────────────────
//
// Mirrors @pierre/trees' internal palette so a file's icon is the same
// colour in the tree (painted inside a shadow root, out of reach of page
// CSS) as it is on a tab, a diff row or a file header.
//
// Deliberately NOT theme-scoped. The whole value of these tokens is that they
// agree with the tree's own shadow-root rendering, which knows nothing about
// our themes; re-tinting them per theme would make every file icon disagree
// with the tree sitting next to it.
//
// ⚠ KNOWN DEFECT — `vermilion` is inverted UPSTREAM.
// Every other pair puts the darker colour on light and the lighter colour
// on dark. Vermilion does the opposite, which lands it at 2.29:1 on a white
// background (see the waiver in the tests).
//
// We mirror the defect deliberately, for the same reason: "fixing" it here
// would make our tabs and diff headers visibly disagree with the tree next
// to them, which is worse than being consistently wrong.

export const FILE_ICON_COLORS = {
  gray: { light: '#84848a', dark: '#adadb1' },
  red: { light: '#d52c36', dark: '#ff6762' },
  /** ⚠ inverted upstream — see the note above. */
  vermilion: { light: '#ff8c5b', dark: '#d5512f' },
  orange: { light: '#d47628', dark: '#ffa359' },
  yellow: { light: '#d5a910', dark: '#ffd452' },
  green: { light: '#199f43', dark: '#5ecc71' },
  teal: { light: '#17a5af', dark: '#64d1db' },
  cyan: { light: '#1ca1c7', dark: '#68cdf2' },
  blue: { light: '#1a85d4', dark: '#69b1ff' },
  indigo: { light: '#693acf', dark: '#9d6afb' },
  purple: { light: '#a631be', dark: '#d568ea' },
  pink: { light: '#d32a61', dark: '#ff678d' },
  mauve: { light: '#594c5b', dark: '#79697b' },
} as const satisfies Record<string, Record<Appearance, string>>;

export type FileIconColor = keyof typeof FILE_ICON_COLORS;

// ── Scales ──────────────────────────────────────────────────────

/**
 * Fallback radii, used when a consumer has no theme in hand.
 *
 * The live values come from the active theme (`ThemeDef.radius`) — corner
 * radius is a real part of a theme's feel, and pinning it globally is what
 * would make every theme look like the same theme in different colours.
 */
export const RADIUS = {
  /** 6px — the default for buttons, inputs, chips. */
  DEFAULT: 6,
  lg: 8,
  xl: 10,
  full: 9999,
} as const;

/** Fallback type stacks. Live values come from `ThemeDef.fonts`. */
export const FONT_FAMILY = {
  sans: SYSTEM_SANS,
  mono: SYSTEM_MONO,
} as const;

/**
 * Native font stacks. React Native cannot parse a CSS font stack, so the
 * platform default is expressed as `undefined` (meaning "system font") and
 * mono is a bundled family so diffs and the terminal look identical on every
 * device.
 */
export const NATIVE_FONT_FAMILY = {
  sans: undefined,
  mono: 'JetBrainsMono',
} as const;

/** Base 14px matches the web body size. */
export const FONT_SIZE = {
  xs: 11,
  sm: 12,
  base: 14,
  md: 15,
  lg: 17,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
} as const;

export const LINE_HEIGHT = {
  tight: 1.25,
  normal: 1.5,
  relaxed: 1.7,
  /** Diff and terminal rows: fixed ratio keeps row height predictable. */
  code: 1.45,
} as const;

/** 4px grid. */
export const SPACING = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

/**
 * Motion durations in ms. Kept short: this is a monitoring tool, and long
 * transitions read as lag when a stream is updating behind them.
 */
export const MOTION = {
  instant: 0,
  fast: 120,
  normal: 180,
  slow: 220,
} as const;

/**
 * Breakpoint (dp) at which the mobile app restores the desktop two-pane
 * layout instead of using a bottom sheet.
 */
export const TWO_PANE_MIN_WIDTH = 768;
