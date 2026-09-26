// ────────────────────────────────────────────────────────────────
// The resolved light/dark mode, read from the document.
//
// The one appearance writer (`applyAppearance`, D-25 — ThemeProvider in the
// app, the toolbar decorator in Storybook) puts `.light` or `.dark` on <html>.
// The diff libraries need that mode for their `light-dark()` branches, and
// reading it here instead of from ThemeProvider's context keeps the diff
// blocks renderable anywhere the appearance is applied (the workshop included)
// without a second writer.
// ────────────────────────────────────────────────────────────────

import { useSyncExternalStore } from 'react';

export type ResolvedAppearance = 'light' | 'dark';

function read(): ResolvedAppearance {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.classList.contains('light') ? 'light' : 'dark';
}

function subscribe(onChange: () => void): () => void {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

/** `'light' | 'dark'` as currently applied to the document; re-renders when it flips. */
export function useDocumentAppearance(): ResolvedAppearance {
  return useSyncExternalStore(subscribe, read, () => 'dark');
}

function readSmallTextPx(): number {
  if (typeof document === 'undefined') return 12;
  const px = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gai-text-small'));
  return Number.isFinite(px) && px > 0 ? px : 12;
}

function subscribeAttributes(onChange: () => void): () => void {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true });
  return () => observer.disconnect();
}

/**
 * The `small` type step in px (the diff code size), re-read when the
 * appearance attributes on <html> change (the interface font-size setting).
 * The diff virtualizer needs the resulting line height as a NUMBER for its
 * pre-measure estimate; an estimate that is off by a pixel a line leaves
 * dead space above short diffs.
 */
export function useDocumentSmallTextPx(): number {
  return useSyncExternalStore(subscribeAttributes, readSmallTextPx, () => 12);
}
