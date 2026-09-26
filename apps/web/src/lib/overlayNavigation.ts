// ────────────────────────────────────────────────────────────────
// Overlay navigations (D-26, 06 §2.4).
//
// Settings is a modal addressed by URL (`/settings/:section?`) that renders
// over the page the user was on: the navigation carries that page as
// `state.backgroundLocation`, and the shell keeps rendering it behind the
// modal. Such a navigation does not leave the page, so an unsaved-changes
// guard (WorkflowBuilderPage's `useBlocker`) must let it through — and the
// return to the background page when the modal closes, and paging between
// sections inside it.
// ────────────────────────────────────────────────────────────────

import { isSettingsPath } from '@generatorai/shared/ui-contract';

/** The fields of a router location this module reads. */
export interface OverlayLocationLike {
  pathname: string;
  search?: string;
  hash?: string;
  state?: unknown;
  key?: string;
}

export interface OverlayState {
  backgroundLocation: OverlayLocationLike;
}

/** The page an overlay location renders over, when its state names one. */
export function backgroundLocationOf(state: unknown): OverlayLocationLike | null {
  if (state === null || typeof state !== 'object') return null;
  const bg = (state as { backgroundLocation?: unknown }).backgroundLocation;
  if (bg === null || typeof bg !== 'object') return null;
  const pathname = (bg as { pathname?: unknown }).pathname;
  return typeof pathname === 'string' ? (bg as OverlayLocationLike) : null;
}

/**
 * True when going from `current` to `next` keeps the page behind an overlay
 * mounted, so an unsaved-changes guard must not fire:
 * - opening the overlay over `current` (next is an overlay address whose
 *   background is `current`, or names none — the shell then keeps the page
 *   the user was on);
 * - moving inside the overlay (settings section to settings section);
 * - closing it back to the page it was opened over.
 */
export function isOverlayNavigation(current: OverlayLocationLike, next: OverlayLocationLike): boolean {
  const currentIsOverlay = isSettingsPath(current.pathname);
  const nextIsOverlay = isSettingsPath(next.pathname);
  if (nextIsOverlay) {
    if (currentIsOverlay) return true;
    const bg = backgroundLocationOf(next.state);
    return bg === null || bg.pathname === current.pathname;
  }
  if (!currentIsOverlay) return false;
  const bg = backgroundLocationOf(current.state);
  return bg !== null && bg.pathname === next.pathname;
}
