// docs/redesign/07-phases.md §P1-S3. Ported in P5 (P5-07 list; the editor
// follows in P5-08 on the legacy AgentEditorPage until then).
import type { RouteObject } from 'react-router';
import { defineRoute } from './defineRoute.js';

export const agentsRoutes: RouteObject[] = [
  defineRoute(
    'agents',
    () => import('@/features/agents/AgentsListPage.js').then((m) => ({ default: m.AgentsListPage })),
    // P5-07: renders its own PageHeader (T-01 grid); RouteSlot's LegacyHeader
    // (P3-04) honours the flag.
    { legacyHeader: false, nav: 'agents', title: 'Agents' },
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
