// `*` catch-all: the L-03 Gate "Page not found" inside the main card (D-32,
// 04 R-6). Never gets a `legacyHeader`.
import type { RouteObject } from 'react-router';
import { NotFoundPage } from '../shell/RouteErrors.js';

export const notFoundRoutes: RouteObject[] = [
  {
    path: '*',
    element: <NotFoundPage />,
  },
];
