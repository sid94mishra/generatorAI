// ────────────────────────────────────────────────────────────────
// B-07 DiffView theming — one source of truth for both shadow-roots
// (03-domain §2.2 B-07, §6.3; D-16, D-33).
//
// @pierre/diffs and @pierre/trees each render inside their own shadow-root,
// so page CSS (and therefore every design utility) does not reach them. Both
// read CSS custom properties from the host element, which is how they get the
// app's theme: every value below is a `var(--gai-*)` design value or a
// `var(--syntax-*)` colour, never a literal, so switching theme, mode, accent
// or font size repaints without re-highlighting anything.
//
// These objects are the sanctioned place for `var()` plumbing into the
// libraries: they are not class strings, and hosts spread them onto the one
// element the library reads (`style={{ ...diffHostStyle, ...style }}`).
// ────────────────────────────────────────────────────────────────

import type { CSSProperties } from 'react';

/**
 * The Shiki theme every diff/code view uses: CodeBlock's (C-23) TextMate
 * scope → `var(--syntax-*)` mapping, registered with @pierre/diffs by
 * `./diffSyntaxTheme.ts` (imported for its side effect by the modules that
 * render diffs). A diff, a file preview and a chat code block therefore colour
 * the same token the same way in every app theme.
 *
 * One theme serves both modes because its colours are variables that already
 * resolve per theme and per mode; the object form is what the components
 * expect. It never has to change on a theme switch, which matters: changing
 * the render theme clears every worker's AST cache.
 *
 * This module stays free of library imports so the file tree, which only
 * needs `treeHostStyleFor`, does not pull @pierre/diffs into its chunk.
 */
export const DIFF_SYNTAX_THEME = 'gai-syntax-diffs';
export const DIFF_THEMES = { dark: DIFF_SYNTAX_THEME, light: DIFF_SYNTAX_THEME } as const;

/**
 * Host CSS variables for the diff surface: the active theme's mono stack
 * (its own fonts, then the bundled JetBrains Mono, D-16) at the `small` step
 * of the type scale, so code follows the font-size setting like every
 * `font-mono text-small` element.
 */
/** Code line height, as a multiple of the font size (also the virtualizer's estimate). */
export const DIFF_LINE_HEIGHT = 1.55;

export const diffHostStyle: CSSProperties = {
  '--diffs-font-family': 'var(--font-mono)',
  '--diffs-font-size': 'var(--gai-text-small)',
  '--diffs-line-height': String(DIFF_LINE_HEIGHT),
  '--diffs-tab-size': '2',
  '--diffs-header-font-family': 'inherit',
  '--diffs-gap-inline': '8px',
  '--diffs-gap-block': '6px',
} as CSSProperties;

/**
 * Panel chrome and the diff colours, pinned to the design values.
 *
 * Delivered as `unsafeCSS` rather than as inline host variables because the
 * library re-declares its theme variables on `:host` INSIDE the shadow-root
 * (`@layer rendered`), and a local declaration beats an inherited one — so
 * host-level values are silently ignored for exactly these properties.
 * `unsafeCSS` lands in `@layer unsafe`, declared last, so these win without
 * `!important`. It carries no compatibility guarantee, but the failure mode is
 * only ever "the diff keeps the library's own palette".
 *
 * `var(--gai-…)` resolves against the host element in the light DOM, under
 * the theme/mode attributes, so one declaration covers every theme.
 *
 *   - canvas / text / line numbers: surface, fg, fg-3;
 *   - added / deleted lines: the library mixes its line backgrounds (and the
 *     word-level emphasis, the gutter bars, the +/− signs) from ONE solid
 *     base colour per side. Those bases are the theme's `ok` / `err`, the same
 *     pair `--gai-add-bg` / `--gai-del-bg` are tints of, so a diff row reads
 *     like every other add/delete in the app. (`add-bg` itself is already
 *     translucent; mixing it again would wash it out to nothing.)
 *   - hover / selection: the accent, as a SOLID colour for the same reason —
 *     the library mixes these down to roughly 9 % and 18 %.
 */
export const DIFF_UNSAFE_CSS = `
  :host {
    --diffs-light-bg: var(--gai-surface);
    --diffs-dark-bg: var(--gai-surface);
    --diffs-light: var(--gai-fg);
    --diffs-dark: var(--gai-fg);
    --diffs-fg-number-override: var(--gai-fg-3);
    --diffs-addition-color-override: var(--gai-ok);
    --diffs-deletion-color-override: var(--gai-err);
    --diffs-modified-color-override: var(--gai-run);
    --diffs-bg-hover-override: var(--gai-accent);
    --diffs-bg-selection-override: var(--gai-accent);
  }
`;

/**
 * Host CSS variables for the file tree (@pierre/trees), for one resolved mode.
 *
 * `colorScheme` is load-bearing: the library's stylesheet is built on CSS
 * `light-dark()` with `color-scheme: light dark` on its host, which resolves
 * against the OS preference, not the app's mode. Pinning it to the resolved
 * mode makes every `light-dark()` inside the shadow-root pick the right branch.
 *
 * Selection and hover use `selected` / `hover` directly: they are already
 * the design's washes (the tree does not mix them down again).
 */
export function treeHostStyleFor(resolved: 'light' | 'dark'): CSSProperties {
  return {
    colorScheme: resolved,
    // Sit on the surrounding panel rather than the library's own grey.
    '--trees-bg-override': 'transparent',
    '--trees-fg-override': 'var(--gai-fg)',
    '--trees-fg-muted-override': 'var(--gai-fg-3)',
    '--trees-input-bg-override': 'var(--gai-sunken)',
    '--trees-border-color-override': 'var(--gai-line)',
    '--trees-accent-override': 'var(--gai-accent)',
    '--trees-theme-list-active-selection-bg': 'var(--gai-selected)',
    '--trees-theme-list-active-selection-fg': 'var(--gai-fg)',
    '--trees-theme-list-hover-bg': 'var(--gai-hover)',
    '--trees-theme-focus-ring': 'var(--gai-focus)',
    '--trees-scrollbar-thumb-override': 'var(--gai-line-strong)',
  } as CSSProperties;
}
