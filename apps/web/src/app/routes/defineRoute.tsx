// ────────────────────────────────────────────────────────────────
// defineRoute — per-area route module helper (P1-S3 router split).
//
// docs/redesign/06-desktop-and-shell.md §2.3–§2.4, docs/redesign/04-screen-map.md §0.
// `RouteSlot` renders the lazy page in the main card body, inside its error
// boundary and Suspense loader. Every page renders its own PageHeader.
// ────────────────────────────────────────────────────────────────

import type { ComponentType, ReactElement } from 'react';
import React, { lazy, Suspense } from 'react';
import type { RouteObject } from 'react-router';
import type { NavDestinationId } from '@generatorai/shared/ui-contract';
import { MainCardBody } from '@/ui/shell/MainCard/MainCard.js';
import { PageErrorBoundary, PageLoader } from './PageFallbacks.js';

export interface GaiRouteHandle {
  /** Collapse the sidebar to the rail at every window width (workflow
   *  builder, 06 §2.5); Expand then opens the flyout. */
  forceRail?: boolean;
  /** Page name for PageErrorBoundary / Suspense and File ▸ Open Recent
   *  fallback labels. */
  title: string;
  /** Sidebar nav destination this route belongs to (the sidebar's active
   *  state reads `navDestinationFor(path)`, which agrees — tested). Set on
   *  every area route; Settings and the 404 have none. */
  nav?: NavDestinationId;
}

/** The element wrapper every route renders through. Sits inside the
 *  `children` of the shell route (not next to `useRoutes`), so `useParams()`
 *  still resolves route params for the page it wraps. */
export function RouteSlot({
  handle,
  children,
}: {
  handle: GaiRouteHandle;
  children: ReactElement;
}) {
  return (
    <MainCardBody>
      <PageErrorBoundary pageName={handle.title}>
        <Suspense fallback={<PageLoader />}>{children}</Suspense>
      </PageErrorBoundary>
    </MainCardBody>
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
