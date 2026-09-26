// Tasks-panel section registrations (03 §1.5, F-dock-06, D-35). Loaded by the
// chat route (app/routes/chats.routes.tsx) alongside the page. The Workflow
// Overhaul (P06) adds "Workflow runs from this chat" and "Drafts" here — the
// contract is in features/chat/dock/tasks/tasksSections.ts.

import { BackgroundTasksSection, registerTasksSection, useBackgroundTasksCount } from '@/features/chat/index.js';
import { ChatWorkflowRunsSection, useChatWorkflowRunsCount } from '@/components/chat/WorkflowRunCards.js';

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

// Workflow Overhaul P06 WP-6.2: the runs this chat started through its
// workflow tools (the legacy BackgroundTasksPanel's "Workflow runs" list).
registerTasksSection(
  {
    id: 'workflow-runs',
    title: 'Workflow runs from this chat',
    order: 200,
    useCount: useChatWorkflowRunsCount,
    render: (ctx) => <ChatWorkflowRunsSection chatId={ctx.chatId} stacked={ctx.stacked} />,
  },
  { replace: Boolean(import.meta.hot) },
);
