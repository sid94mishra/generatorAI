// docs/redesign/07-phases.md §P1-S3. `*` catch-all placeholder, preserving
// today's inline 404 element. Restyled with the L-03 Gate layout in P3
// (docs/redesign/04-screen-map.md §3, D-32); never gets a `legacyHeader`.
import type { RouteObject } from 'react-router';
import { NotFoundPage } from '@/components/NotFoundPage.js';

export const notFoundRoutes: RouteObject[] = [
  {
    path: '*',
    element: <NotFoundPage />,
  },
];
