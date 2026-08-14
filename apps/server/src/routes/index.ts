// ────────────────────────────────────────────────────────────────
// API Router — mounts all sub-routers under /api
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import type { Container } from '../composition-root.js';
import { createTemplateRoutes } from './templates.js';
import { createWebhookRoutes } from './webhooks.js';
import { createHealthRoutes } from './health.js';
import { createAuthRoutes } from './auth.js';
import { createSecurityRoutes } from './security.js';
import { createCopilotRoutes } from './copilot.js';
import { createHooksRoutes } from './hooks.js';
// Phase 4 streaming — unified /api/stream endpoint (STR-03). Replaces the
// legacy `/events/global` and `/events/stream` multiplexed routes
// (deleted in CLN-12).
import { createUnifiedStreamRoutes } from './stream.js';
// v2 route imports
import { createChatApiRoutes } from './chats.js';
import { createAgentApiRoutes } from './agents.js';
import { createWorkflowDefinitionRoutes } from './workflowDefinitions.js';
import { createWorkflowRunRoutes } from './workflowRuns.js';
import { createOrchestratorRoutes } from './orchestrator.js';
import { createAutomationRoutes } from './automations.js';
import { createSessionRoutes } from './sessions.js';
import { createOpenApiRoutes } from './openapi.js';
import { createProjectRoutes } from './projects.js';
import { createSystemRoutes } from './system.js';
import { createWorkspaceRoutes } from './workspaces.js';
import { createReviewRoutes } from './review.js';
import { createHarnessRoutes } from './harness.js';
import { createSourceControlRoutes } from './sourceControl.js';
import { createWorkflowScriptRoutes } from './workflowScripts.js';
import { createBrowserRoutes } from './browser.js';
import { createComputerRoutes } from './computer.js';
import { createTerminalRoutes } from './terminals.js';

// Widgets & Extensions
import { createExtensionRoutes, createWidgetAssetRoutes } from './extensions.js';
import { createWidgetRoutes } from './widgets.js';

/**
 * Creates the API router with all sub-routers mounted.
 * All routes are under /api (set by the app factory).
 */
export function createApiRouter(container: Container): Router {
  const router = Router();

  // ── v2 Routes ──

  // Chat management (v2) — first-class top-level entity
  router.use('/chats', createChatApiRoutes(container));

  // Agents — first-class agent definitions (CRUD, import/export, preview)
  router.use('/agents', createAgentApiRoutes(container));

  // Workflow definitions (v2) — CRUD + stages + edges
  router.use('/workflow-definitions', createWorkflowDefinitionRoutes(container));

  // Workflow runs (v2) — run lifecycle + stage controls + SSE
  router.use('/workflow-runs', createWorkflowRunRoutes(container));

  // Orchestrator (v2) — system workflows + orchestrated runs
  router.use('/orchestrator', createOrchestratorRoutes(container));

  // Projects — CRUD + codebases + configs + worktrees
  router.use('/projects', createProjectRoutes(container));

  // System — system-level artifacts (skills, prompts, agents)
  router.use('/system', createSystemRoutes(container));

  // Automations — CRUD + triggers + executions
  router.use('/automations', createAutomationRoutes(container));

  // Workspaces — workspace management + worktrees
  router.use('/workspaces', createWorkspaceRoutes(container));
  // Review threads annotate a workspace's files, so they nest under it.
  router.use('/workspaces/:id/review', createReviewRoutes(container));

  // Source Control — provider selection (GitHub) + PR config
  router.use('/source-control', createSourceControlRoutes(container));

  // Integrated Browser (v13) — nested under workspaces so a browser session
  // is scoped to its owning workspace/chat/run/automation-iteration.
  router.use('/workspaces/:id/browser', createBrowserRoutes(container));

  // Computer Use — read-only: window frames + audit for the preview panel.
  router.use('/workspaces/:id/computer', createComputerRoutes(container));

  // Integrated Terminal — nested under workspaces, mirrors the browser
  // topology. Live IO is served via the WebSocket registered in
  // apps/server/src/terminal-ws.ts.
  router.use('/workspaces/:id/terminals', createTerminalRoutes(container));

  // Sessions — message history by Copilot session ID (used by WorkflowMessages)
  router.use('/sessions', createSessionRoutes(container));

  // Templates (2 endpoints)
  router.use('/templates', createTemplateRoutes(container));

  // Webhooks (5 endpoints)
  router.use('/webhooks', createWebhookRoutes(container));

  // Health check and config (2 endpoints)
  router.use('/health', createHealthRoutes(container));

  // Device pairing, sessions, device administration, security audit.
  router.use('/auth', createAuthRoutes(container));

  // Security posture + secret-backend diagnostics.
  router.use('/security', createSecurityRoutes(container));

  // Copilot SDK routes — models, state, conversations, ping (5 endpoints)
  router.use('/copilot', createCopilotRoutes(container));

  // Hooks — phases, session hooks, test (3 endpoints)
  router.use('/hooks', createHooksRoutes(container));

  // Harness — runtime AI provider switching (PRV-02)
  router.use('/harness', createHarnessRoutes(container));

  // Workflow Scripts — programmatic workflow creation via .workflow.mjs
  router.use('/workflow-scripts', createWorkflowScriptRoutes(container));

  // Widgets & Extensions — agent-rendered UI + extension management
  router.use('/extensions', createExtensionRoutes(container));
  router.use('/widgets', createWidgetRoutes(container));
  router.use('/widget-assets', createWidgetAssetRoutes(container));

  // DOC-01 — OpenAPI spec + Swagger UI. Mounted BEFORE the 404
  // catch-all; exposes `/api/openapi.json` and `/api/docs`.
  router.use('/', createOpenApiRoutes());

  // Phase 4 streaming — unified SSE endpoint.
  // `/api/stream?scope=<s>&id=<id>` covers session / run / chat / global.
  // `/api/stream/replay` is the REST replay companion for Last-Event-ID.
  if (container.config.streaming.enabled) {
    router.use('/stream', createUnifiedStreamRoutes(container));
  }

  // 404 catch-all for unknown API routes
  router.use((_req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'API endpoint not found' },
    });
  });

  return router;
}
