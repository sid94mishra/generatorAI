// ────────────────────────────────────────────────────────────────
// applyAppearance — the one DOM writer of the appearance axes (D-25;
// 09-verification.md §3.3).
//
//   class           light | dark      the RESOLVED appearance
//   data-mode       system | light | dark   the preference (not a CSS key)
//   data-theme      theme id
//   data-accent     accent id
//   data-density    comfortable | compact
//   data-font-size  12 | 13 | 14
//   data-motion     reduce | (absent)
//
// The token CSS keys off exactly these, so switching any axis is attribute
// writes and zero React re-renders below. Pure and presentational: it knows
// nothing about storage, the OS or the desktop shell. ThemeProvider resolves
// the preferences and calls it for <html>; the Storybook decorator calls it
// with the toolbar globals (any element works: the selectors are unqualified,
// so the attributes theme a subtree). The generated pre-paint script in
// index.html writes the same attributes before first paint; a test runs both
// and requires identical results.
// ────────────────────────────────────────────────────────────────

import type { AccentId, Appearance, Density, FontSizeSetting, ThemeMode } from '@generatorai/design-tokens';

export interface AppliedAppearance {
  /** The stored preference; defaults to `resolved` (Storybook has no `system`). */
  mode?: ThemeMode;
  /** What the mode resolves to right now. */
  resolved: Appearance;
  theme: string;
  accent: AccentId;
  density: Density;
  fontSize: FontSizeSetting;
  /** Effective: the user's "always" OR the OS asking for reduced motion. */
  reduceMotion: boolean;
}

function setAttr(el: HTMLElement, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    // Writing an unchanged value can still invalidate style; skip it.
    el.setAttribute(name, value);
  }
}

export function applyAppearance(a: AppliedAppearance, target: HTMLElement = document.documentElement): void {
  const other: Appearance = a.resolved === 'dark' ? 'light' : 'dark';
  if (target.classList.contains(other)) target.classList.remove(other);
  if (!target.classList.contains(a.resolved)) target.classList.add(a.resolved);
  setAttr(target, 'data-mode', a.mode ?? a.resolved);
  setAttr(target, 'data-theme', a.theme);
  setAttr(target, 'data-accent', a.accent);
  setAttr(target, 'data-density', a.density);
  setAttr(target, 'data-font-size', a.fontSize);
  setAttr(target, 'data-motion', a.reduceMotion ? 'reduce' : null);
}
