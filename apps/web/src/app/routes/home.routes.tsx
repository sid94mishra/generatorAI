// docs/redesign/07-phases.md §P1-S3; Home (L-01) since P5-10
// (docs/redesign/04-screen-map.md §1, §2.1 Home).
import type { RouteObject } from 'react-router';
import { defineRoute } from './defineRoute.js';

export const homeRoutes: RouteObject[] = [
  defineRoute(
    undefined,
    () => import('@/features/home/HomePage.js').then((m) => ({ default: m.HomePage })),
    // Renders its own PageHeader (L-01).
    { nav: 'home', title: 'Home' },
    true,
  ),
];
