// ────────────────────────────────────────────────────────────────
// defineRoute — per-area route module helper (P1-S3 router split)
//
// docs/redesign/06-desktop-and-shell.md §2.3–§2.4, docs/redesign/04-screen-map.md §0.
// Replaces the old router.tsx's `withBoundary()`. `RouteSlot` is the place
// LegacyHeader will render once the shell lands in P3 (D-21) — for now it
// renders the page unchanged, so every route's `legacyHeader: true` is
// recorded but not yet acted on.
// ────────────────────────────────────────────────────────────────

import type { ComponentType, ReactElement } from 'react';
import React, { lazy, Suspense } from 'react';
import type { RouteObject } from 'react-router';
import type { NavDestinationId } from '@generatorai/shared/ui-contract';
import { PageErrorBoundary } from '@/components/PageErrorBoundary.js';
import { PageLoader } from '@/components/PageLoader.js';

export interface GaiRouteHandle {
  /** Render the old global Header (components/layout/Header.tsx) above the
   *  page (D-21). Removed per route as it is ported. Not yet consumed by
   *  RouteSlot — LegacyHeader lands in P3. */
  legacyHeader: boolean;
  /** Page name for PageErrorBoundary / Suspense and File ▸ Open Recent
   *  fallback labels. */
  title: string;
  /** Sidebar nav destination this route belongs to (P3's active-state source).
   *  Set on every area route; Settings and the 404 have none. Must agree with
   *  `navDestinationFor(path)` (tested). */
  nav?: NavDestinationId;
}

/** The element wrapper every route renders through. Replaces `withBoundary()`.
 *  Sits inside the `children` of the shell route (not next to `useRoutes`), so
 *  `useParams()` still resolves route params for the page it wraps. */
export function RouteSlot({
  handle,
  children,
}: {
  handle: GaiRouteHandle;
  children: ReactElement;
}) {
  return (
    <PageErrorBoundary pageName={handle.title}>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </PageErrorBoundary>
  );
}

/** Build one lazy-loaded, boundary-wrapped route entry. */
export function defineRoute(
  path: string | undefined,
  load: () => Promise<{ default: ComponentType }>,
  handle: GaiRouteHandle,
  index = false,
): RouteObject {
  const Page = lazy(load);
  const element = (
    <RouteSlot handle={handle}>
      <Page />
    </RouteSlot>
  );
  return index ? { index: true, handle, element } : { path, handle, element };
}
