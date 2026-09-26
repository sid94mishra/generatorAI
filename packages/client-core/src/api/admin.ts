// ────────────────────────────────────────────────────────────────
// The administrative / write half of the API.
//
// `client.ts` covers what a phone needs: read the world, send a message,
// approve a gate. This file covers what an operator needs: create and mutate
// definitions, drive runs, manage projects and codebases, and reach the
// feature areas (extensions, widgets, browser, computer use, webhooks,
// hooks, scripts) that no client previously exposed. A run starts through
// ONE method, `workflows.invoke` (P04).
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
  AutomationExecutionWithRuns,
  CreateAgentParams,
  CreateAutomationParams,
  HookDefinition,
  HookFailurePolicy,
  HookType,
  McpServerEntry,
  Project,
  ProjectCodebase,
  ProjectConfig,
  StageRun,
  LoopIteration,
  PendingDecisionView,
  TerminalSessionDescriptor,
  UpdateAgentParams,
  UpdateAutomationParams,
  WorktreeDetail,
  WorktreeInfo,
} from '@generatorai/shared';
import type {
  AuthoringPlan,
  AuthoringSkillIndex,
  AuthoringValidation,
  WorkflowSchemaInfo,
  WorkflowToolAdvert,
  WorkflowDefinitionRecord,
  WorkflowDefinitionSummary,
  WorkflowDefinitionVersionRecord,
  WorkflowDefinitionVersionSummary,
  WorkflowGraph,
  WorkflowGraphInput,
  RunProfile,
  WorkflowTemplate,
  InvocationPlan,
  InvocationRequest,
  InvocationResult,
  RunCommand,
  RunDigest,
} from '@generatorai/workflow-spec';
import {
  json,
  jsonWith,
  qs,
  request,
  requestAllowing,
  requestText,
  type ApiFetch,
  type DeviceScopeRequest,
} from './client.js';

/** Upload categories of a run start. */
export type InvocationUploadCategory = 'skills' | 'agents' | 'prompts';

/** Files a run start uploads before invoking, by category. */
export type InvocationUploadFiles = Partial<Record<InvocationUploadCategory, Array<{ name: string; data: Uint8Array; mimeType?: string }>>>;

/** A page of `GET /workflow-definitions`. */
export interface DefinitionPage {
  items: WorkflowDefinitionSummary[];
  nextCursor?: string;
}

/** `GET /workflow-definitions` filters. `projectId: 'global'` lists definitions without a project. */
export interface DefinitionListParams {
  projectId?: string;
  status?: 'draft' | 'published';
  q?: string;
  cursor?: string;
  limit?: number;
  includeArchived?: boolean;
}

/** `DELETE /workflow-definitions/:id`: deleted, or archived because runs pin it. */
export type DefinitionDeleteOutcome = { deleted: true } | { archived: true; runs: number };

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
  /**
   * The real working root a file operation actually reads/writes relative
   * to — NOT always `rootPath` itself (a worktree-enabled workspace keeps
   * `rootPath` as the outer container and does its real work inside a
   * worktree under it). The server's `GET /:id` route returns the full
   * `WorkspaceInfo` DTO (`packages/shared/src/types/Workspace.ts`) verbatim,
   * which always includes this — it was simply never declared here before.
   */
  workingDirectory?: string;
  /**
   * Always `path.join(rootPath, 'artifacts')` (`WorkspaceManager.ts`) — a
   * conventional subdirectory, not a separately-tracked entity. Already
   * browsable through the ordinary file tree at that relative path; no
   * dedicated "artifacts" endpoint exists or is needed.
   */
  artifactsPath?: string;
  projectId?: string | null;
  createdAt: string | number;
  sizeBytes?: number;
}

/**
 * Real shape of `GET /:id/files` (`workspaces.ts`). Every array here is bare
 * repo-relative path STRINGS — no `{name,type,size}` metadata; the server
 * walks the filesystem directly (`fs.readdir`), it does not `stat()` each
 * entry. `workspaceFiles` covers everything under the working directory
 * except the reserved subdirectories (`.git`, `source`, `output`,
 * `artifacts`, `scripts`, `config`, build/cache dirs); `artifactFiles`/
 * `sourceFiles` are those two reserved subdirectories specifically;
 * `worktrees[].files` mirrors the same walk for each worktree. Unlike
 * `workspaces.tree()` (git-tracked only), this walk catches UNTRACKED files
 * too — the only route that does, which is what makes it the real source
 * for browsing generated artifacts (never git-tracked).
 */
export interface WorkspaceFilesResponse {
  workspaceId: string;
  rootPath: string;
  codeRoot: string;
  workspaceFiles: string[];
  artifactFiles: string[];
  sourceFiles: string[];
  worktrees: Array<{ alias: string; worktreePath: string; files: string[] }>;
}

export interface FileEntryRecord {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: string | number;
}

/** A loaded workflow script (`GET /api/workflow-scripts`). */
export interface ScriptSummary {
  id: string;
  name: string;
  description?: string;
  filePath: string;
  lastModified: string;
  variables: Array<{ name: string; type: string; label: string; required: boolean }>;
  stageCount: number;
  profileCount: number;
  tags: string[];
}

/** `GET /api/workflow-scripts/:id`: the metadata and the graph the script builds. */
export interface ScriptDetail {
  metadata: ScriptSummary;
  graph: WorkflowGraph;
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

// `TerminalSessionDescriptor` (imported above) is the real per-session
// shape — a hand-written `TerminalRecord` interface used to live here
// instead, missing `pid`/`exitCode`/`exitSignal`/`lastActivityAt`/`host`
// entirely. Nothing had ever called `terminals.list()` to notice (Phase 5
// item 6 is its first real consumer).

/**
 * Builds the admin half of the API surface.
 *
 * Grouped by server route module so a reader can hold one file open beside
 * one namespace and check them off.
 */
export function createAdminApi(fetchImpl: ApiFetch) {
  const req = <T>(path: string, init?: RequestInit) => request<T>(fetchImpl, path, init);
  const reqText = (path: string, init?: RequestInit) => requestText(fetchImpl, path, init);

  return {
    // ── workflowDefinitions.ts ──────────────────────────────────
    // Definitions are whole v2 documents (P01 WP-1.7): read a graph, save the
    // whole graph back with the revision you edited (409 on a stale one).
    definitions: {
      list: (params?: DefinitionListParams) =>
        req<DefinitionPage>(
          `/api/workflow-definitions${qs({
            ...params,
            limit: params?.limit !== undefined ? String(params.limit) : undefined,
            includeArchived: params?.includeArchived ? 'true' : undefined,
          })}`,
        ),

      get: (id: string) => req<WorkflowDefinitionRecord>(`/api/workflow-definitions/${id}`),

      /** A new draft from a graph. */
      create: (graph: WorkflowGraphInput) => req<WorkflowDefinitionRecord>('/api/workflow-definitions', json(graph)),

      /** Replace the whole graph. A stale `expectedRevision` is a 409 whose body carries the current record. */
      saveGraph: (id: string, graph: WorkflowGraphInput, expectedRevision: number) =>
        req<WorkflowDefinitionRecord>(`/api/workflow-definitions/${id}/graph`, jsonWith('PUT', { graph, expectedRevision })),

      publish: (id: string) => req<WorkflowDefinitionRecord>(`/api/workflow-definitions/${id}/publish`, json({})),

      versions: (id: string) => req<WorkflowDefinitionVersionSummary[]>(`/api/workflow-definitions/${id}/versions`),

      version: (id: string, versionId: string) =>
        req<WorkflowDefinitionVersionRecord>(`/api/workflow-definitions/${id}/versions/${versionId}`),

      /** Stateless validation of a document: the spec's rules plus the server's (agents, models, capabilities, commands). */
      validate: (graph: unknown) => req<AuthoringValidation>('/api/workflow-definitions/validate', json(graph)),

      /** What a run of a graph (unsaved) or a saved definition would do; nothing is written (P06). */
      plan: (body: {
        graph?: unknown;
        workflowId?: string;
        variables?: Record<string, unknown>;
        stageOverrides?: unknown[];
        codebases?: Array<{ alias: string; baseRef?: string; mode?: 'worktree' | 'in_place' }>;
        projectId?: string;
      }) =>
        req<AuthoringPlan>('/api/workflow-definitions/plan', json(body)),

      /** The workflow JSON Schema and its hash (a skill compares its `schemaHash`). */
      schema: () => req<WorkflowSchemaInfo>('/api/workflow-definitions/schema'),

      /** The generated authoring skill bundle: its files, and one file's text. */
      skill: () => req<AuthoringSkillIndex>('/api/workflow-definitions/authoring/skill'),
      skillFile: (path: string) => reqText(`/api/workflow-definitions/authoring/skill/file${qs({ path })}`),

      /** Import a canonical document; `publish` (people only) publishes it at once. */
      import: (graph: unknown, opts: { publish?: boolean } = {}) =>
        req<WorkflowDefinitionRecord>(
          `/api/workflow-definitions/import${qs({ publish: opts.publish ? 'true' : undefined })}`,
          json(graph),
        ),

      /** Instantiate a template by id. */
      importTemplate: (templateId: string, opts: { name?: string; projectId?: string; publish?: boolean } = {}) =>
        req<WorkflowDefinitionRecord>(
          `/api/workflow-definitions/import${qs({ publish: opts.publish ? 'true' : undefined })}`,
          json({ templateId, ...(opts.name ? { name: opts.name } : {}), ...(opts.projectId ? { projectId: opts.projectId } : {}) }),
        ),

      /** The canonical document text (`import(export(g))` gives back `g`). */
      export: (id: string) => reqText(`/api/workflow-definitions/${id}/export`),

      /** Hard delete when nothing ran it; otherwise the definition is archived. */
      remove: (id: string) => req<DefinitionDeleteOutcome>(`/api/workflow-definitions/${id}`, { method: 'DELETE' }),
    },

    // ── workflowRuns.ts ─────────────────────────────────────────
    runs: {
      list: (params?: { definitionId?: string; status?: string; limit?: number }) =>
        req<RunSummary[]>(`/api/workflow-runs${qs({ ...params })}`),

      /** The run with its stage runs (instances). */
      get: (id: string) => req<RunSummary & { stageRuns: StageRun[] }>(`/api/workflow-runs/${id}`),

      /**
       * Every operator action on a run or one of its instances (P03 commands
       * API): pause, resume, cancel, retry, skip, fail, approve. The server
       * answers 202; a refused command throws its 409/400/404.
       */
      command: (id: string, body: RunCommand) =>
        req<{ runId: string; command: string }>(`/api/workflow-runs/${id}/commands`, json(body)),
      /** The run's workspace: the managed root, artifacts, uploads and every mount with its files. */
      workspace: (id: string) => req<Record<string, unknown>>(`/api/workflow-runs/${id}/workspace`),
      workspaceContent: (id: string, path: string, source?: string, worktreeAlias?: string) =>
        req<{ path: string; content: string | null; truncated: boolean; size: number }>(
          `/api/workflow-runs/${id}/workspace/content${qs({ path, source, worktreeAlias })}`,
        ),
      /** Each mount's change set. */
      workspaceDiff: (id: string) =>
        req<{ hasGit: boolean; repos: Array<{ alias: string; files: Array<{ path: string; status: string; diff?: string }> }> }>(
          `/api/workflow-runs/${id}/workspace/diff`,
        ),

      remove: (id: string) => req<void>(`/api/workflow-runs/${id}`, { method: 'DELETE' }),

      stages: (id: string) => req<StageRun[]>(`/api/workflow-runs/${id}/stages`),
      /** A loop instance's finished iterations, oldest first (P05). */
      iterations: (id: string, instanceId: string) =>
        req<LoopIteration[]>(`/api/workflow-runs/${id}/instances/${encodeURIComponent(instanceId)}/iterations`),
      /**
       * Every decision the run waits on (completion reviews, gates, parked
       * loops, approval and event waits), its sub-workflow children's
       * mirrored with the chain they came through (P05). Answer them with
       * THIS run's `command` (an approval reaches the owning child).
       */
      pendingDecisions: (id: string) => req<PendingDecisionView[]>(`/api/workflow-runs/${id}/pending-decisions`),
      /**
       * Deliver an external event to the run (P05 §4.3): the oldest waiting
       * event wait with the key takes it. A replay (same key and data) answers
       * `{replayed: true}`; the same key with other data is refused (409).
       */
      deliverEvent: (id: string, e: { eventKey: string; idempotencyKey: string; data?: unknown }) =>
        req<{ runId: string; command: string; replayed?: boolean }>(
          `/api/workflow-runs/${id}/commands`,
          json({ command: 'deliver_event', eventKey: e.eventKey, idempotencyKey: e.idempotencyKey, ...(e.data !== undefined ? { data: e.data } : {}) }),
        ),

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
      executions: (id: string) =>
        req<AutomationExecution[]>(`/api/automations/${id}/executions`),
      /**
       * `GET .../executions/:execId` — "get execution with runs"
       * (`apps/server/src/routes/automations.ts`, backed by
       * `AutomationService.getExecutionWithRuns`, which returns
       * `{ ...execution, runs: AutomationExecutionRun[] }`). Each run's
       * `workflowRunId` is the ONLY way to navigate from an execution into
       * the workflow run(s) it actually spawned — the `automation_execution.*`
       * stream events never carry it (Phase 6 item 6: `AgentEvent.ts` also
       * declares `iteration_completed`/`iteration_started`/`iteration_failed`
       * kinds that carry `workflowRunId`, but grepping every real emitter in
       * `packages/core/src/services/AutomationService.ts` turns up zero
       * producers for any of the three — they are never actually sent).
       */
      execution: (id: string, execId: string) =>
        req<AutomationExecutionWithRuns>(`/api/automations/${id}/executions/${execId}`),
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
      // Real response: `GET /:id/worktrees` returns `info.worktrees` verbatim
      // (`workspaces.ts`), which is `WorktreeDetail[]`
      // (`{codebaseId, alias, branchName, baseBranch, worktreePath, status}`)
      // — a workspace-scoped shape, NOT `WorktreeInfo`
      // (`{id, projectId, codebaseId, runId?, runType?, worktreePath,
      // branchName, status, createdAt, cleanedUpAt?}`), a DIFFERENT,
      // project/codebase-scoped type that happens to share two field names.
      // Was mistyped as `WorktreeInfo[]` before this fix.
      worktrees: (id: string) => req<WorktreeDetail[]>(`/api/workspaces/${id}/worktrees`),
      // Real response (`GET /:id/files`, `workspaces.ts`): NOT an array at
      // all — was mistyped as `FileEntryRecord[]` before this fix. The route
      // also silently ignores any `path` query param (ignores the second
      // arg here) and always returns everything; there is no server-side
      // path filter to request.
      files: (id: string, path?: string) =>
        req<WorkspaceFilesResponse>(`/api/workspaces/${id}/files${qs({ path })}`),
      // `source`/`worktreeAlias` select which base directory `path` resolves
      // under ('workspace' = the agent's working directory, the default;
      // 'artifacts' | 'source' = the matching subdirectory; 'worktree' +
      // `worktreeAlias` = that worktree's root) — real query params the
      // route reads (`workspaces.ts`) that this method never exposed before.
      // Response was also mistyped as bare `{content}`; the route always
      // sends `path`/`truncated`/`size` alongside it too.
      fileContent: (
        id: string,
        path: string,
        opts?: { source?: 'workspace' | 'worktree' | 'artifacts' | 'source'; worktreeAlias?: string },
      ) =>
        req<{ path: string; content: string; truncated: boolean; size: number }>(
          `/api/workspaces/${id}/files/content${qs({ path, source: opts?.source, worktreeAlias: opts?.worktreeAlias })}`,
        ),
      /**
       * Writes a file into the workspace (open question #24).
       *
       * There was no write route at all until now: a client could read every
       * file in a workspace and create none, so "add a file here" was
       * reachable only by having the agent do it or by having filesystem
       * access to the server. `content` is a FULL replacement, not a patch —
       * the route takes what the read route returns.
       */
      writeFile: (
        id: string,
        body: {
          path: string;
          content: string;
          source?: 'workspace' | 'worktree' | 'artifacts' | 'source';
          worktreeAlias?: string;
          createDirectories?: boolean;
        },
      ) =>
        req<{ path: string; size: number; created: boolean }>(
          `/api/workspaces/${id}/files/content`,
          jsonWith('PUT', body),
        ),
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
      // The route wraps its response in a `{ terminals: [...] }` envelope
      // (`apps/server/src/routes/terminals.ts`'s `GET /` handler,
      // `res.json({ terminals: list })`) — unwrapped here so callers get
      // the array their type says they get, not an object that happens to
      // have a `.terminals` property.
      list: (workspaceId: string) =>
        req<{ terminals: TerminalSessionDescriptor[] }>(
          `/api/workspaces/${workspaceId}/terminals`,
        ).then((body) => body.terminals),
      // Serves `application/octet-stream` — a raw VT byte ring, not JSON.
      // Reading it with `req` made the command fail on its own output.
      scrollback: (workspaceId: string, sid: string) =>
        reqText(`/api/workspaces/${workspaceId}/terminals/${sid}/scrollback`).then((data) => ({
          data,
        })),
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
      // The route answers `{ artifacts: [...] }` (`browser.ts`'s `/snapshots`
      // handler, `res.json({ artifacts: browserOnly })`) — unwrapped here so
      // callers get the array their type promises rather than an object that
      // happens to have an `.artifacts` property, the same treatment
      // `terminals.list` already needed for the same reason.
      snapshots: (workspaceId: string) =>
        req<{ artifacts: Array<Record<string, unknown>> }>(
          `/api/workspaces/${workspaceId}/browser/snapshots`,
        ).then((body) => body.artifacts ?? []),

      /**
       * The page's serialised accessibility tree — text, not pixels.
       *
       * The single most useful page representation for a terminal client:
       * the interactive shape of the page with `[ref=e1]` tags, roughly a
       * tenth the size of a DOM snapshot. `BrowserService.readPage()` has
       * always existed as an agent tool; it had no HTTP route until now, so
       * no client could ask for it.
       */
      readPage: (workspaceId: string) =>
        req<{ url: string; title: string; snapshot: string }>(
          `/api/workspaces/${workspaceId}/browser/read-page`,
          json({}),
        ),

      /**
       * Raw bytes of one browser artifact (a screenshot PNG, a DOM snapshot).
       *
       * `GET /browser/files/<relativePath>` streams the file with a real
       * content type — it is NOT JSON, so it cannot go through `request()`.
       */
      async file(workspaceId: string, relativePath: string): Promise<Uint8Array> {
        const encoded = relativePath.split('/').map(encodeURIComponent).join('/');
        const res = await fetchImpl(`/api/workspaces/${workspaceId}/browser/files/${encoded}`);
        if (!res.ok) {
          throw new Error(`Could not read ${relativePath}: ${res.status} ${res.statusText}`);
        }
        return new Uint8Array(await res.arrayBuffer());
      },
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
      // Every list route in this namespace answers an ENVELOPE, not a bare
      // array (`computer.ts`: `res.json({ grants })`, `res.json({ entries })`,
      // `res.json({ enabled, frames })`). Typed as arrays, all three rendered
      // as permanently empty for every caller — `computer grants`,
      // `computer activity` and `computer frames` each printed "no rows"
      // regardless of what the server held.
      grants: (workspaceId: string) =>
        req<{ grants: Array<Record<string, unknown>> }>(
          `/api/workspaces/${workspaceId}/computer/grants`,
        ).then((body) => body.grants ?? []),
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
        req<{ entries: Array<Record<string, unknown>> }>(
          `/api/workspaces/${workspaceId}/computer/activity`,
        ).then((body) => body.entries ?? []),
      frames: (workspaceId: string) =>
        req<{ enabled: boolean; frames: Array<Record<string, unknown>> }>(
          `/api/workspaces/${workspaceId}/computer/frames`,
        ).then((body) => body.frames ?? []),
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
      /**
       * The route answers `{ instances, render }` — and returns an EMPTY
       * list unless one of `chatId`/`workflowRunId`/`sessionId` is given
       * (its handler starts from `items = []` and only fills it inside those
       * three branches). Calling it with no scope, as this used to, could
       * therefore only ever produce nothing.
       */
      list: async (scope?: { chatId?: string; workflowRunId?: string; sessionId?: string }) =>
        (await req<{ instances: WidgetSummary[] }>(`/api/widgets${qs({ ...scope })}`)).instances ?? [],

      /**
       * Instances plus their render payloads — the payload is what a
       * non-graphical client degrades to text (see `widgetDegradation.ts`
       * in cli-core for the contract).
       */
      listWithRender: (scope?: { chatId?: string; workflowRunId?: string; sessionId?: string }) =>
        req<{ instances: WidgetSummary[]; render: Array<Record<string, unknown>> }>(
          `/api/widgets${qs({ ...scope })}`,
        ),

      // `{ instance: ... }`, not the instance — mis-typed as the bare object,
      // so `widget read` printed an envelope with one key and every field a
      // caller looked for was `undefined`.
      get: async (id: string) =>
        (await req<{ instance: WidgetSummary }>(`/api/widgets/${id}`)).instance,
      setState: async (id: string, state: Record<string, unknown>) =>
        (await req<{ instance: WidgetSummary }>(`/api/widgets/${id}/state`, jsonWith('PATCH', state)))
          .instance,
      close: (id: string) => req<void>(`/api/widgets/${id}`, { method: 'DELETE' }),
    },

    // ── workflowScripts.ts ──────────────────────────────────────
    scripts: {
      list: () => req<ScriptSummary[]>('/api/workflow-scripts'),
      get: (id: string) => req<ScriptDetail>(`/api/workflow-scripts/${id}`),
      profiles: (id: string) => req<RunProfile[]>(`/api/workflow-scripts/${id}/profiles`),
      materialize: (id: string, body?: { name?: string; projectId?: string }) =>
        req<{ definitionId: string; definition: WorkflowDefinitionRecord; stageCount: number; edgeCount: number }>(
          `/api/workflow-scripts/${id}/materialize`,
          json(body ?? {}),
        ),
      validate: (body: { path: string }) =>
        req<{ valid: boolean; errors: string[] }>('/api/workflow-scripts/validate', json(body)),
      reloadAll: () => req<Record<string, unknown>>('/api/workflow-scripts/reload', json({})),
      reload: (id: string) =>
        req<Record<string, unknown>>(`/api/workflow-scripts/${id}/reload`, json({})),
    },

    // ── workflowTools.ts (P06) ──────────────────────────────────
    //
    // The workflow tools of an agent outside the server (the MCP server):
    // the same handlers the in-app tools run. A refusal is a normal result
    // `{ok: false, code, error}`; `idempotencyKey` replays the same run.
    workflowTools: {
      list: () => req<{ tools: WorkflowToolAdvert[] }>('/api/workflow-tools'),
      call: (name: string, args: Record<string, unknown>, opts: { idempotencyKey?: string; clientName?: string } = {}) =>
        req<{ result: unknown }>(
          `/api/workflow-tools/${encodeURIComponent(name)}`,
          json({ arguments: args, ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}), ...(opts.clientName ? { clientName: opts.clientName } : {}) }),
        ),
    },

    // ── workflowInvocations.ts ──────────────────────────────────
    //
    // THE way a run starts (P04): a definition, a script or a fork of a
    // terminal run, one request, one route. The server derives the trigger;
    // `client` is a label. Every "Start" press sends its own idempotency
    // key, so a double click or a network retry does not start two runs.
    workflows: {
      invoke: async (
        body: InvocationRequest,
        opts: { idempotencyKey?: string; files?: InvocationUploadFiles } = {},
      ): Promise<InvocationResult> => {
        const files = Object.entries(opts.files ?? {}).flatMap(([category, list]) =>
          (list ?? []).map((f) => ({ category: category as InvocationUploadCategory, ...f })),
        );
        const headers: Record<string, string> = opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {};
        if (files.length === 0) {
          return req<InvocationResult>('/api/workflow-invocations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(body),
          });
        }
        const form = new FormData();
        form.set('request', JSON.stringify(body));
        for (const f of files) {
          // Same harmless `Uint8Array<ArrayBufferLike>` typings mismatch as
          // `chats.sendWithAttachments`.
          form.append(f.category, new Blob([f.data as unknown as ArrayBuffer], { type: f.mimeType || 'application/octet-stream' }), f.name);
        }
        // No content-type: fetch sets the multipart boundary from the body.
        return req<InvocationResult>('/api/workflow-invocations', { method: 'POST', headers, body: form });
      },
      /** What `invoke` would do: stages by layer, skips, codebases, phases, post-processing, permission mode. */
      plan: (body: InvocationRequest) => req<InvocationPlan>('/api/workflow-invocations/plan', json(body)),
      /** Stage files before invoking (TTL 1 h); send the ids in `invoke`'s `uploads`. */
      uploads: (files: Array<{ category: InvocationUploadCategory; name: string; data: Uint8Array; mimeType?: string }>) => {
        const form = new FormData();
        for (const f of files) {
          form.append(f.category, new Blob([f.data as unknown as ArrayBuffer], { type: f.mimeType || 'application/octet-stream' }), f.name);
        }
        return req<{ uploads: Array<{ uploadId: string; category: InvocationUploadCategory; name: string }> }>(
          '/api/workflow-invocations/uploads',
          { method: 'POST', body: form },
        );
      },
      /** The run's digest; `waitSeconds` long-polls (≤ 60) until it finalizes (or waits for an approval). */
      digest: (runId: string, opts: { waitSeconds?: number; stopOnApproval?: boolean; detail?: 'brief' | 'full' } = {}) =>
        req<RunDigest>(
          `/api/workflow-invocations/${runId}/digest${qs({
            ...(opts.waitSeconds ? { wait: String(opts.waitSeconds) } : {}),
            ...(opts.stopOnApproval ? { stopOnApproval: 'true' } : {}),
            ...(opts.detail ? { detail: opts.detail } : {}),
          })}`,
        ),
    },

    // ── templates.ts ────────────────────────────────────────────
    templates: {
      list: () => req<WorkflowTemplate[]>('/api/templates'),
      get: (id: string) => req<WorkflowTemplate>(`/api/templates/${id}`),
    },

    // ── settings.ts ─────────────────────────────────────────────
    settings: {
      /** The commands a check stage may run: the defaults plus the operator's extras (P05). */
      scriptAllowlist: () =>
        req<{ commands: string[]; defaults: string[]; extras: string[] }>('/api/settings/script-allowlist'),
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
      /**
       * Dry-runs one hook. The route reads the WHOLE body as a
       * `HookDefinition` and dispatches on `config.type` — `phase` and
       * `type` are the only fields it validates itself, but `enabled` must
       * be `true` and `retries`/`timeoutMs` must be real numbers or the
       * executor silently runs the hook zero times while the route still
       * reports `{ success: true }`. Callers only choose `type`/`config`;
       * everything else defaults to values that guarantee it actually runs.
       */
      test: (
        sessionId: string,
        // Loose on purpose: the route only checks that `phase`/`type` are
        // present, not that `phase` is one of the known `HookPhase` values.
        phase: string,
        hook: {
          type: HookType;
          config: HookDefinition['config'];
          name?: string;
          priority?: number;
          timeoutMs?: number;
          retries?: number;
          failurePolicy?: HookFailurePolicy;
        },
      ) =>
        req<{ success: boolean; message: string; error?: string }>(
          `/api/hooks/sessions/${sessionId}/hooks/test`,
          json({
            id: 'cli-test',
            name: hook.name ?? 'cli-test',
            phase,
            type: hook.type,
            priority: hook.priority ?? 0,
            enabled: true,
            failurePolicy: hook.failurePolicy ?? 'continue',
            timeoutMs: hook.timeoutMs ?? 10_000,
            retries: hook.retries ?? 0,
            config: hook.config,
          }),
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

      // Scope requests raised by devices (routes/scopeRequests.ts). All
      // three need `admin:devices`; the device-side half (create / mine /
      // cancel) is `createApiClient().auth.scopeRequests`.
      scopeRequests: {
        listPending: async () =>
          (await req<{ requests: DeviceScopeRequest[] }>('/api/auth/scope-requests?status=pending'))
            .requests ?? [],
        /** `scopes` narrows the grant to a subset of what was asked for. */
        approve: (requestId: string, body?: { scopes?: string[]; note?: string }) =>
          req<{ request: DeviceScopeRequest; deviceScopes: string[] }>(
            `/api/auth/scope-requests/${encodeURIComponent(requestId)}/approve`,
            json(body ?? {}),
          ),
        deny: (requestId: string, body?: { note?: string }) =>
          req<{ request: DeviceScopeRequest }>(
            `/api/auth/scope-requests/${encodeURIComponent(requestId)}/deny`,
            json(body ?? {}),
          ),
      },
    },

    // ── system.ts / copilot.ts ──────────────────────────────────
    systemAdmin: {
      computerUse: () => req<Record<string, unknown>>('/api/system/computer-use'),
      setComputerUse: (body: Record<string, unknown>) =>
        req<Record<string, unknown>>('/api/system/computer-use', jsonWith('PUT', body)),
      workspaceRetention: () => req<Record<string, unknown>>('/api/system/workspace-retention'),
      setWorkspaceRetention: (body: Record<string, unknown>) =>
        req<Record<string, unknown>>('/api/system/workspace-retention', jsonWith('PUT', body)),
      runWorkspaceRetention: (body: Record<string, unknown> = {}) =>
        req<{ tracked: number; orphans: number; failed: number }>(
          '/api/system/workspace-retention/run',
          json(body),
        ),
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
      /** Pass `stageRunId` to narrow a shared session to one stage run's turns. */
      chat: (sessionId: string, stageRunId?: string) =>
        req<Array<Record<string, unknown>>>(`/api/sessions/${sessionId}/chat${qs({ stageRunId })}`),
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
