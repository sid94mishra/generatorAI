// Tasks-panel section registrations (03 §1.5, F-dock-06, D-35). Loaded by the
// chat route (app/routes/chats.routes.tsx) alongside the page. The Workflow
// Overhaul (P06) adds "Workflow runs from this chat" and "Drafts" here — the
// contract is in features/chat/dock/tasks/tasksSections.ts.

import { BackgroundTasksSection, registerTasksSection, useBackgroundTasksCount } from '@/features/chat/index.js';

registerTasksSection(
  {
    id: 'background-agents',
    title: 'Background tasks',
    order: 100,
    useCount: useBackgroundTasksCount,
    render: (ctx) => <BackgroundTasksSection {...ctx} />,
  },
  // A hot reload re-runs this file (the route loads it with a new URL).
  { replace: Boolean(import.meta.hot) },
);
