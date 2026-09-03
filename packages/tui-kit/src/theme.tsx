// ────────────────────────────────────────────────────────────────
// Theme, in terminal terms.
//
// The palette comes from `@generatorai/design-tokens` — the same eighteen
// themes the web app ships — so "gruvbox" means one thing across the product.
// What this adds is the terminal-specific part: which colours are safe to use
// at the detected colour depth, and the glyph set to fall back to when the
// terminal cannot draw box characters.
// ────────────────────────────────────────────────────────────────

import React, { createContext, useContext, useMemo } from 'react';
import {
  resolveTerminalTheme,
  type ColorLadder,
  type TerminalTheme,
} from '@generatorai/design-tokens';
import type { TerminalCapabilities } from '@generatorai/cli-core';

export interface Glyphs {
  running: string;
  success: string;
  failure: string;
  warning: string;
  idle: string;
  neutral: string;
  bullet: string;
  arrowRight: string;
  arrowDown: string;
  chevron: string;
  ellipsis: string;
  spinner: string[];
  treeBranch: string;
  treeLast: string;
  treeVertical: string;
  progressFull: string;
  progressEmpty: string;
  scrollThumb: string;
  scrollTrack: string;
}

const UNICODE_GLYPHS: Glyphs = {
  running: '⟳',
  success: '✓',
  failure: '✗',
  warning: '⏸',
  idle: '○',
  neutral: '·',
  bullet: '•',
  arrowRight: '▸',
  arrowDown: '▾',
  chevron: '›',
  ellipsis: '…',
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  treeBranch: '├─',
  treeLast: '└─',
  treeVertical: '│ ',
  progressFull: '█',
  progressEmpty: '░',
  scrollThumb: '▐',
  scrollTrack: '│',
};

const ASCII_GLYPHS: Glyphs = {
  running: '>',
  success: '+',
  failure: 'x',
  warning: '!',
  idle: 'o',
  neutral: '-',
  bullet: '*',
  arrowRight: '>',
  arrowDown: 'v',
  chevron: '>',
  ellipsis: '...',
  spinner: ['|', '/', '-', '\\'],
  treeBranch: '|-',
  treeLast: '`-',
  treeVertical: '| ',
  progressFull: '#',
  progressEmpty: '.',
  scrollThumb: '|',
  scrollTrack: ':',
};

export interface Theme extends TerminalTheme {
  glyphs: Glyphs;
  ladder: ColorLadder;
  /**
   * Colour a component should pass to Ink, or `undefined` when colour is off.
   *
   * Returning `undefined` rather than a default matters: Ink treats an
   * explicit colour as an escape sequence to emit, so a "black" fallback on a
   * NO_COLOR terminal would still emit escapes into a plain-text pipe.
   */
  c(colour: keyof TerminalTheme | undefined): string | undefined;
  /** Border style honouring the unicode capability. */
  borderStyle: 'round' | 'single' | 'classic';
  /**
   * Carried straight from `TerminalCapabilities` (Phase 4 item 8) so any
   * component reading the theme — not just the ones that happen to receive
   * capabilities as a separate prop — can suppress animation/decoration
   * that's noise for a screen reader or a non-interactive/CI render.
   * `reducedMotion` already defaults true under CI/non-TTY, so consumers of
   * this get that coverage without checking `screenReader` separately.
   */
  screenReader: boolean;
  reducedMotion: boolean;
}

const ThemeContext = createContext<Theme | null>(null);

export interface ThemeProviderProps {
  capabilities: TerminalCapabilities;
  theme?: string;
  appearance?: 'light' | 'dark';
  accent?: 'blue' | 'violet' | 'green' | 'orange' | 'rose' | 'teal';
  children: React.ReactNode;
}

export function buildTheme(options: {
  capabilities: TerminalCapabilities;
  theme?: string | undefined;
  appearance?: 'light' | 'dark' | undefined;
  accent?: 'blue' | 'violet' | 'green' | 'orange' | 'rose' | 'teal' | undefined;
}): Theme {
  const base = resolveTerminalTheme({
    ...(options.theme ? { theme: options.theme } : {}),
    // A terminal cannot report its background reliably, and guessing wrong
    // gives dark-on-dark text. Dark is the safe default for a TUI.
    appearance: options.appearance ?? 'dark',
    ...(options.accent ? { accent: options.accent } : {}),
  });

  const ladder: ColorLadder =
    options.capabilities.colorDepth === 'none'
      ? 'none'
      : options.capabilities.colorDepth === 'ansi16'
        ? 'ansi16'
        : options.capabilities.colorDepth === 'ansi256'
          ? 'ansi256'
          : 'truecolor';

  const glyphs = options.capabilities.unicode ? UNICODE_GLYPHS : ASCII_GLYPHS;

  return {
    ...base,
    glyphs,
    ladder,
    borderStyle: options.capabilities.unicode ? 'round' : 'classic',
    screenReader: options.capabilities.screenReader,
    reducedMotion: options.capabilities.reducedMotion,
    c(colour) {
      if (!colour || ladder === 'none') return undefined;
      const value = base[colour];
      return typeof value === 'string' ? value : undefined;
    },
  };
}

export function ThemeProvider({
  capabilities,
  theme,
  appearance,
  accent,
  children,
}: ThemeProviderProps): React.JSX.Element {
  const value = useMemo(
    () => buildTheme({ capabilities, theme, appearance, accent }),
    [capabilities, theme, appearance, accent],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * The active theme.
 *
 * Throws rather than returning a default: a component rendering outside the
 * provider would silently use colours from a different theme than everything
 * around it, which is far harder to spot than a crash in development.
 */
export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme must be used inside a <ThemeProvider>.');
  return theme;
}

export type StatusTone = 'running' | 'success' | 'failure' | 'warning' | 'idle' | 'neutral';

/** Colour + glyph for a status, so callers never encode meaning in hue alone. */
export function statusStyle(theme: Theme, tone: StatusTone): { color: string | undefined; glyph: string } {
  switch (tone) {
    case 'running':
      return { color: theme.c('running'), glyph: theme.glyphs.running };
    case 'success':
      return { color: theme.c('success'), glyph: theme.glyphs.success };
    case 'failure':
      return { color: theme.c('danger'), glyph: theme.glyphs.failure };
    case 'warning':
      return { color: theme.c('warning'), glyph: theme.glyphs.warning };
    case 'idle':
      return { color: theme.c('idle'), glyph: theme.glyphs.idle };
    default:
      return { color: undefined, glyph: theme.glyphs.neutral };
  }
}
