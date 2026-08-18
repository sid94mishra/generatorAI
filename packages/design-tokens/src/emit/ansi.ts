// ────────────────────────────────────────────────────────────────
// Terminal (ANSI) emitter.
//
// The web app ships eighteen themes. Without this the TUI would need its own
// palette and "gruvbox" would mean two different things in two surfaces of
// one product. Everything here is derived from the same `ThemeDef` the CSS
// and native emitters read, so a theme is authored once.
//
// Three colour ladders are produced for every theme, because a terminal tells
// you almost nothing about itself:
//
//   truecolor  24-bit SGR (38;2;r;g;b) — what modern emulators support
//   ansi256    the xterm cube + greyscale ramp
//   ansi16     the eight base colours and their bright variants
//
// A fourth "none" mode carries no colour at all; every surface that uses this
// module must therefore also convey meaning with glyphs, never with hue
// alone.
// ────────────────────────────────────────────────────────────────

import { parseHex, type Rgba } from '../color.js';
import { THEMES, DEFAULT_THEME } from '../themes/index.js';
import {
  resolveAppearanceTokens,
  resolveAccentTokens,
  resolveTerminalPalette,
  resolveSyntaxTokens,
} from '../themes/types.js';
import type { AccentId, Appearance, ThemeDef } from '../themes/types.js';

export type ColorLadder = 'truecolor' | 'ansi256' | 'ansi16' | 'none';

/**
 * The semantic slots a terminal UI actually draws with.
 *
 * Deliberately smaller than `AppearanceTokens`: a terminal has no shadows, no
 * gradients and no hover state, and offering slots that cannot be rendered
 * invites components to reach for them and then look wrong.
 */
export interface TerminalTheme {
  id: string;
  label: string;
  appearance: Appearance;
  accent: AccentId;

  /** Base surfaces. */
  background: string;
  foreground: string;
  /** Panels, headers, the status bar. */
  surface: string;
  surfaceForeground: string;
  /** De-emphasised text: timestamps, ids, hints. */
  muted: string;
  /** Rules, borders, box-drawing. */
  border: string;
  borderMuted: string;

  /** Selection and focus. */
  selectionBackground: string;
  selectionForeground: string;
  focusBorder: string;

  /** Interactive accent. */
  primary: string;
  primaryForeground: string;

  /** Semantic status. Never accent-controlled: "danger" is always the red. */
  success: string;
  warning: string;
  danger: string;
  info: string;
  running: string;
  idle: string;

  /** Diff. */
  diffAdded: string;
  diffAddedBg: string;
  diffRemoved: string;
  diffRemovedBg: string;
  diffContext: string;

  /** Syntax highlighting, mapped onto highlight.js roles. */
  syntax: Record<string, string>;

  /** Raw 16-colour ANSI palette, for a hosted PTY that renders its own colours. */
  ansi: Record<string, string>;
}

/** An `Rgba` that ignores alpha, since a terminal cell cannot blend. */
function flatten(hex: string, over: Rgba): Rgba {
  const colour = parseHex(hex);
  if (colour.a >= 1) return colour;
  // Terminals have no alpha channel, so a token authored as a 12% tint would
  // be drawn at full strength and look nothing like the web. Compositing it
  // against the surface it sits on is what keeps the two in step.
  const a = colour.a;
  return {
    r: Math.round(colour.r * a + over.r * (1 - a)),
    g: Math.round(colour.g * a + over.g * (1 - a)),
    b: Math.round(colour.b * a + over.b * (1 - a)),
    a: 1,
  };
}

function hex({ r, g, b }: Rgba): string {
  return `#${[r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;
}

export function buildTerminalTheme(
  theme: ThemeDef,
  appearance: Appearance,
  accent: AccentId = theme.defaultAccent,
): TerminalTheme {
  const tokens = resolveAppearanceTokens(theme, appearance);
  const accents = resolveAccentTokens(theme, accent, appearance);
  const ansi = resolveTerminalPalette(theme, appearance);
  const syntax = resolveSyntaxTokens(theme, appearance);

  const bg = parseHex(tokens.background);
  const surface = parseHex(tokens.card);
  const flat = (value: string, over: Rgba = bg) => hex(flatten(value, over));

  return {
    id: theme.id,
    label: theme.label,
    appearance,
    accent,

    background: flat(tokens.background),
    foreground: flat(tokens.foreground),
    surface: flat(tokens.card),
    surfaceForeground: flat(tokens.cardForeground, surface),
    muted: flat(tokens.mutedForeground),
    border: flat(tokens.border),
    borderMuted: flat(tokens.borderMuted),

    selectionBackground: flat(ansi.selectionBackground),
    selectionForeground: flat(tokens.foreground),
    focusBorder: flat(accents.ring),

    primary: flat(accents.primary),
    primaryForeground: flat(tokens.primaryForeground),

    success: flat(tokens.success),
    warning: flat(tokens.warning),
    danger: flat(tokens.danger),
    info: flat(tokens.info),
    running: flat(tokens.info),
    idle: flat(tokens.mutedForeground),

    diffAdded: flat(syntax.inserted ?? tokens.success),
    diffAddedBg: flat(tokens.successMuted),
    diffRemoved: flat(syntax.deleted ?? tokens.danger),
    diffRemovedBg: flat(tokens.dangerMuted),
    diffContext: flat(tokens.mutedForeground),

    syntax: Object.fromEntries(
      Object.entries(syntax).map(([role, value]) => [role, flat(value)]),
    ),

    ansi: Object.fromEntries(Object.entries(ansi).map(([slot, value]) => [slot, flat(value)])),
  };
}

// ── SGR encoding ──────────────────────────────────────────────────

/** xterm's 6×6×6 colour cube plus its 24-step greyscale ramp. */
export function toAnsi256(colour: Rgba): number {
  const { r, g, b } = colour;
  // Greys resolve better on the dedicated ramp than in the cube, where the
  // nearest cube entry is often visibly tinted.
  if (Math.abs(r - g) < 8 && Math.abs(g - b) < 8) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }
  const channel = (value: number) => Math.round((value / 255) * 5);
  return 16 + 36 * channel(r) + 6 * channel(g) + channel(b);
}

/** The eight base colours, matched by hue then lightness. */
export function toAnsi16(colour: Rgba): number {
  const { r, g, b } = colour;
  const max = Math.max(r, g, b);
  const bright = max > 170;
  const threshold = max / 2;

  const bits = (r >= threshold && max > 40 ? 1 : 0) | (g >= threshold && max > 40 ? 2 : 0) | (b >= threshold && max > 40 ? 4 : 0);

  if (max < 40) return 30; // black
  if (bits === 0) return bright ? 97 : 37; // washed out → white
  const base = 30 + bits;
  return bright ? base + 60 : base;
}

export interface SgrOptions {
  ladder: ColorLadder;
  background?: boolean;
}

/** The escape sequence that sets one colour, or '' when colour is disabled. */
export function sgr(colourHex: string, options: SgrOptions): string {
  if (options.ladder === 'none') return '';
  const colour = parseHex(colourHex);
  const layer = options.background ? 48 : 38;

  switch (options.ladder) {
    case 'truecolor':
      return `\u001B[${layer};2;${colour.r};${colour.g};${colour.b}m`;
    case 'ansi256':
      return `\u001B[${layer};5;${toAnsi256(colour)}m`;
    case 'ansi16': {
      const code = toAnsi16(colour);
      return `\u001B[${options.background ? code + 10 : code}m`;
    }
  }
}

export const RESET = '\u001B[0m';

/** Wraps text in a foreground colour, or returns it untouched when disabled. */
export function paint(text: string, colourHex: string, ladder: ColorLadder): string {
  if (ladder === 'none') return text;
  return `${sgr(colourHex, { ladder })}${text}${RESET}`;
}

// ── Registry ──────────────────────────────────────────────────────

export interface ResolveTerminalThemeOptions {
  /** Theme id, or 'auto' to use the default. */
  theme?: string;
  appearance?: Appearance;
  accent?: AccentId;
}

/**
 * Looks up a terminal theme by id.
 *
 * An unknown id falls back to the default rather than throwing: a config file
 * that names a theme removed in an upgrade should not make the CLI refuse to
 * start.
 */
export function resolveTerminalTheme(options: ResolveTerminalThemeOptions = {}): TerminalTheme {
  const id = !options.theme || options.theme === 'auto' ? DEFAULT_THEME : options.theme;
  const theme = THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME)!;
  return buildTerminalTheme(theme, options.appearance ?? 'dark', options.accent ?? theme.defaultAccent);
}

/** Every theme id, for the picker and for `config set tui.theme` completion. */
export function terminalThemeIds(): Array<{ id: string; label: string; description: string }> {
  return THEMES.filter((t) => !t.hidden).map((t) => ({
    id: t.id,
    label: t.label,
    description: t.description,
  }));
}

/** Pre-resolved themes, for embedding in a generated module. */
export function emitAllTerminalThemes(): Record<string, Record<Appearance, TerminalTheme>> {
  const out: Record<string, Record<Appearance, TerminalTheme>> = {};
  for (const theme of THEMES) {
    out[theme.id] = {
      dark: buildTerminalTheme(theme, 'dark'),
      light: buildTerminalTheme(theme, 'light'),
    };
  }
  return out;
}
