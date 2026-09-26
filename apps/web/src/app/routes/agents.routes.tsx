// docs/redesign/07-phases.md §P1-S3. Ported in P5 (P5-07 list, P5-08 editor).
import type { RouteObject } from 'react-router';
import { defineRoute } from './defineRoute.js';

export const agentsRoutes: RouteObject[] = [
  defineRoute(
    'agents',
    () => import('@/features/agents/AgentsListPage.js').then((m) => ({ default: m.AgentsListPage })),
    // P5-07: renders its own PageHeader (T-01 grid).
    { nav: 'agents', title: 'Agents' },
  ),
  defineRoute(
    'agents/new',
    () => import('@/features/agents/AgentEditorPage.js').then((m) => ({ default: m.AgentEditorPage })),
    { nav: 'agents', title: 'New agent' },
  ),
  defineRoute(
    'agents/:id',
    () => import('@/features/agents/AgentEditorPage.js').then((m) => ({ default: m.AgentEditorPage })),
    { nav: 'agents', title: 'Agent' },
  ),
];
