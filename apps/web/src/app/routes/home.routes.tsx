// docs/redesign/07-phases.md §P1-S3. Ported to features/home/HomePage in P5
// (docs/redesign/04-screen-map.md §1).
import type { RouteObject } from 'react-router';
import { defineRoute } from './defineRoute.js';

export const homeRoutes: RouteObject[] = [
  defineRoute(
    undefined,
    () => import('@/pages/DashboardPage.js').then((m) => ({ default: m.DashboardPage })),
    { legacyHeader: true, title: 'Dashboard' },
    true,
  ),
];
