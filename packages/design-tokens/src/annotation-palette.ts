// ────────────────────────────────────────────────────────────────
// Native-browser overlay palette (06-desktop-and-shell.md §4.4).
//
// The desktop's native browser injects its annotation, element-picker and
// region-capture overlays INTO third-party pages, so their colours cannot be
// CSS variables: they travel over IPC as plain literals and are interpolated
// (via JSON.stringify) into the injected script. They are derived here from
// the same resolved design layer the app paints with, so the overlay follows
// the active theme instead of carrying its own hues.
//
// `AnnotationPalette` is a browser-IPC payload, which D-54 would place in
// `@generatorai/shared` (`DesktopShell.ts`). It is declared here instead
// because design-tokens is a dependency-free leaf (web, mobile, desktop main
// and the Node generator all consume it) and must not depend on shared, and
// shared must not depend on design-tokens either (it is consumed by the
// server, CLI and mobile). Desktop and web both already depend on
// design-tokens, so importing the type from here adds no package edge.
// ────────────────────────────────────────────────────────────────

import { contrastRatio, flatten, parseHex, toHex, type Rgba } from './color.js';
import { SHADOW, resolveDesignTokens } from './design.js';
import { DEFAULT_ACCENT } from './registry.js';
import { getThemeDef } from './themes/index.js';
import type { Appearance } from './themes/types.js';

/** Colours of the overlays the desktop injects into native-browser pages. */
export interface AnnotationPalette {
  /** Hover highlight, pins, region box, primary buttons (`run`). */
  accent: string;
  /** Text on `accent`: whichever of fg / ground / on-accent reads best on it. */
  onAccent: string;
  /** Pin colour once it carries a comment (`ok`). */
  done: string;
  /** Comment card background (`overlay`). */
  bg: string;
  /** Comment card header (`raised`). */
  panel: string;
  /** Primary text (`fg`). */
  text: string;
  /** Secondary text (`fg-2`). */
  sub: string;
  /** Card and input borders (`line`). */
  border: string;
  /** Textarea background (`sunken`). */
  input: string;
  /** Delete button (`err`). */
  danger: string;
  /** Card drop shadow: `shadow-pop`'s colour as `rgba(r,g,b,a)`, no spaces. */
  shadow: string;
}

/** `#rrggbb` of a colour, composited onto `back` when it is translucent. */
function opaque(colour: string | Rgba, back: string | Rgba): string {
  const c = typeof colour === 'string' ? parseHex(colour) : colour;
  return toHex(c.a >= 1 ? c : flatten(c, back)).slice(0, 7);
}

/** `rgba(r,g,b,a)` with no spaces and at most three alpha decimals. */
function compactRgba(colour: string): string {
  const { r, g, b, a } = parseHex(colour);
  return `rgba(${r},${g},${b},${Number(a.toFixed(3))})`;
}

/**
 * Resolve the overlay palette for one theme and appearance. Unknown theme ids
 * fall back to the default theme, like every other theme lookup. The accent
 * setting is deliberately ignored: `run` (not `accent`) marks the page,
 * because the default ink accent is near-white in dark mode and would vanish
 * on third-party pages.
 */
export function annotationPalette(themeId: string, appearance: Appearance): AnnotationPalette {
  const t = resolveDesignTokens(getThemeDef(themeId), appearance, DEFAULT_ACCENT);
  const ground = opaque(t.ground, '#000000');
  const bg = opaque(t.overlay, ground);
  const accent = opaque(t.run, bg);
  const onAccent = [t.fg, t.ground, t.onAccent]
    .map((c) => opaque(c, bg))
    .reduce((best, c) => (contrastRatio(c, accent) > contrastRatio(best, accent) ? c : best));
  return {
    accent,
    onAccent,
    done: opaque(t.ok, bg),
    bg,
    panel: opaque(t.raised, bg),
    text: opaque(t.fg, bg),
    sub: opaque(t.fg2, bg),
    border: opaque(t.line, bg),
    input: opaque(t.sunken, bg),
    danger: opaque(t.err, bg),
    shadow: compactRgba(SHADOW[appearance]),
  };
}
