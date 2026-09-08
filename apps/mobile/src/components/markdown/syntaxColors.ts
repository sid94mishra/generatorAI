// ────────────────────────────────────────────────────────────────
// Syntax colours — token kind → theme colour.
//
// The design tokens have no `syntax-*` entries (the web highlights with
// highlight.js classes styled per theme in CSS). Rather than invent a second
// palette that drifts from the theme, each token kind maps onto a semantic
// colour the theme already defines, so a palette or accent switch recolours
// code blocks for free and a dark GitHub theme reads like GitHub's own.
//
// Pure module so the mapping is testable without a theme provider.
// ────────────────────────────────────────────────────────────────

import type { TokenKind } from './highlight';

export type SyntaxPalette = Record<TokenKind, string | undefined>;

/**
 * Build the palette from the theme's literal colour bag (`useTheme().colors`).
 *
 * `plain` is `undefined` on purpose: a plain span inherits the parent
 * `Text`'s colour, which keeps the span count down (no style object) and
 * means un-highlighted and highlighted code share one body colour.
 */
export function syntaxPalette(colors: Record<string, string | undefined>): SyntaxPalette {
  const primary = colors.primary;
  const info = colors.info ?? colors['primary-emphasis'] ?? primary;
  const done = colors.done ?? info;
  return {
    plain: undefined,
    keyword: primary,
    string: colors.success,
    comment: colors['muted-foreground'],
    number: colors.warning,
    literal: colors.warning,
    type: info,
    tag: primary,
    attr: done,
    property: info,
    heading: primary,
    meta: colors['muted-foreground'],
    added: colors.success,
    removed: colors.danger,
  };
}
