// ────────────────────────────────────────────────────────────────
// Router — React Router DOM route configuration
// ────────────────────────────────────────────────────────────────

import React, { Suspense, lazy } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout.js';
import { ErrorBoundary } from '@/components/ErrorBoundary.js';
import { PageErrorBoundary } from '@/components/PageErrorBoundary.js';
import { Spinner } from '@/components/ui/index.js';
/** Wrap a lazy page in both a Suspense fallback AND a page-scoped error
 *  boundary. A render-time throw inside the page no longer crashes the
 *  surrounding shell (sidebar / nav stay interactive). */
function withBoundary(pageName: string, element: React.ReactElement) {
  return (
    <PageErrorBoundary pageName={pageName}>
      <Suspense fallback={<PageLoader />}>{element}</Suspense>
    </PageErrorBoundary>
  );
}

// Lazy-loaded route pages for code splitting
const DashboardPage = lazy(() => import('@/pages/DashboardPage.js').then((m) => ({ default: m.DashboardPage })));
const ChatsListPage = lazy(() => import('@/pages/ChatsListPage.js').then((m) => ({ default: m.ChatsListPage })));
const ChatPage = lazy(() => import('@/pages/ChatPage.js').then((m) => ({ default: m.ChatPage })));
const SettingsRoute = lazy(() => import('@/pages/SettingsRoute.js').then((m) => ({ default: m.SettingsRoute })));
const WorkflowListPage = lazy(() => import('@/pages/WorkflowListPage.js').then((m) => ({ default: m.WorkflowListPage })));
const WorkflowDefinitionPage = lazy(() => import('@/pages/WorkflowDefinitionPage.js').then((m) => ({ default: m.WorkflowDefinitionPage })));
const WorkflowBuilderPage = lazy(() => import('@/pages/WorkflowBuilderPage.js').then((m) => ({ default: m.WorkflowBuilderPage })));
const WorkflowRunPageV2 = lazy(() => import('@/pages/WorkflowRunPageV2.js').then((m) => ({ default: m.WorkflowRunPageV2 })));
const AutomationsPage = lazy(() => import('@/pages/AutomationsPage.js').then((m) => ({ default: m.AutomationsPage })));
const AutomationDetailPage = lazy(() => import('@/pages/AutomationDetailPage.js').then((m) => ({ default: m.AutomationDetailPage })));
const CreateAutomationPage = lazy(() => import('@/pages/CreateAutomationPage.js').then((m) => ({ default: m.CreateAutomationPage })));
const ProjectsListPage = lazy(() => import('@/pages/ProjectsListPage.js').then((m) => ({ default: m.ProjectsListPage })));
const CreateProjectPage = lazy(() => import('@/pages/CreateProjectPage.js').then((m) => ({ default: m.CreateProjectPage })));
const ProjectDetailPage = lazy(() => import('@/pages/ProjectDetailPage.js').then((m) => ({ default: m.ProjectDetailPage })));
const CodebaseDetailPage = lazy(() => import('@/pages/CodebaseDetailPage.js').then((m) => ({ default: m.CodebaseDetailPage })));
const ScriptsListPage = lazy(() => import('@/pages/ScriptsListPage.js').then((m) => ({ default: m.ScriptsListPage })));
const ScriptDetailPage = lazy(() => import('@/pages/ScriptDetailPage.js').then((m) => ({ default: m.ScriptDetailPage })));
const AgentsListPage = lazy(() => import('@/pages/AgentsListPage.js').then((m) => ({ default: m.AgentsListPage })));
const AgentEditorPage = lazy(() => import('@/pages/AgentEditorPage.js').then((m) => ({ default: m.AgentEditorPage })));

function PageLoader() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner size="lg" className="h-6 w-6 text-[var(--color-muted-foreground)]" />
    </div>
  );
}


export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    errorElement: (
      <ErrorBoundary>
        <div className="flex h-screen flex-col items-center justify-center gap-2">
          <h2 className="text-lg font-semibold">Something went wrong</h2>
          <a href="/" className="text-sm text-blue-500 underline">Go Home</a>
        </div>
      </ErrorBoundary>
    ),
    children: [
      { index: true, element: withBoundary('Dashboard', <DashboardPage />) },
      { path: 'chats', element: withBoundary('Chats', <ChatsListPage />) },
      { path: 'chats/:id', element: withBoundary('Chat', <ChatPage />) },
      { path: 'agents', element: withBoundary('Agents', <AgentsListPage />) },
      { path: 'agents/new', element: withBoundary('New Agent', <AgentEditorPage />) },
      { path: 'agents/:id', element: withBoundary('Agent', <AgentEditorPage />) },
      { path: 'settings', element: withBoundary('Settings', <SettingsRoute />) },
      { path: 'workflows', element: withBoundary('Workflows', <WorkflowListPage />) },
      { path: 'workflows/new', element: withBoundary('Workflow Builder', <WorkflowBuilderPage />) },
      { path: 'workflows/:id', element: withBoundary('Workflow', <WorkflowDefinitionPage />) },
      { path: 'workflows/:id/edit', element: withBoundary('Workflow Builder', <WorkflowBuilderPage />) },
      { path: 'workflows/:id/runs/:runId', element: withBoundary('Workflow Run', <WorkflowRunPageV2 />) },
      { path: 'automations', element: withBoundary('Automations', <AutomationsPage />) },
      { path: 'automations/new', element: withBoundary('Create Automation', <CreateAutomationPage />) },
      { path: 'automations/:id', element: withBoundary('Automation', <AutomationDetailPage />) },
      { path: 'projects', element: withBoundary('Projects', <ProjectsListPage />) },
      { path: 'projects/new', element: withBoundary('Create Project', <CreateProjectPage />) },
      { path: 'projects/:id', element: withBoundary('Project', <ProjectDetailPage />) },
      { path: 'projects/:id/codebases/:cid', element: withBoundary('Codebase', <CodebaseDetailPage />) },
      { path: 'scripts', element: withBoundary('Scripts', <ScriptsListPage />) },
      { path: 'scripts/:id', element: withBoundary('Script', <ScriptDetailPage />) },
      {
        path: '*',
        element: (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <h2 className="text-lg font-semibold text-[var(--color-foreground)]">404</h2>
            <p className="text-sm text-[var(--color-muted-foreground)]">Page not found</p>
          </div>
        ),
      },
    ],
  },
]);
