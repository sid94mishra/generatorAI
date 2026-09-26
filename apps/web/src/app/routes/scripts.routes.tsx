// docs/redesign/07-phases.md §P1-S3. Workflow-owned pages (D-35); this
// module only wraps them with `legacyHeader: true` until PW ports them
// (docs/redesign/04-screen-map.md §0). Logged in docs/redesign/COORDINATION.md
// as a whole-repo mechanical change (07-phases.md §Running in parallel).
import type { RouteObject } from 'react-router';
import { defineRoute } from './defineRoute.js';

export const scriptsRoutes: RouteObject[] = [
  defineRoute(
    'scripts',
    () => import('@/pages/ScriptsListPage.js').then((m) => ({ default: m.ScriptsListPage })),
    { legacyHeader: true, nav: 'scripts', title: 'Scripts' },
  ),
  defineRoute(
    'scripts/:id',
    () => import('@/pages/ScriptDetailPage.js').then((m) => ({ default: m.ScriptDetailPage })),
    { legacyHeader: true, nav: 'scripts', title: 'Script' },
  ),
];
