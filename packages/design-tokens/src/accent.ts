// ────────────────────────────────────────────────────────────────
// Accent triples for mobile (MD-08; mobile 02 §2.5).
//
// An accent owns exactly three design tokens (DESIGN_ACCENT_KEYS): accent,
// on-accent and focus. Everything else — surfaces, lines, text tiers and every
// status colour — is accent-independent, so the Android "System (Material
// You)" accent can never touch them.
//
// `resolveAccentFromSeed` derives the triple from a device seed colour with
// exactly the rules `resolveDesignTokens` applies to a named hue accent:
//   accent   = ensureContrast(seed, onAccent, 4.5)        (accentEmphasis)
//   onAccent = the theme's onAccent                       (resolveAccentTokens)
//   focus    = ensureContrastAll(accent, five surfaces, 3, fg)
// ────────────────────────────────────────────────────────────────

import { ensureContrast, ensureContrastAll, parseHex, toHex } from './color.js';
import { resolveDesignTokens } from './design.js';
import type { AccentId, Appearance, ThemeDef } from './themes/types.js';

/** The three variables an accent owns (DESIGN_ACCENT_KEYS), as CSS variable names. */
export interface AccentVars {
  '--gai-accent': string;
  '--gai-on-accent': string;
  '--gai-focus': string;
}

/** The three tokens an accent owns, camelCase (same keys as DesignTokens). */
export interface AccentTokenTriple {
  /** '#rrggbb', lowercase, opaque. */
  accent: string;
  /** '#rrggbb', lowercase, opaque. */
  onAccent: string;
  /** '#rrggbb', lowercase, opaque. */
  focus: string;
}

/** `accentEmphasis`'s bar: text on a filled accent (AA). */
const AA_TEXT = 4.5;
/** `resolveDesignTokens`'s non-text bar for the focus ring. */
const NON_TEXT = 3;
const SEED_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Derive accent / on-accent / focus from a device seed colour (Material You
 * primary) with exactly the contrast rules resolveDesignTokens applies to a
 * named hue accent.
 *
 * @param theme       the active ThemeDef (its surfaces stay ours)
 * @param appearance  'dark' | 'light' — the resolved appearance, not the mode
 * @param hex         '#rrggbb' or '#rgb' (case-insensitive).
 * @throws RangeError when `hex` is not a 3- or 6-digit hex colour. Callers
 *         catch and fall back to the theme's default accent.
 */
export function resolveAccentFromSeed(theme: ThemeDef, appearance: Appearance, hex: string): AccentTokenTriple {
  if (typeof hex !== 'string' || !SEED_RE.test(hex)) {
    throw new RangeError(`Not a 3- or 6-digit hex colour: ${String(hex)}`);
  }
  const seed = { ...parseHex(hex), a: 1 };
  const s = theme[appearance];
  const onAccent = s.onAccent;
  const accent = toHex(ensureContrast(seed, onAccent, AA_TEXT));
  // Surfaces are accent-independent: read them at the theme's default accent.
  const d = resolveDesignTokens(theme, appearance, theme.defaultAccent);
  const surfaces = [d.ground, d.surface, d.raised, d.overlay, d.sunken];
  const focus = toHex(ensureContrastAll(accent, surfaces, NON_TEXT, s.foreground));
  return { accent, onAccent: toHex(parseHex(onAccent)), focus };
}

/** Named accent → the same triple (reads resolveDesignTokens). Used by the generator and tests. */
export function accentTokens(theme: ThemeDef, appearance: Appearance, accent: AccentId): AccentTokenTriple {
  const d = resolveDesignTokens(theme, appearance, accent);
  return { accent: d.accent, onAccent: d.onAccent, focus: d.focus };
}

/** Triple → the CSS variables Uniwind.updateCSSVariables takes. */
export function toAccentVars(t: AccentTokenTriple): AccentVars {
  return { '--gai-accent': t.accent, '--gai-on-accent': t.onAccent, '--gai-focus': t.focus };
}
