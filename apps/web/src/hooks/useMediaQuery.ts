// ────────────────────────────────────────────────────────────────
// useMediaQuery — subscribe to a CSS media query from React.
//
// `useSyncExternalStore` so the first render already reflects the real
// viewport (no flash of the desktop layout on a phone) and so the value is
// consistent across concurrent renders. Degrades to `false` where
// `matchMedia` is missing (SSR, some test environments).
// ────────────────────────────────────────────────────────────────

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Tailwind's `md` breakpoint. Below it the app's side surfaces (the sidebar,
 * the right pane) must not sit beside the content — they overlay it. Keep in
 * step with the `md:` utilities used in `layout/AppLayout.tsx`.
 */
export const NARROW_VIEWPORT_QUERY = '(max-width: 767.98px)';

function subscribe(query: string, onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mql = window.matchMedia(query);
  // Older WebKit only has the deprecated pair; prefer the standard one.
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }
  mql.addListener(onChange);
  return () => mql.removeListener(onChange);
}

function read(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(query).matches;
}

export function useMediaQuery(query: string): boolean {
  const sub = useCallback((onChange: () => void) => subscribe(query, onChange), [query]);
  const get = useCallback(() => read(query), [query]);
  return useSyncExternalStore(sub, get, () => false);
}

/** True below the `md` breakpoint — phone-width layouts. */
export function useIsNarrowViewport(): boolean {
  return useMediaQuery(NARROW_VIEWPORT_QUERY);
}
