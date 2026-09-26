// docs/redesign/07-phases.md §P1-S3. Workflow-owned pages (D-35); this
// module only wraps them with `legacyHeader: true` until PW ports them
// (docs/redesign/04-screen-map.md §0); the builder routes force the rail
// (06 §2.5). Logged in docs/redesign/COORDINATION.md
// as a whole-repo mechanical change (07-phases.md §Running in parallel).
import type { RouteObject } from 'react-router';
import { defineRoute } from './defineRoute.js';

export const workflowsRoutes: RouteObject[] = [
  defineRoute(
    'workflows',
    () => import('@/pages/WorkflowListPage.js').then((m) => ({ default: m.WorkflowListPage })),
    { legacyHeader: true, nav: 'workflows', title: 'Workflows' },
  ),
  defineRoute(
    'workflows/new',
    () => import('@/pages/WorkflowBuilderPage.js').then((m) => ({ default: m.WorkflowBuilderPage })),
    { legacyHeader: true, forceRail: true, nav: 'workflows', title: 'Workflow Builder' },
  ),
  defineRoute(
    'workflows/:id',
    () => import('@/pages/WorkflowDefinitionPage.js').then((m) => ({ default: m.WorkflowDefinitionPage })),
    { legacyHeader: true, nav: 'workflows', title: 'Workflow' },
  ),
  defineRoute(
    'workflows/:id/edit',
    () => import('@/pages/WorkflowBuilderPage.js').then((m) => ({ default: m.WorkflowBuilderPage })),
    { legacyHeader: true, forceRail: true, nav: 'workflows', title: 'Workflow Builder' },
  ),
  defineRoute(
    'workflows/:id/runs/:runId',
    () => import('@/pages/WorkflowRunPageV2.js').then((m) => ({ default: m.WorkflowRunPageV2 })),
    { legacyHeader: true, nav: 'workflows', title: 'Workflow Run' },
  ),
];
