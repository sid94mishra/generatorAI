// ────────────────────────────────────────────────────────────────
// The administrative / write half of the API.
//
// `client.ts` covers what a phone needs: read the world, send a message,
// approve a gate. This file covers what an operator needs: create and mutate
// definitions, drive runs, manage projects and codebases, and reach the
// feature areas (extensions, widgets, browser, computer use, webhooks,
// hooks, scripts, orchestrator) that no client previously exposed.
//
// It lives in client-core rather than in the CLI because the CLI is the
// third client to need most of it, and the first two each grew their own
// copy. Web and mobile can adopt these methods without a second
// implementation.
//
// Paths here were transcribed from `apps/server/src/routes/*.ts` directly.
// When a route moves, this file is the thing to update.
// ────────────────────────────────────────────────────────────────

import type {
  Agent,
  AgentOverrides,
  Automation,
  AutomationExecution,
  CreateAgentParams,
  CreateAutomationParams,
  CreateEdgeParams,
  CreateStageParams,
  McpServerEntry,
  Project,
  ProjectCodebase,
  ProjectConfig,
  StageDefinition,
  StageEdge,
  StageRun,
  UpdateAgentParams,
  UpdateAutomationParams,
  WorkflowDefinition,
  WorktreeInfo,
} from '@generatorai/shared';
import { json, jsonWith, qs, request, type ApiFetch } from './client.js';

/** A workflow run as the run routes serialise it. */
export interface RunSummary {
  id: string;
  workflowDefinitionId: string;
  name?: string;
  status: string;
  createdAt: string | number;
  startedAt?: string | number | null;
  completedAt?: string | number | null;
  error?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
  variables?: Record<string, unknown>;
}

export interface WorkspaceRecord {
  id: string;
  ownerType: string;
  ownerId: string;
  status: string;
  rootPath: string;
  projectId?: string | null;
  createdAt: string | number;
  sizeBytes?: number;
}

export interface FileEntryRecord {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: string | number;
}

export interface ScriptSummary {
  id: string;
  name: string;
  description?: string;
  path?: string;
  profiles?: string[];
}

export interface ExtensionSummary {
  id: string;
  name: string;
  version?: string;
  scope?: string;
  enabled: boolean;
  contributes?: Record<string, unknown>;
}

export interface WidgetSummary {
  id: string;
  extensionId?: string;
  title?: string;
  surface?: string;
  status?: string;
  state?: Record<string, unknown>;
}

export interface HookPhaseInfo {
  phase: string;
  category?: string;
  description?: string;
}

export interface DeviceRecord {
  deviceId: string;
  name: string;
  platform: string;
  scopes: string[];
  createdAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
  credentialVersion: number;
  jwkThumbprint: string;
}

export interface TerminalRecord {
  id: string;
  workspaceId: string;
  cols: number;
  rows: number;
  cwd?: string;
  shell?: string;
  createdAt?: string | number;
}

/**
 * Builds the admin half of the API surface.
 *
 * Grouped by server route module so a reader can hold one file open beside
 * one namespace and check them off.
 */
export function createAdminApi(fetchImpl: ApiFetch) {
  const req = <T>(path: string, init?: RequestInit) => request<T>(fetchImpl, path, init);

  return {
    // ── workflowDefinitions.ts ──────────────────────────────────
    definitions: {
      list: (projectId?: string) =>
        req<WorkflowDefinition[]>(`/api/workflow-definitions${qs({ projectId })}`),

      get: (id: string) =>
        req<WorkflowDefinition & { stages: StageDefinition[]; edges: StageEdge[] }>(
          `/api/workflow-definitions/${id}`,
        ),

      create: (body: Record<string, unknown>) =>
        req<WorkflowDefinition>('/api/workflow-definitions', json(body)),

      update: (id: string, body: Record<string, unknown>) =>
        req<WorkflowDefinition>(`/api/workflow-definitions/${id}`, jsonWith('PATCH', body)),

      remove: (id: string) =>
        req<void>(`/api/workflow-definitions/${id}`, { method: 'DELETE' }),

      validate: (id: string) =>
        req<{ valid: boolean; errors?: string[]; warnings?: string[] }>(
          `/api/workflow-definitions/${id}/validate`,
          json({}),
        ),

      /** Instantiate a system template by id. */
      importTemplate: (templateId: string, name?: string) =>
        req<WorkflowDefinition>(
          '/api/workflow-definitions/import',
          json({ templateId, ...(name ? { name } : {}) }),
        ),

      importJson: (body: unknown) =>
        req<WorkflowDefinition & { stages: StageDefinition[] }>(
          '/api/workflow-definitions/import-json',
          json(body),
        ),

      export: (id: string) =>
        req<Record<string, unknown>>(`/api/workflow-definitions/${id}/export`),

      addStage: (id: string, body: Omit<CreateStageParams, 'workflowDefinitionId'>) =>
        req<StageDefinition>(`/api/workflow-definitions/${id}/stages`, json(body)),

      updateStage: (id: string, stageId: string, body: Record<string, unknown>) =>
        req<StageDefinition>(
          `/api/workflow-definitions/${id}/stages/${stageId}`,
          jsonWith('PUT', body),
        ),

      deleteStage: (id: string, stageId: string) =>
        req<void>(`/api/workflow-definitions/${id}/stages/${stageId}`, { method: 'DELETE' }),

      addEdge: (id: string, body: Omit<CreateEdgeParams, 'workflowDefinitionId'>) =>
        req<StageEdge>(`/api/workflow-definitions/${id}/edges`, json(body)),

      deleteEdge: (id: string, edgeId: string) =>
        req<void>(`/api/workflow-definitions/${id}/edges/${edgeId}`, { method: 'DELETE' }),
    },

    // ── workflowRuns.ts ─────────────────────────────────────────
    runs: {
      list: (params?: { definitionId?: string; status?: string; limit?: number }) =>
        req<RunSummary[]>(`/api/workflow-runs${qs({ ...params })}`),

      get: (id: string) => req<RunSummary>(`/api/workflow-runs/${id}`),

      /**
       * Creates a run in `pending`. It does NOT begin executing — the server
       * models creation and start as two steps so variables can be validated
       * and a profile applied before any stage is scheduled. Callers that
       * want "run it now" must follow with `start`.
       */
      create: (body: Record<string, unknown>) =>
        req<RunSummary>('/api/workflow-runs', json(body)),

      start: (id: string) => req<RunSummary>(`/api/workflow-runs/${id}/start`, json({})),
      pause: (id: string) => req<RunSummary>(`/api/workflow-runs/${id}/pause`, json({})),
      resume: (id: string) => req<RunSummary>(`/api/workflow-runs/${id}/resume`, json({})),
      retry: (id: string) => req<RunSummary>(`/api/workflow-runs/${id}/retry`, json({})),
      cancel: (id: string) => req<RunSummary>(`/api/workflow-runs/${id}/cancel`, json({})),
      remove: (id: string) => req<void>(`/api/workflow-runs/${id}`, { method: 'DELETE' }),

      stages: (id: string) => req<StageRun[]>(`/api/workflow-runs/${id}/stages`),
      scratchpad: (id: string) =>
        req<Record<string, unknown>>(`/api/workflow-runs/${id}/scratchpad`),

      stage: {
        pause: (runId: string, stageId: string) =>
          req<void>(`/api/workflow-runs/${runId}/stages/${stageId}/pause`, json({})),
        resume: (runId: string, stageId: string) =>
          req<void>(`/api/workflow-runs/${runId}/stages/${stageId}/resume`, json({})),
        retry: (runId: string, stageId: string) =>
          req<void>(`/api/workflow-runs/${runId}/stages/${stageId}/retry`, json({})),
        cancel: (runId: string, stageId: string) =>
          req<void>(`/api/workflow-runs/${runId}/stages/${stageId}/cancel`, json({})),
        interrupt: (runId: string, stageId: string, body: Record<string, unknown>) =>
          req<Record<string, unknown>>(
            `/api/workflow-runs/${runId}/stages/${stageId}/interrupt`,
            json(body),
          ),
        approve: (runId: string, stageId: string, body: Record<string, unknown>) =>
          req<Record<string, unknown>>(
            `/api/workflow-runs/${runId}/stages/${stageId}/approve`,
            json(body),
          ),
      },

      permissionMode: {
        get: (id: string) =>
          req<{ mode: string }>(`/api/workflow-runs/${id}/permission-mode`),
        set: (id: string, mode: string) =>
          req<{ mode: string }>(
            `/api/workflow-runs/${id}/permission-mode`,
            // The route reads `req.body.mode`, not `permissionMode`.
            jsonWith('PATCH', { mode }),
          ),
      },

      pendingInterrupts: (id: string) =>
        req<Array<Record<string, unknown>>>(`/api/workflow-runs/${id}/pending-interrupts`),
    },

    // ── automations.ts ──────────────────────────────────────────
    automations: {
      list: (projectId?: string) => req<Automation[]>(`/api/automations${qs({ projectId })}`),
      get: (id: string) => req<Record<string, unknown>>(`/api/automations/${id}`),
      create: (body: CreateAutomationParams) => req<Automation>('/api/automations', json(body)),
      update: (id: string, body: UpdateAutomationParams) =>
        req<Automation>(`/api/automations/${id}`, jsonWith('PATCH', body)),
      remove: (id: string) => req<void>(`/api/automations/${id}`, { method: 'DELETE' }),
      enable: (id: string) => req<Automation>(`/api/automations/${id}/enable`, json({})),
      disable: (id: string) => req<Automation>(`/api/automations/${id}/disable`, json({})),
      rotateWebhookToken: (id: string) =>
        req<{ token: string }>(`/api/automations/${id}/rotate-webhook-token`, json({})),
      testDataSource: (config: Record<string, unknown>) =>
        req<Record<string, unknown>>('/api/automations/test-data-source', json(config)),
      executions: (id: string) =>
        req<AutomationExecution[]>(`/api/automations/${id}/executions`),
      execution: (id: string, execId: string) =>
        req<Record<string, unknown>>(`/api/automations/${id}/executions/${execId}`),
      cancelExecution: (id: string, execId: string) =>
        req<void>(`/api/automations/${id}/executions/${execId}/cancel`, json({})),
      /**
       * Manual trigger.
       *
       * The authenticated route, which validates the dataset, honours
       * `Idempotency-Key` and works for `manual` and `schedule` automations
       * that have no webhook token at all.
       */
      trigger: (
        id: string,
        body?: { dataset?: unknown; saveAsDefault?: boolean },
        opts?: { idempotencyKey?: string },
      ) =>
        req<AutomationExecution>(`/api/automations/${id}/trigger`, {
          ...json(body ?? {}),
          ...(opts?.idempotencyKey
            ? {
                headers: {
                  'content-type': 'application/json',
                  'idempotency-key': opts.idempotencyKey,
                },
              }
            : {}),
        }),
      /**
       * Fires the public webhook route directly.
       *
       * Deliberately separate from {@link trigger}: this path is
       * unauthenticated by design, skips dataset validation and skips
       * idempotency, so it must be an explicit choice rather than a fallback.
       */
      triggerByToken: (token: string, body?: Record<string, unknown>) =>
        req<AutomationExecution>(`/api/automations/webhooks/${token}`, json(body ?? {})),
    },

    // ── projects.ts ─────────────────────────────────────────────
    projects: {
      list: () => req<Project[]>('/api/projects'),
      get: (id: string) => req<Project>(`/api/projects/${id}`),
      create: (body: Record<string, unknown>) => req<Project>('/api/projects', json(body)),
      update: (id: string, body: Record<string, unknown>) =>
        req<Project>(`/api/projects/${id}`, jsonWith('PUT', body)),
      remove: (id: string, force?: boolean) =>
        req<void>(`/api/projects/${id}${qs({ force })}`, { method: 'DELETE' }),

      availableArtifacts: (id: string, type?: string) =>
        req<Array<Record<string, unknown>>>(
          `/api/projects/${id}/available-artifacts${qs({ type })}`,
        ),

      codebases: {
        list: (projectId: string) =>
          req<ProjectCodebase[]>(`/api/projects/${projectId}/codebases`),
        link: (projectId: string, body: Record<string, unknown>) =>
          req<ProjectCodebase>(`/api/projects/${projectId}/codebases`, json(body)),
        update: (projectId: string, cid: string, body: Record<string, unknown>) =>
          req<ProjectCodebase>(
            `/api/projects/${projectId}/codebases/${cid}`,
            jsonWith('PUT', body),
          ),
        unlink: (projectId: string, cid: string) =>
          req<void>(`/api/projects/${projectId}/codebases/${cid}`, { method: 'DELETE' }),
        fetch: (projectId: string, cid: string) =>
          req<Record<string, unknown>>(
            `/api/projects/${projectId}/codebases/${cid}/fetch`,
            json({}),
          ),
        branches: (projectId: string, cid: string) =>
          req<string[]>(`/api/projects/${projectId}/codebases/${cid}/branches`),
        status: (projectId: string, cid: string) =>
          req<Record<string, unknown>>(`/api/projects/${projectId}/codebases/${cid}/status`),
        files: (projectId: string, cid: string, path?: string) =>
          req<FileEntryRecord[]>(
            `/api/projects/${projectId}/codebases/${cid}/files${qs({ path })}`,
          ),
        fileContent: (projectId: string, cid: string, path: string) =>
          req<{ content: string }>(
            `/api/projects/${projectId}/codebases/${cid}/files/content${qs({ path })}`,
          ),
        worktrees: (projectId: string, cid: string) =>
          req<WorktreeInfo[]>(`/api/projects/${projectId}/codebases/${cid}/worktrees`),
      },

      configs: {
        list: (projectId: string, type?: string) =>
          req<ProjectConfig[]>(`/api/projects/${projectId}/configs${qs({ type })}`),
        get: (projectId: string, cid: string) =>
          req<ProjectConfig>(`/api/projects/${projectId}/configs/${cid}`),
        create: (projectId: string, body: Record<string, unknown>) =>
          req<ProjectConfig>(`/api/projects/${projectId}/configs`, json(body)),
        update: (projectId: string, cid: string, body: Record<string, unknown>) =>
          req<ProjectConfig>(`/api/projects/${projectId}/configs/${cid}`, jsonWith('PUT', body)),
        remove: (projectId: string, cid: string) =>
          req<void>(`/api/projects/${projectId}/configs/${cid}`, { method: 'DELETE' }),
      },

      mcp: {
        list: (projectId: string) =>
          req<McpServerEntry[]>(`/api/projects/${projectId}/mcp-servers`),
        add: (projectId: string, body: Record<string, unknown>) =>
          req<McpServerEntry>(`/api/projects/${projectId}/mcp-servers`, json(body)),
        update: (projectId: string, mid: string, body: Record<string, unknown>) =>
          req<McpServerEntry>(
            `/api/projects/${projectId}/mcp-servers/${mid}`,
            jsonWith('PUT', body),
          ),
        remove: (projectId: string, mid: string) =>
          req<void>(`/api/projects/${projectId}/mcp-servers/${mid}`, { method: 'DELETE' }),
      },

      worktrees: {
        list: (projectId: string) => req<WorktreeInfo[]>(`/api/projects/${projectId}/worktrees`),
        remove: (projectId: string, wid: string) =>
          req<void>(`/api/projects/${projectId}/worktrees/${wid}`, { method: 'DELETE' }),
        cleanup: (projectId: string) =>
          req<Record<string, unknown>>(`/api/projects/${projectId}/worktrees/cleanup`, json({})),
      },
    },

    // ── workspaces.ts ───────────────────────────────────────────
    workspaces: {
      list: (params?: { projectId?: string; status?: string; limit?: number }) =>
        req<WorkspaceRecord[]>(`/api/workspaces${qs({ ...params })}`),
      get: (id: string) => req<WorkspaceRecord>(`/api/workspaces/${id}`),
      archive: (id: string) => req<WorkspaceRecord>(`/api/workspaces/${id}/archive`, json({})),
      commit: (id: string, message?: string) =>
        req<Record<string, unknown>>(`/api/workspaces/${id}/commit`, json({ message })),
      remove: (id: string) => req<void>(`/api/workspaces/${id}`, { method: 'DELETE' }),
      cleanup: (body?: { retentionHours?: number; maxDiskMb?: number }) =>
        req<Record<string, unknown>>('/api/workspaces/cleanup', json(body ?? {})),
      worktrees: (id: string) => req<WorktreeInfo[]>(`/api/workspaces/${id}/worktrees`),
      files: (id: string, path?: string) =>
        req<FileEntryRecord[]>(`/api/workspaces/${id}/files${qs({ path })}`),
      fileContent: (id: string, path: string) =>
        req<{ content: string }>(`/api/workspaces/${id}/files/content${qs({ path })}`),
      createCheckpoint: (id: string, body?: Record<string, unknown>) =>
        req<Record<string, unknown>>(`/api/workspaces/${id}/checkpoints`, json(body ?? {})),
      changesContent: (id: string, params: { path: string; side?: string; alias?: string }) =>
        req<{ content: string }>(`/api/workspaces/${id}/changes/content${qs({ ...params })}`),
      createPullRequest: (id: string, body: Record<string, unknown>) =>
        req<Record<string, unknown>>(`/api/workspaces/${id}/pull-request`, json(body)),
      pullRequests: (id: string) =>
        req<Array<Record<string, unknown>>>(`/api/workspaces/${id}/pull-requests`),
    },

    // ── terminals.ts ────────────────────────────────────────────
    terminals: {
      list: (workspaceId: string) =>
        req<TerminalRecord[]>(`/api/workspaces/${workspaceId}/terminals`),
      scrollback: (workspaceId: string, sid: string) =>
        req<{ data: string }>(`/api/workspaces/${workspaceId}/terminals/${sid}/scrollback`),
      resize: (workspaceId: string, sid: string, cols: number, rows: number) =>
        req<void>(
          `/api/workspaces/${workspaceId}/terminals/${sid}/resize`,
          json({ cols, rows }),
        ),
      signal: (workspaceId: string, sid: string, signal: string) =>
        req<void>(`/api/workspaces/${workspaceId}/terminals/${sid}/signal`, json({ signal })),
    },

    // ── browser.ts (all nested under a workspace) ───────────────
    browser: {
      start: (workspaceId: string, body?: Record<string, unknown>) =>
        req<Record<string, unknown>>(
          `/api/workspaces/${workspaceId}/browser/start`,
          json(body ?? {}),
        ),
      stop: (workspaceId: string) =>
        req<void>(`/api/workspaces/${workspaceId}/browser/stop`, json({})),
      descriptor: (workspaceId: string) =>
        req<Record<string, unknown>>(`/api/workspaces/${workspaceId}/browser/descriptor`),
      /** navigate / back / forward / reload / click / type are all `actions`. */
      actions: (workspaceId: string, body: Record<string, unknown>) =>
        req<Record<string, unknown>>(`/api/workspaces/${workspaceId}/browser/actions`, json(body)),
      capture: (workspaceId: string, body?: Record<string, unknown>) =>
        req<Record<string, unknown>>(
          `/api/workspaces/${workspaceId}/browser/capture`,
          json(body ?? {}),
        ),
      snapshots: (workspaceId: string) =>
        req<Array<Record<string, unknown>>>(`/api/workspaces/${workspaceId}/browser/snapshots`),
      selection: (workspaceId: string, body: Record<string, unknown>) =>
        req<Record<string, unknown>>(
          `/api/workspaces/${workspaceId}/browser/selection`,
          json(body),
        ),
      attach: (workspaceId: string, body?: Record<string, unknown>) =>
        req<Record<string, unknown>>(
          `/api/workspaces/${workspaceId}/browser/attach`,
          json(body ?? {}),
        ),
      detach: (workspaceId: string) =>
        req<void>(`/api/workspaces/${workspaceId}/browser/detach`, json({})),
      resize: (workspaceId: string, width: number, height: number) =>
        req<void>(`/api/workspaces/${workspaceId}/browser/resize`, json({ width, height })),
      scroll: (workspaceId: string) =>
        req<Record<string, unknown>>(`/api/workspaces/${workspaceId}/browser/scroll`),
      /** Absolute path of the single-frame JPEG endpoint, for image rendering. */
      screencastPath: (workspaceId: string) =>
        `/api/workspaces/${workspaceId}/browser/screencast.jpg`,
    },

    // ── computer.ts ─────────────────────────────────────────────
    computer: {
      consent: (workspaceId: string) =>
        req<Record<string, unknown>>(`/api/workspaces/${workspaceId}/computer/consent`),
      setConsent: (workspaceId: string, body: Record<string, unknown>) =>
        req<Record<string, unknown>>(
          `/api/workspaces/${workspaceId}/computer/consent`,
          json(body),
        ),
      grants: (workspaceId: string) =>
        req<Array<Record<string, unknown>>>(`/api/workspaces/${workspaceId}/computer/grants`),
      revokeGrant: (workspaceId: string, appIdentity: string) =>
        req<void>(
          `/api/workspaces/${workspaceId}/computer/grants/${encodeURIComponent(appIdentity)}`,
          { method: 'DELETE' },
        ),
      runtime: (workspaceId: string) =>
        req<Record<string, unknown>>(`/api/workspaces/${workspaceId}/computer/runtime`),
      setRuntime: (workspaceId: string, body: Record<string, unknown>) =>
        req<Record<string, unknown>>(
          `/api/workspaces/${workspaceId}/computer/runtime`,
          json(body),
        ),
      activity: (workspaceId: string) =>
        req<Array<Record<string, unknown>>>(`/api/workspaces/${workspaceId}/computer/activity`),
      frames: (workspaceId: string) =>
        req<Array<Record<string, unknown>>>(`/api/workspaces/${workspaceId}/computer/frames`),
      recordingTurns: (workspaceId: string) =>
        req<Array<Record<string, unknown>>>(
          `/api/workspaces/${workspaceId}/computer/recording/turns`,
        ),
      setRecording: (workspaceId: string, body: Record<string, unknown>) =>
        req<Record<string, unknown>>(
          `/api/workspaces/${workspaceId}/computer/recording`,
          json(body),
        ),
    },

    // ── extensions.ts ───────────────────────────────────────────
    extensions: {
      // The route answers `{ extensions: [...] }`, not a bare array.
      list: async () =>
        (await req<{ extensions: ExtensionSummary[] }>('/api/extensions')).extensions ?? [],
      get: (id: string) => req<ExtensionSummary>(`/api/extensions/${id}`),
      widgets: () => req<Array<Record<string, unknown>>>('/api/extensions/widgets'),
      install: (body: Record<string, unknown>) =>
        req<ExtensionSummary>('/api/extensions', json(body)),
      update: (id: string, body: Record<string, unknown>) =>
        req<ExtensionSummary>(`/api/extensions/${id}`, jsonWith('PATCH', body)),
      remove: (id: string) => req<void>(`/api/extensions/${id}`, { method: 'DELETE' }),
      reloadAll: () => req<Record<string, unknown>>('/api/extensions/reload', json({})),
      reload: (id: string) =>
        req<Record<string, unknown>>(`/api/extensions/${id}/reload`, json({})),
    },

    // ── widgets.ts ──────────────────────────────────────────────
    widgets: {
      // The route answers `{ instances, render }`; the list is `instances`.
      list: async () =>
        (await req<{ instances: WidgetSummary[] }>('/api/widgets')).instances ?? [],
      get: (id: string) => req<WidgetSummary>(`/api/widgets/${id}`),
      setState: (id: string, state: Record<string, unknown>) =>
        req<WidgetSummary>(`/api/widgets/${id}/state`, jsonWith('PATCH', state)),
      close: (id: string) => req<void>(`/api/widgets/${id}`, { method: 'DELETE' }),
    },

    // ── workflowScripts.ts ──────────────────────────────────────
    scripts: {
      list: () => req<ScriptSummary[]>('/api/workflow-scripts'),
      get: (id: string) => req<ScriptSummary>(`/api/workflow-scripts/${id}`),
      profiles: (id: string) =>
        req<Array<Record<string, unknown>>>(`/api/workflow-scripts/${id}/profiles`),
      materialize: (id: string, body?: Record<string, unknown>) =>
        req<WorkflowDefinition>(`/api/workflow-scripts/${id}/materialize`, json(body ?? {})),
      run: (id: string, body?: Record<string, unknown>) =>
        req<RunSummary>(`/api/workflow-scripts/${id}/run`, json(body ?? {})),
      validate: (body: Record<string, unknown>) =>
        req<{ valid: boolean; errors?: string[] }>('/api/workflow-scripts/validate', json(body)),
      reloadAll: () => req<Record<string, unknown>>('/api/workflow-scripts/reload', json({})),
      reload: (id: string) =>
        req<Record<string, unknown>>(`/api/workflow-scripts/${id}/reload`, json({})),
    },

    // ── orchestrator.ts ─────────────────────────────────────────
    orchestrator: {
      templates: () => req<Array<Record<string, unknown>>>('/api/orchestrator/system-workflows'),
      template: (id: string) =>
        req<Record<string, unknown>>(`/api/orchestrator/system-workflows/${id}`),
      fromTemplate: (body: Record<string, unknown>) =>
        req<WorkflowDefinition>('/api/orchestrator/from-template', json(body)),
      startRun: (body: Record<string, unknown>) =>
        req<Record<string, unknown>>('/api/orchestrator/runs', json(body)),
      context: (runId: string) =>
        req<Record<string, unknown>>(`/api/orchestrator/runs/${runId}/context`),
      cancel: (runId: string) =>
        req<void>(`/api/orchestrator/runs/${runId}/cancel`, json({})),
      runWorkspace: (runId: string) =>
        req<Record<string, unknown>>(`/api/orchestrator/runs/${runId}/workspace`),
      runWorkspaceContent: (runId: string, path: string, source?: string) =>
        req<{ content: string }>(
          `/api/orchestrator/runs/${runId}/workspace/content${qs({ path, source })}`,
        ),
      runDiff: (runId: string) =>
        req<{ diff: string } | string>(`/api/orchestrator/runs/${runId}/workspace/diff`),
      workflowFiles: (defId: string) =>
        req<FileEntryRecord[]>(`/api/orchestrator/workflows/${defId}/files`),
    },

    // ── templates.ts ────────────────────────────────────────────
    templates: {
      list: () => req<Array<Record<string, unknown>>>('/api/templates'),
      get: (id: string) => req<Record<string, unknown>>(`/api/templates/${id}`),
    },

    // ── webhooks.ts ─────────────────────────────────────────────
    webhooks: {
      list: () => req<Array<Record<string, unknown>>>('/api/webhooks/registrations'),
      create: (body: Record<string, unknown>) =>
        req<Record<string, unknown>>('/api/webhooks/registrations', json(body)),
      remove: (id: string) =>
        req<void>(`/api/webhooks/registrations/${id}`, { method: 'DELETE' }),
    },

    // ── hooks.ts ────────────────────────────────────────────────
    hooks: {
      /**
       * The server groups phases into an object of category → phase[].
       * Flattening here means every caller renders the same rows; an older
       * server that already returned a flat list still parses.
       */
      phases: async (): Promise<HookPhaseInfo[]> => {
        const raw = await req<unknown>('/api/hooks/phases');
        if (Array.isArray(raw)) {
          return raw.map((p) =>
            typeof p === 'string' ? { phase: p } : (p as HookPhaseInfo),
          );
        }
        const grouped = (raw as { categories?: Record<string, string[]> })?.categories
          ?? (raw as Record<string, string[]>);
        const out: HookPhaseInfo[] = [];
        for (const [category, phases] of Object.entries(grouped ?? {})) {
          if (!Array.isArray(phases)) continue;
          for (const phase of phases) out.push({ phase, category });
        }
        return out;
      },
      sessionHooks: (sessionId: string) =>
        req<Array<Record<string, unknown>>>(`/api/hooks/sessions/${sessionId}/hooks`),
      test: (sessionId: string, phase: string, payload?: Record<string, unknown>) =>
        req<Record<string, unknown>>(
          `/api/hooks/sessions/${sessionId}/hooks/test`,
          json({ phase, payload }),
        ),
    },

    // ── agents.ts (write half; reads live in client.ts) ─────────
    agents: {
      create: (body: CreateAgentParams) => req<Agent>('/api/agents', json(body)),
      update: (id: string, body: UpdateAgentParams) =>
        req<Agent>(`/api/agents/${id}`, jsonWith('PUT', body)),
      remove: (id: string, force?: boolean) =>
        req<{ deleted: boolean; soft: boolean }>(`/api/agents/${id}${qs({ force })}`, {
          method: 'DELETE',
        }),
      usage: (id: string) => req<Record<string, unknown>>(`/api/agents/${id}/usage`),
      export: (id: string) => req<{ markdown: string } | string>(`/api/agents/${id}/export`, json({})),
      import: (body: Record<string, unknown>) => req<Agent>('/api/agents/import', json(body)),
      resolvePreview: (body: {
        agentRef?: string;
        overrides?: AgentOverrides;
        projectId?: string;
        harnessType?: string;
        scope: string;
      }) => req<Record<string, unknown>>('/api/agents/resolve-preview', json(body)),
    },

    // ── sourceControl.ts (write half) ───────────────────────────
    sourceControl: {
      setConfig: (body: Record<string, unknown>) =>
        req<Record<string, unknown>>('/api/source-control/config', jsonWith('PUT', body)),
    },

    // ── security.ts ─────────────────────────────────────────────
    security: {
      posture: () => req<Record<string, unknown>>('/api/security/posture'),
      networkAccess: () => req<Record<string, unknown>>('/api/security/network-access'),
      setNetworkAccess: (body: Record<string, unknown>) =>
        req<Record<string, unknown>>('/api/security/network-access', json(body)),
    },

    // ── auth.ts (device administration) ─────────────────────────
    devices: {
      // The route answers `{ devices: [...] }`, not a bare array.
      list: async () =>
        (await req<{ devices: DeviceRecord[] }>('/api/auth/devices')).devices ?? [],
      get: (deviceId: string) => req<DeviceRecord>(`/api/auth/devices/${deviceId}`),
      rename: (deviceId: string, name: string) =>
        req<DeviceRecord>(`/api/auth/devices/${deviceId}`, jsonWith('PATCH', { name })),
      setScopes: (deviceId: string, scopes: string[]) =>
        req<DeviceRecord>(`/api/auth/devices/${deviceId}/scopes`, jsonWith('PUT', { scopes })),
      revoke: (deviceId: string) =>
        req<void>(`/api/auth/devices/${deviceId}`, { method: 'DELETE' }),
      audit: (params?: { limit?: number; since?: string }) =>
        req<Array<Record<string, unknown>>>(`/api/auth/audit${qs({ ...params })}`),
      createInvite: (body: Record<string, unknown>) =>
        req<Record<string, unknown>>('/api/auth/pair', json(body)),
      pendingInvites: () => req<Array<Record<string, unknown>>>('/api/auth/pair/pending'),
      revokeInvite: (grantId: string) =>
        req<void>(`/api/auth/pair/${grantId}`, { method: 'DELETE' }),
      serverInfo: () => req<Record<string, unknown>>('/api/auth/server-info'),
    },

    // ── system.ts / copilot.ts ──────────────────────────────────
    systemAdmin: {
      computerUse: () => req<Record<string, unknown>>('/api/system/computer-use'),
      setComputerUse: (body: Record<string, unknown>) =>
        req<Record<string, unknown>>('/api/system/computer-use', jsonWith('PUT', body)),
    },

    copilot: {
      models: () => req<Array<Record<string, unknown>>>('/api/copilot/models'),
      state: () => req<Record<string, unknown>>('/api/copilot/state'),
      conversations: () => req<Array<Record<string, unknown>>>('/api/copilot/conversations'),
      conversationMessages: (id: string) =>
        req<Array<Record<string, unknown>>>(`/api/copilot/conversations/${id}/messages`),
      ping: () => req<{ alive: boolean }>('/api/copilot/ping', json({})),
    },

    harnessAdmin: {
      current: () => req<Record<string, unknown>>('/api/harness'),
      models: () => req<Array<Record<string, unknown>>>('/api/harness/models'),
    },

    healthConfig: () => req<Record<string, unknown>>('/api/health/config'),

    sessions: {
      chat: (sessionId: string) =>
        req<Array<Record<string, unknown>>>(`/api/sessions/${sessionId}/chat`),
    },

    // ── stream.ts ───────────────────────────────────────────────
    stream: {
      /**
       * Short-lived ticket for transports that cannot send an Authorization
       * header — EventSource and the browser WebSocket both fall into this
       * category, so the ticket goes in the query string instead.
       */
      ticket: (scope: string, id: string) =>
        req<{ ticket: string; expiresAt?: number }>('/api/stream/tickets', json({ scope, id })),
      replay: (scope: string, id: string, afterSequence: number, limit?: number) =>
        req<{ events: unknown[]; lastSequence: number; hasMore: boolean }>(
          `/api/stream/replay${qs({ scope, id, afterSequence, limit })}`,
        ),
    },
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;
