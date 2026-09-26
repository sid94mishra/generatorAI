// docs/redesign/07-phases.md §P1-S3. Ported in P5.
import type { RouteObject } from 'react-router';
import { defineRoute } from './defineRoute.js';

export const agentsRoutes: RouteObject[] = [
  defineRoute(
    'agents',
    () => import('@/pages/AgentsListPage.js').then((m) => ({ default: m.AgentsListPage })),
    { legacyHeader: true, nav: 'agents', title: 'Agents' },
  ),
  defineRoute(
    'agents/new',
    () => import('@/pages/AgentEditorPage.js').then((m) => ({ default: m.AgentEditorPage })),
    { legacyHeader: true, nav: 'agents', title: 'New Agent' },
  ),
  defineRoute(
    'agents/:id',
    () => import('@/pages/AgentEditorPage.js').then((m) => ({ default: m.AgentEditorPage })),
    { legacyHeader: true, nav: 'agents', title: 'Agent' },
  ),
];
