// ────────────────────────────────────────────────────────────────
// Theme model.
//
// A "theme" is a complete palette (surfaces, text, hues, terminal, syntax)
// with a light AND a dark variant. It is orthogonal to two other axes:
//
//   mode   'light' | 'dark' | 'system'  → picks which variant is active
//   accent one of ACCENT_IDS            → recolours interactive chrome only
//
// ── Why a spec + builder instead of a flat token table ───────────
//
// The flat table that preceded this had ~35 hand-written values per
// appearance. Six themes would have been 420 hand-written colours, and every
// one of them a chance to put a value one shade off and quietly fail WCAG.
//
// So a theme author declares only what is genuinely a design decision — six
// surfaces, three text colours, two borders and nine hues — and everything
// downstream (status colours, tints, filled-button variants, sidebar,
// terminal ANSI, syntax, chart ramp) is DERIVED. Two consequences matter:
//
//   1. Filled buttons are AA-compliant by construction. `ensureContrast`
//      darkens/lightens the accent until it clears 4.5:1 against the text
//      that sits on it, so a theme cannot ship an unreadable button.
//   2. Meaning stays stable across themes. "danger" is always the theme's
//      red, never whatever the accent happens to be.
//
// A theme that genuinely needs to deviate can override any derived value
// (`accentEmphasis`, `terminal`, `canvasDot`), so the model bends before it
// breaks — that escape hatch is what lets `github` reproduce its original
// hand-authored values byte-for-byte.
// ────────────────────────────────────────────────────────────────

import { ensureContrast, mix, toHex, withAlpha } from '../color.js';

export type Appearance = 'dark' | 'light';

/** Accent ids are stable across themes; each theme supplies its own hues. */
export const ACCENT_IDS = ['blue', 'violet', 'green', 'orange', 'rose', 'teal'] as const;
export type AccentId = (typeof ACCENT_IDS)[number];

export const ACCENT_LABELS: Record<AccentId, string> = {
  blue: 'Blue',
  violet: 'Violet',
  green: 'Green',
  orange: 'Orange',
  rose: 'Rose',
  teal: 'Teal',
};

/** Which hue each accent id draws from. */
const ACCENT_HUE: Record<AccentId, keyof HuePalette> = {
  blue: 'blue',
  violet: 'purple',
  green: 'green',
  orange: 'orange',
  rose: 'pink',
  teal: 'teal',
};

/**
 * The nine chromatic anchors of a palette, in the appearance they belong to.
 *
 * Everything with a colour that is not a surface comes from here: status,
 * accents, terminal ANSI, syntax, charts. Keeping them in one place is what
 * stops a theme's "green" meaning three different greens in three features.
 */
export interface HuePalette {
  red: string;
  orange: string;
  yellow: string;
  green: string;
  teal: string;
  cyan: string;
  blue: string;
  purple: string;
  pink: string;
}

/** What a theme author writes, for one appearance. */
export interface ThemeAppearanceSpec {
  /** App canvas. */
  background: string;
  /** Cards, sidebar, panel chrome — one step off `background`. */
  card: string;
  /** Menus, dialogs, tooltips — floats above everything. */
  popover: string;
  /** Nested panels inside a card. */
  raised: string;
  /** Hover / inset fills (inputs, secondary buttons). */
  subtle: string;
  /** Strongest non-text fill: dividers that need to read as a shape. */
  emphasis: string;

  /** Body text. Must clear 4.5:1 on every surface above. */
  foreground: string;
  /** Secondary text — timestamps, paths, counts. Also held to 4.5:1. */
  mutedForeground: string;
  /** Text that sits ON an accent / danger fill. Almost always near-white or near-black. */
  onAccent: string;

  border: string;
  borderMuted: string;

  /** DAG canvas backdrop. Defaults to `background`. */
  canvasBg?: string;
  /** DAG canvas dot grid. Defaults to `border` at 60%. */
  canvasDot?: string;

  hues: HuePalette;

  /**
   * Filled-button colour per accent. Omitted entries are derived by darkening
   * (or lightening) the hue until it clears 4.5:1 against `onAccent`.
   */
  accentEmphasis?: Partial<Record<AccentId, string>>;

  /** ANSI overrides for the integrated terminal. Derived when omitted. */
  terminal?: Partial<TerminalPalette>;
}

/**
 * Picker grouping.
 *
 * With six themes a flat list was fine. With sixteen it is a wall, and the
 * distinction that actually helps someone choose is not the palette's origin
 * but what it is TUNED FOR:
 *
 *   product  interface-first palettes — built for chrome, not for a buffer
 *   editor   ports of syntax themes — familiar if you already use them
 *   reading  low-glare, warm or desaturated — built for long sessions
 */
export type ThemeGroup = 'product' | 'editor' | 'reading';

export const THEME_GROUPS: Array<{ id: ThemeGroup; label: string; description: string }> = [
  {
    id: 'product',
    label: 'Product',
    description: 'Interface-first palettes, designed for application chrome rather than for a code buffer.',
  },
  {
    id: 'editor',
    label: 'Editor',
    description: 'Adapted from the syntax themes people actually use, ranked by install count.',
  },
  {
    id: 'reading',
    label: 'Low glare',
    description: 'Warm or desaturated palettes tuned for long sessions and bright rooms.',
  },
];

/** Everything a theme declares. */
export interface ThemeDef {
  /** Stable id — persisted, and used as `data-theme` on web. */
  id: string;
  label: string;
  /** One sentence for the picker. */
  description: string;
  /** Which section of the picker it appears under. */
  group: ThemeGroup;
  /** Attribution shown under the theme card, when adapted from a public palette. */
  credit?: string;
  /** Accent selected when the user first switches to this theme. */
  defaultAccent: AccentId;
  /** Type stacks. Both fall back to a system family, so nothing is bundled. */
  fonts: { sans: string; mono: string };
  /** Corner radii in px — a real part of a theme's feel, not just colour. */
  radius: { DEFAULT: number; lg: number; xl: number };
  dark: ThemeAppearanceSpec;
  light: ThemeAppearanceSpec;
  /** Hide from the picker (work-in-progress themes). */
  hidden?: boolean;
}

// ── Derived shapes ──────────────────────────────────────────────

/** The full flat token set one (theme, appearance) resolves to. */
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

/** The six interactive tokens an accent controls. */
export interface AccentTokens {
  primary: string;
  primaryEmphasis: string;
  ring: string;
  accent: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
}

export interface AccentDef {
  id: AccentId;
  label: string;
  dark: { primary: string; emphasis: string };
  light: { primary: string; emphasis: string };
}

/** xterm.js palette. Keys match xterm's `ITheme` exactly. */
export interface TerminalPalette {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

/**
 * Syntax roles for highlight.js. Deliberately small: a dozen roles cover every
 * `hljs-*` class we actually render, and a bigger set would mean a bigger
 * surface for six themes to disagree on.
 */
export interface SyntaxTokens {
  comment: string;
  keyword: string;
  string: string;
  number: string;
  function: string;
  type: string;
  variable: string;
  constant: string;
  operator: string;
  punctuation: string;
  tag: string;
  attribute: string;
  deleted: string;
  inserted: string;
}

// ── Derivation ──────────────────────────────────────────────────

/**
 * Alpha percentages used to derive tints.
 *
 * Dark tints sit on a dark surface and need more colour to register; light
 * tints wash out fast, so they stay lower. These two numbers are why a
 * selected row is visible in both appearances without a second palette.
 */
export const TINT = {
  /** `--accent` — selected rows, hovered menu items. */
  accent: { dark: 20, light: 10 },
  /** `--sidebar-accent` — the active nav item's pill. */
  sidebar: { dark: 13, light: 8 },
  /** `--*-muted` — status washes behind badges and banners. */
  status: { dark: 15, light: 12.5 },
} as const;

const AA_TEXT = 4.5;

/** Filled-button colour for one accent: authored if given, derived otherwise. */
export function accentEmphasis(spec: ThemeAppearanceSpec, id: AccentId): string {
  const authored = spec.accentEmphasis?.[id];
  if (authored) return authored;
  return toHex(ensureContrast(spec.hues[ACCENT_HUE[id]], spec.onAccent, AA_TEXT));
}

/** The accent table a theme exposes, one entry per stable accent id. */
export function themeAccents(theme: ThemeDef): AccentDef[] {
  return ACCENT_IDS.map((id) => ({
    id,
    label: ACCENT_LABELS[id],
    dark: { primary: theme.dark.hues[ACCENT_HUE[id]], emphasis: accentEmphasis(theme.dark, id) },
    light: { primary: theme.light.hues[ACCENT_HUE[id]], emphasis: accentEmphasis(theme.light, id) },
  }));
}

/**
 * Resolve the six interactive tokens for an (accent, appearance) pair.
 *
 * Two invariants are encoded here rather than repeated per accent, because
 * repeating them is how they eventually stop holding:
 *
 *   ring                     === primary
 *   sidebarAccentForeground  === primary
 *
 * Tints derive from `emphasis` on dark and `primary` on light: the deeper
 * colour reads better as a wash on a dark surface, the lighter one on a light
 * surface.
 */
export function resolveAccentTokens(
  theme: ThemeDef,
  accentId: AccentId,
  appearance: Appearance,
): AccentTokens {
  const spec = theme[appearance];
  const primary = spec.hues[ACCENT_HUE[accentId]];
  const emphasis = accentEmphasis(spec, accentId);
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

/** Expand a theme's authored spec into the full flat token set. */
export function resolveAppearanceTokens(
  theme: ThemeDef,
  appearance: Appearance,
): AppearanceTokens {
  const s = theme[appearance];
  const t = TINT.status[appearance];
  const tint = (hex: string): string => toHex(withAlpha(hex, t));

  return {
    background: s.background,
    foreground: s.foreground,
    card: s.card,
    cardForeground: s.foreground,
    popover: s.popover,
    popoverForeground: s.foreground,
    raised: s.raised,
    overlay: s.popover,
    subtle: s.subtle,
    emphasis: s.emphasis,

    primaryForeground: s.onAccent,
    secondary: s.subtle,
    secondaryForeground: s.foreground,
    muted: s.subtle,
    mutedForeground: s.mutedForeground,
    accentForeground: s.foreground,
    destructive: s.hues.red,
    destructiveForeground: s.onAccent,

    border: s.border,
    borderMuted: s.borderMuted,
    input: s.border,

    success: s.hues.green,
    successMuted: tint(s.hues.green),
    warning: s.hues.yellow,
    warningMuted: tint(s.hues.yellow),
    info: s.hues.blue,
    infoMuted: tint(s.hues.blue),
    danger: s.hues.red,
    dangerMuted: tint(s.hues.red),
    done: s.hues.purple,

    sidebar: s.card,
    sidebarForeground: s.mutedForeground,
    sidebarBorder: s.border,

    canvasBg: s.canvasBg ?? s.background,
    canvasDot: s.canvasDot ?? toHex(withAlpha(s.border, 60)),
  };
}

/**
 * xterm palette for one (theme, appearance).
 *
 * The bright variants are the base hue pulled 25% toward the foreground rather
 * than a second authored set: a terminal only needs the bright pair to be
 * *distinguishable*, and deriving it means a new theme cannot ship a bright
 * black that is invisible on its own background.
 */
export function resolveTerminalPalette(
  theme: ThemeDef,
  appearance: Appearance,
): TerminalPalette {
  const s = theme[appearance];
  const h = s.hues;
  const brighten = (hex: string): string => toHex(mix(hex, s.foreground, 0.25));

  return {
    background: s.background,
    foreground: s.foreground,
    cursor: s.foreground,
    cursorAccent: s.background,
    selectionBackground: toHex(withAlpha(h.blue, appearance === 'dark' ? 40 : 25)),
    black: s.emphasis,
    red: h.red,
    green: h.green,
    yellow: h.yellow,
    blue: h.blue,
    magenta: h.purple,
    cyan: h.cyan,
    white: s.mutedForeground,
    brightBlack: brighten(s.emphasis),
    brightRed: brighten(h.red),
    brightGreen: brighten(h.green),
    brightYellow: brighten(h.yellow),
    brightBlue: brighten(h.blue),
    brightMagenta: brighten(h.purple),
    brightCyan: brighten(h.cyan),
    brightWhite: s.foreground,
    ...s.terminal,
  };
}

/**
 * Syntax roles for one (theme, appearance).
 *
 * The role→hue mapping is the near-universal convention shared by One Dark,
 * Tokyo Night, Catppuccin and Primer, so every theme lands recognisably close
 * to its upstream editor colouring without shipping a second palette.
 */
export function resolveSyntaxTokens(theme: ThemeDef, appearance: Appearance): SyntaxTokens {
  const s = theme[appearance];
  const h = s.hues;
  return {
    comment: s.mutedForeground,
    keyword: h.purple,
    string: h.green,
    number: h.orange,
    function: h.blue,
    type: h.yellow,
    variable: s.foreground,
    constant: h.orange,
    operator: h.cyan,
    punctuation: s.mutedForeground,
    tag: h.red,
    attribute: h.teal,
    deleted: h.red,
    inserted: h.green,
  };
}

/** Categorical chart ramp — six hues, maximally separated in hue order. */
export function resolveChartRamp(theme: ThemeDef, appearance: Appearance): string[] {
  const h = theme[appearance].hues;
  return [h.blue, h.purple, h.orange, h.green, h.teal, h.pink];
}

/** Swatch triple for the theme picker: [background, card/mid, accent]. */
export function themeSwatch(theme: ThemeDef, appearance: Appearance): [string, string, string] {
  const s = theme[appearance];
  return [s.background, s.emphasis, s.hues[ACCENT_HUE[theme.defaultAccent]]];
}
