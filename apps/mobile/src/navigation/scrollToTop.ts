// ────────────────────────────────────────────────────────────────
// Scroll-to-top registry.
//
// Re-tapping the active tab returns its content to the top. Both platforms
// do this and neither exposes it to a JS tab navigator, because the tab bar
// has no reference to whatever scroller the screen happens to own.
//
// A tiny registry keyed by route name is the honest way across: the screen
// registers its scroller while focused, the tab bar asks for it by name.
// Nothing else in the app needs a navigation singleton, so this stays a
// module rather than becoming a context.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect } from 'react';

import { haptics } from '../components/ui/haptics';

type Scroller = { scrollToOffset?: (opts: { offset: number; animated?: boolean }) => void } & {
  scrollTo?: (opts: { y: number; animated?: boolean }) => void;
};

const registry = new Map<string, () => void>();

/** Called by the navigation drawer when the section already on screen is chosen again. */
export function scrollActiveToTop(routeName: string): void {
  const scroll = registry.get(routeName);
  if (!scroll) return;
  haptics.tap();
  scroll();
}

/**
 * Register a scroll-to-top handler for a route.
 *
 * `routeName` must match the `Tabs.Screen` name, not the path — the tab bar
 * only ever sees the former.
 */
export function useScrollToTop(routeName: string, scroll: () => void): void {
  const stable = useCallback(scroll, [scroll]);
  useEffect(() => {
    registry.set(routeName, stable);
    return () => {
      if (registry.get(routeName) === stable) registry.delete(routeName);
    };
  }, [routeName, stable]);
}

/** Adapts a list or scroll-view ref into the handler shape above. */
export function scrollerToTop(ref: { current: Scroller | null }): () => void {
  return () => {
    const node = ref.current;
    if (!node) return;
    if (typeof node.scrollToOffset === 'function') node.scrollToOffset({ offset: 0, animated: true });
    else if (typeof node.scrollTo === 'function') node.scrollTo({ y: 0, animated: true });
  };
}
