// ────────────────────────────────────────────────────────────────
// The design token source of truth.
//
// This module is the ONLY place a colour, radius or type scale is decided.
// Three consumers read it:
//
//   • apps/web    — via the generated token layers in styles/globals.css
//   • apps/mobile — via the generated theme/tokens.generated.ts
//   • tests       — contrast assertions run against these values directly
//
// Anything that reads a colour from somewhere else is a bug: that is exactly
// how the web and the mobile app drift apart within one release.
//
// ── Structure ────────────────────────────────────────────────────
// Tokens split along two ORTHOGONAL axes:
//
//   appearance : 'dark' | 'light'   → surfaces, text, borders, status
//   accent     : 6 accents          → interactive colour only
//
// Status colours are deliberately NOT accent-controlled. "Danger" must look
// like danger regardless of the user's accent preference.
// ────────────────────────────────────────────────────────────────

import { toHex, withAlpha } from './color.js';

export type Appearance = 'dark' | 'light';

// ── Appearance-scoped tokens ────────────────────────────────────

export interface AppearanceTokens {
  // Surfaces
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  raised: string;
  overlay: string;
  subtle: string;
  emphasis: string;

  // Interactive (accent-independent parts)
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;

  // Borders
  border: string;
  borderMuted: string;
  input: string;

  // Status — semantic, never accent-controlled
  success: string;
  successMuted: string;
  warning: string;
  warningMuted: string;
  info: string;
  infoMuted: string;
  danger: string;
  dangerMuted: string;
  done: string;

  // Sidebar
  sidebar: string;
  sidebarForeground: string;
  sidebarBorder: string;

  // Canvas (DAG surface: React Flow on web, Skia on mobile)
  canvasBg: string;
  canvasDot: string;
}

export const APPEARANCE_TOKENS: Record<Appearance, AppearanceTokens> = {
  dark: {
    background: '#0d1117',
    foreground: '#e6edf3',
    card: '#161b22',
    cardForeground: '#e6edf3',
    popover: '#1c2129',
    popoverForeground: '#e6edf3',
    raised: '#161b22',
    overlay: '#1c2129',
    subtle: '#21262d',
    emphasis: '#30363d',

    primaryForeground: '#ffffff',
    secondary: '#21262d',
    secondaryForeground: '#e6edf3',
    muted: '#21262d',
    mutedForeground: '#8b949e',
    accentForeground: '#e6edf3',
    destructive: '#f85149',
    destructiveForeground: '#ffffff',

    border: '#30363d',
    borderMuted: '#21262d',
    input: '#30363d',

    success: '#3fb950',
    successMuted: '#23863626',
    warning: '#d29922',
    warningMuted: '#9e6a0326',
    info: '#4493f8',
    infoMuted: '#4493f826',
    danger: '#f85149',
    dangerMuted: '#da363326',
    done: '#a371f7',

    sidebar: '#161b22',
    sidebarForeground: '#8b949e',
    sidebarBorder: '#30363d',

    canvasBg: '#0d1117',
    canvasDot: 'rgba(48, 54, 61, 0.6)',
  },
  light: {
    background: '#ffffff',
    foreground: '#1f2328',
    card: '#f6f8fa',
    cardForeground: '#1f2328',
    popover: '#ffffff',
    popoverForeground: '#1f2328',
    raised: '#f6f8fa',
    overlay: '#ffffff',
    subtle: '#f0f3f6',
    emphasis: '#dfe2e5',

    primaryForeground: '#ffffff',
    secondary: '#f0f3f6',
    secondaryForeground: '#1f2328',
    muted: '#f0f3f6',
    mutedForeground: '#656d76',
    accentForeground: '#1f2328',
    destructive: '#d1242f',
    destructiveForeground: '#ffffff',

    border: '#d0d7de',
    borderMuted: '#d8dee4',
    input: '#d0d7de',

    success: '#1a7f37',
    successMuted: '#1a7f3720',
    warning: '#9a6700',
    warningMuted: '#9a670020',
    info: '#0969da',
    infoMuted: '#0969da20',
    danger: '#d1242f',
    dangerMuted: '#d1242f20',
    done: '#8250df',

    sidebar: '#f6f8fa',
    sidebarForeground: '#656d76',
    sidebarBorder: '#d0d7de',

    canvasBg: '#ffffff',
    canvasDot: 'rgba(208, 215, 222, 0.6)',
  },
};

// ── Accent axis ─────────────────────────────────────────────────

export interface AccentDef {
  /** Stable id — persisted, and used as `data-accent` on web. */
  id: string;
  label: string;
  /**
   * `primary` is the readable-on-background colour used for links, icons and
   * accent text. `emphasis` is the FILLED-BUTTON background: it must clear
   * WCAG AA against `primaryForeground` (#ffffff), which `primary` often
   * does not. Splitting the two is the whole reason this palette passes AA.
   */
  dark: { primary: string; emphasis: string };
  light: { primary: string; emphasis: string };
}

export const ACCENTS: AccentDef[] = [
  {
    id: 'blue',
    label: 'Blue',
    dark: { primary: '#4493f8', emphasis: '#1f6feb' },
    light: { primary: '#0969da', emphasis: '#0969da' },
  },
  {
    id: 'violet',
    label: 'Violet',
    dark: { primary: '#a371f7', emphasis: '#8957e5' },
    light: { primary: '#8250df', emphasis: '#8250df' },
  },
  {
    id: 'green',
    label: 'Green',
    dark: { primary: '#3fb950', emphasis: '#238636' },
    light: { primary: '#1a7f37', emphasis: '#1f883d' },
  },
  {
    id: 'orange',
    label: 'Orange',
    dark: { primary: '#db6d28', emphasis: '#bc4c00' },
    light: { primary: '#bc4c00', emphasis: '#bc4c00' },
  },
  {
    id: 'rose',
    label: 'Rose',
    dark: { primary: '#f778ba', emphasis: '#bf4b8a' },
    light: { primary: '#bf3989', emphasis: '#bf3989' },
  },
  {
    id: 'teal',
    label: 'Teal',
    dark: { primary: '#39c5cf', emphasis: '#1b7c83' },
    light: { primary: '#1b7c83', emphasis: '#1b7c83' },
  },
];

export const DEFAULT_ACCENT = 'blue';

/**
 * Alpha percentages used to derive the accent tints.
 *
 * Dark tints derive from `emphasis` (the deeper colour reads better as a
 * wash on a dark surface); light tints derive from `primary`.
 */
export const TINT = {
  /** `--accent` — selected rows, hovered menu items. */
  accent: { dark: 20, light: 10 },
  /** `--sidebar-accent` — the active nav item's pill. */
  sidebar: { dark: 13, light: 8 },
} as const;

export interface AccentTokens {
  primary: string;
  primaryEmphasis: string;
  ring: string;
  accent: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
}

export function getAccent(id: string): AccentDef | undefined {
  return ACCENTS.find((a) => a.id === id);
}

/**
 * Resolve the six interactive tokens for an (accent, appearance) pair.
 *
 * Two invariants are encoded here rather than repeated per accent, because
 * they held for every accent in the hand-written CSS and repeating them is
 * how they eventually stop holding:
 *
 *   ring                     === primary
 *   sidebarAccentForeground  === primary
 */
export function resolveAccent(accentId: string, appearance: Appearance): AccentTokens {
  const def = getAccent(accentId) ?? getAccent(DEFAULT_ACCENT);
  if (!def) throw new Error(`Unknown accent and no default: ${accentId}`);
  const { primary, emphasis } = def[appearance];
  const tintBase = appearance === 'dark' ? emphasis : primary;

  return {
    primary,
    primaryEmphasis: emphasis,
    ring: primary,
    accent: toHex(withAlpha(tintBase, TINT.accent[appearance])),
    sidebarAccent: toHex(withAlpha(tintBase, TINT.sidebar[appearance])),
    sidebarAccentForeground: primary,
  };
}

/** Swatch colours for the Settings picker: [dark, light]. */
export function accentSwatch(def: AccentDef): [dark: string, light: string] {
  return [def.dark.primary, def.light.primary];
}

// ── File-type icon palette ──────────────────────────────────────
//
// Mirrors @pierre/trees' internal palette so a file's icon is the same
// colour in the tree (painted inside a shadow root, out of reach of page
// CSS) as it is on a tab, a diff row or a file header.
//
// ⚠ KNOWN DEFECT — `vermilion` is inverted UPSTREAM.
// Every other pair puts the darker colour on light and the lighter colour
// on dark. Vermilion does the opposite, which lands it at 2.29:1 on a white
// background (see FILE_ICON_CONTRAST_WAIVERS in the tests).
//
// We mirror the defect deliberately. The entire value of this token is that
// it agrees with the tree's own shadow-root rendering; "fixing" it here
// would make our tabs and diff headers visibly disagree with the tree next
// to them, which is worse than being consistently wrong.
//
// The real fix is an app-level override — @pierre/trees resolves
// `--trees-file-icon-vermilion` ahead of its own `--trees-icon-vermilion`,
// so both sides can be corrected together. Tracked as a follow-up; it is a
// deliberate visual change and does not belong in a token extraction that
// promises zero visual diff.

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

export const RADIUS = {
  /** 6px — the default for buttons, inputs, chips. */
  DEFAULT: 6,
  lg: 8,
  xl: 10,
  full: 9999,
} as const;

export const FONT_FAMILY = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
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
