// docs/redesign/07-phases.md §P1-S3. Workflow-owned pages (D-35); this
// module only wraps them with `legacyHeader: true` until PW ports them
// (docs/redesign/04-screen-map.md §0). Logged in docs/redesign/COORDINATION.md
// as a whole-repo mechanical change (07-phases.md §Running in parallel).
import type { RouteObject } from 'react-router';
import { defineRoute } from './defineRoute.js';

export const automationsRoutes: RouteObject[] = [
  defineRoute(
    'automations',
    () => import('@/pages/AutomationsPage.js').then((m) => ({ default: m.AutomationsPage })),
    { legacyHeader: true, nav: 'automations', title: 'Automations' },
  ),
  defineRoute(
    'automations/new',
    () => import('@/pages/CreateAutomationPage.js').then((m) => ({ default: m.CreateAutomationPage })),
    { legacyHeader: true, nav: 'automations', title: 'Create Automation' },
  ),
  defineRoute(
    'automations/:id',
    () => import('@/pages/AutomationDetailPage.js').then((m) => ({ default: m.AutomationDetailPage })),
    { legacyHeader: true, nav: 'automations', title: 'Automation' },
  ),
];
