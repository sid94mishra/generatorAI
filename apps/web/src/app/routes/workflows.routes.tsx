// docs/redesign/07-phases.md §P1-S3. The Workflows list, the definition page
// and New workflow are on the kit (PW-a: `features/workflows`, own PageHeader);
// the builder and run pages still wear `legacyHeader: true` until their ports
// land; the builder routes force the rail (06 §2.5).
import type { RouteObject } from 'react-router';
import { defineRoute } from './defineRoute.js';

export const workflowsRoutes: RouteObject[] = [
  defineRoute(
    'workflows',
    () => import('@/features/workflows/list/WorkflowsListPage.js').then((m) => ({ default: m.WorkflowsListPage })),
    { legacyHeader: false, nav: 'workflows', title: 'Workflows' },
  ),
  defineRoute(
    'workflows/new',
    () => import('@/features/workflows/create/WorkflowNewPage.js').then((m) => ({ default: m.WorkflowNewPage })),
    { legacyHeader: false, nav: 'workflows', title: 'New workflow' },
  ),
  defineRoute(
    'workflows/:id',
    () => import('@/features/workflows/detail/WorkflowDetailPage.js').then((m) => ({ default: m.WorkflowDetailPage })),
    { legacyHeader: false, nav: 'workflows', title: 'Workflow' },
  ),
  defineRoute(
    'workflows/:id/edit',
    () => import('@/pages/WorkflowBuilderPage.js').then((m) => ({ default: m.WorkflowBuilderPage })),
    { legacyHeader: true, forceRail: true, nav: 'workflows', title: 'Workflow Builder' },
  ),
  defineRoute(
    'workflows/:id/runs/:runId',
    // PW-c: the run workspace on T-04 renders its own RunHeader and the kit
    // dock. A stage transcript draws the workflow cards too (D-35 segment-card
    // registry).
    () =>
      Promise.all([
        import('@/app/registries/workflowTranscriptCards.js'),
        import('@/features/workflows/run/WorkflowRunPage.js'),
      ]).then(([, m]) => ({ default: m.WorkflowRunPage })),
    { legacyHeader: false, nav: 'workflows', title: 'Workflow Run' },
  ),
];
