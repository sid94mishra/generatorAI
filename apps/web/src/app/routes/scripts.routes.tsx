// docs/redesign/07-phases.md §P1-S3. Ported onto the kit (PW-d, 2026-09-27):
// the Workflow Overhaul (D-81) built these functional-only on legacy
// components; the redesign now rebuilds them on `ui/` + `blocks/` (D-35
// fallback port). Both routes render the same T-05 MasterDetail page — the
// optional `:id` just selects the detail pane.
import type { RouteObject } from 'react-router';
import { defineRoute } from './defineRoute.js';

export const scriptsRoutes: RouteObject[] = [
  defineRoute(
    'scripts',
    () => import('@/features/scripts/ScriptsListPage.js').then((m) => ({ default: m.ScriptsListPage })),
    { legacyHeader: false, nav: 'scripts', title: 'Scripts' },
  ),
  defineRoute(
    'scripts/:id',
    () => import('@/features/scripts/ScriptsListPage.js').then((m) => ({ default: m.ScriptsListPage })),
    { legacyHeader: false, nav: 'scripts', title: 'Script' },
  ),
];
