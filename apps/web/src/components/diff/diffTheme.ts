// ────────────────────────────────────────────────────────────────
// Diff/tree theming — one source of truth for both shadow roots
// ────────────────────────────────────────────────────────────────
//
// @pierre/diffs and @pierre/trees each render inside their own shadow root,
// so page CSS does not reach them. Both read CSS custom properties from the
// host element, which is how we hand them the app's theme.
//
// Deliberately built on CSS variables rather than `unsafeCSS`: the library
// explicitly does NOT guarantee backwards compatibility for `unsafeCSS`,
// even across patch releases.

import type { CSSProperties } from 'react';

/**
 * Shiki themes. Both are bundled with @pierre/diffs, and the object form
 * makes the components switch automatically with `themeType`.
 */
export const DIFF_THEMES = { dark: 'pierre-dark', light: 'pierre-light' } as const;

/**
 * Host CSS variables for the diff surface. Fonts and sizes are inherited
 * from our design tokens so diffs match the rest of the app.
 *
 * Colours are NOT set here — see `DIFF_UNSAFE_CSS` for why.
 */
export const diffHostStyle: CSSProperties = {
  // Code font — falls back through the same stack the editor/terminal uses.
  '--diffs-font-family':
    "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
  '--diffs-font-size': '12px',
  '--diffs-line-height': '1.55',
  '--diffs-tab-size': '2',
  '--diffs-header-font-family': 'inherit',
  '--diffs-gap-inline': '8px',
  '--diffs-gap-block': '6px',
} as CSSProperties;

/**
 * Panel chrome for the code viewer, pinned to the app's tokens.
 *
 * This is about ownership: the syntax theme decides how CODE looks, and the
 * app decides how the PANEL looks. Left alone the library takes both —
 * `--diffs-bg` falls back to the Shiki theme's own canvas (`#0a0a0a` for
 * pierre-dark), which sits beside our `#0d1117` surfaces as a visibly
 * different near-black. Everything the library derives from `--diffs-bg`
 * (context bands, hunk separators, the buffer hatching) is a `color-mix` of
 * it, so correcting the one root value brings the whole surface along.
 *
 * Deliberately NOT overridden: `--diffs-addition-color`,
 * `--diffs-deletion-color`, `--diffs-modified-color` and everything mixed
 * from them. Those ARE the diff — the red/green that says what changed is
 * the library's job, and it derives them from the same Shiki theme that
 * colours the tokens sitting on top of them. Same for the gutter icons.
 *
 * Delivered as `unsafeCSS` rather than as inline host variables because the
 * library re-declares its own theme variables on `:host` INSIDE the shadow
 * root (`@layer rendered`), and a local declaration always beats an
 * inherited one — so host-level values are silently ignored for exactly
 * these properties. `unsafeCSS` lands in `@layer unsafe`, which the library
 * declares last, so these win without `!important`. Being an explicit
 * escape hatch it carries no compatibility guarantee, but the failure mode
 * is only ever "the diff keeps its own palette".
 *
 * `var(--color-…)` resolves against the host element, which lives in the
 * light DOM under `.dark`, so one declaration covers both themes and there
 * is no second copy of the palette to drift from `globals.css`.
 */
export const DIFF_UNSAFE_CSS = `
  :host {
    /* Panel canvas + default text. Both halves of the library's
       light-dark() get the same token because the token itself is already
       theme-aware. */
    --diffs-light-bg: var(--color-background);
    --diffs-dark-bg: var(--color-background);
    --diffs-light: var(--color-foreground);
    --diffs-dark: var(--color-foreground);
    /* Line numbers are chrome, not code. */
    --diffs-fg-number-override: var(--color-muted-foreground);
    /* Row hover and line selection use the same accent as the file tree and
       the changed-file rows, so pointing at a line looks the same
       everywhere. The library mixes these down to roughly 9% and 18%, so a
       SOLID token is required — passing an already-transparent one washes
       out to nothing. */
    --diffs-bg-hover-override: var(--color-primary);
    --diffs-bg-selection-override: var(--color-primary);
  }
`;

/**
 * Host CSS variables for the file tree, for one resolved app theme.
 *
 * Two things here are load-bearing:
 *
 * 1. `colorScheme`. The library's stylesheet is built on CSS `light-dark()`
 *    with `color-scheme: light dark` on its host, which resolves against the
 *    OS/browser preference — NOT our `.dark` class. Left alone, a user in app
 *    dark mode on a light OS gets a white tree. Pinning `color-scheme` to the
 *    theme we resolved is what makes every `light-dark()` inside the shadow
 *    root pick the right branch.
 *
 * 2. Selection/hover built on `--color-primary`, not `--color-accent`.
 *    `--accent` is ALREADY a ~10%-alpha wash of the primary, so mixing it
 *    down again (`22%` of an alpha colour) landed at ~2% opacity — visually
 *    nothing, which is why selection was invisible in light mode.
 */
export function treeHostStyleFor(resolved: 'light' | 'dark'): CSSProperties {
  const isDark = resolved === 'dark';
  return {
    colorScheme: resolved,
    // Sit on the surrounding panel rather than the library's own grey.
    '--trees-bg-override': 'transparent',
    '--trees-fg-override': 'var(--color-foreground)',
    '--trees-fg-muted-override': 'var(--color-muted-foreground)',
    '--trees-input-bg-override': 'var(--color-background)',
    '--trees-border-color-override': 'var(--color-border)',
    '--trees-accent-override': 'var(--color-primary)',
    // Selected row: strong enough to find at a glance in both themes.
    '--trees-theme-list-active-selection-bg': isDark
      ? 'color-mix(in oklab, var(--color-primary) 30%, transparent)'
      : 'color-mix(in oklab, var(--color-primary) 18%, transparent)',
    '--trees-theme-list-active-selection-fg': 'var(--color-foreground)',
    '--trees-theme-list-hover-bg': isDark
      ? 'color-mix(in oklab, var(--color-primary) 16%, transparent)'
      : 'color-mix(in oklab, var(--color-primary) 10%, transparent)',
    '--trees-theme-focus-ring': 'var(--color-primary)',
    '--trees-scrollbar-thumb-override':
      'color-mix(in oklab, var(--color-foreground) 25%, transparent)',
  } as CSSProperties;
}

/** Resolve the app theme into the diff components' `themeType` prop. */
export function themeTypeFor(resolved: 'light' | 'dark'): 'light' | 'dark' {
  return resolved;
}
