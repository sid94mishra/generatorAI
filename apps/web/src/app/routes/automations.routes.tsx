// docs/redesign/07-phases.md §P1-S3. Ported onto the kit (PW-d, 2026-09-27):
// the Workflow Overhaul (D-81) built these functional-only on legacy
// components; the redesign now rebuilds them on `ui/` + `blocks/` (D-35
// fallback port).
import type { RouteObject } from 'react-router';
import { defineRoute } from './defineRoute.js';

export const automationsRoutes: RouteObject[] = [
  defineRoute(
    'automations',
    () => import('@/features/automations/AutomationsListPage.js').then((m) => ({ default: m.AutomationsListPage })),
    { legacyHeader: false, nav: 'automations', title: 'Automations' },
  ),
  defineRoute(
    'automations/new',
    () => import('@/features/automations/CreateAutomationPage.js').then((m) => ({ default: m.CreateAutomationPage })),
    { legacyHeader: false, nav: 'automations', title: 'Create automation' },
  ),
  defineRoute(
    'automations/:id',
    () => import('@/features/automations/AutomationDetailPage.js').then((m) => ({ default: m.AutomationDetailPage })),
    { legacyHeader: false, nav: 'automations', title: 'Automation' },
  ),
];
