import type { HarnessProviderId } from '@generatorai/shared';
// ────────────────────────────────────────────────────────────────
// HttpPlatformClient — Web platform IPlatformClient implementation
// Communicates with the server via REST + SSE
// ────────────────────────────────────────────────────────────────

import type {
  IPlatformClient,
  InvocationFiles,
  PlatformType,
  EventSubscriptionOptions,
} from '@generatorai/shared';
import type {
  InvocationPlan,
  InvocationRequest,
  InvocationResult,
  RunCommand,
  WorkflowDefinitionRecord,
  WorkflowDefinitionSummary,
  WorkflowDefinitionVersionRecord,
  WorkflowGraphInput,
  WorkflowTemplate,
} from '@generatorai/workflow-spec';
import {
  ApiError as CoreApiError,
  createAdminApi,
  type DefinitionDeleteOutcome,
  type InvocationUploadCategory,
  type InvocationUploadFiles,
} from '@generatorai/client-core';
import type { ChatMessage } from '@generatorai/shared';
// PLN-01 — plan mode
import type {
  AgentMode,
  PlanAction,
  PlanComment,
  PlanDocument,
  PlanRevision,
} from '@generatorai/shared';
import type { Artifact } from '@generatorai/shared';
// AGT-01 — first-class agents
import type {
  Agent,
  AgentScope,
  AgentRole,
  AgentOverrides,
  CreateAgentParams,
  UpdateAgentParams,
  ResolvedAgentProjection,
  ResolutionWarning,
} from '@generatorai/shared';
// Source control — accounts, readiness, the commit→PR flow, PR browsing, editors.
// Aliased to the `Scm*` names the shared barrel exports so the two vocabularies
// (this file's older `PullRequest*` helpers and the contract's) cannot collide.
import type {
  SourceControlAccount as ScmAccount,
  SourceControlSettings as ScmSettings,
  SourceControlSettingsResponse as ScmSettingsResponse,
  DeviceLoginStart as ScmDeviceLoginStart,
  DeviceLoginStatus as ScmDeviceLoginStatus,
  EditorId as ScmEditorId,
  EditorInfo as ScmEditorInfo,
  RepoReadiness as ScmRepoReadiness,
  WorkspaceReadinessResponse as ScmWorkspaceReadiness,
  ScmFlowRequest,
  ScmFlowResult,
  ScmGenerateRequest,
  ScmGenerateResult,
  ProjectPullRequestsResponse as ScmProjectPullRequests,
  PullRequestDetail as ScmPullRequestDetail,
  PullRequestFile as ScmPullRequestFile,
  PullRequestComment as ScmPullRequestComment,
  OpenInEditorRequest as ScmOpenInEditorRequest,
  OpenInEditorResult as ScmOpenInEditorResult,
  ChatSourceControlOptions,
} from '@generatorai/shared';

/** What the conflict endpoints answer with. The flow result is re-run by the
 *  client afterwards, so these only have to say whether the step worked. */
export interface ScmConflictActionResult {
  ok: boolean;
  /** Paths still carrying conflict markers (returned by `continue`). */
  unmerged?: string[];
  /** Set by `continue` once the merge commit landed. */
  committed?: boolean;
  error?: string;
}

// Workspace mounts — what the chat actually works on.
import type {
  ChatSourceSpec,
  WorkspaceMount,
  WorkspacePrepStatus,
} from '@generatorai/shared';

/** Response of `GET /api/chats/:id/transcript`. */
export interface ChatTranscript {
  chatId: string;
  name: string;
  messages: ChatMessage[];
}

/** What a rewind moves: the files, the conversation, or both. */
export type RewindScope = 'all' | 'code' | 'conversation';

/** Response of `POST /api/chats/:id/rewind`. */
export interface RewindChatResult {
  chatId: string;
  turnId: string;
  scope: RewindScope;
  /** The prompt of the rewound turn — offered back in the composer. */
  prompt?: string;
  /**
   * How the provider's own history moved: natively, by seeding a fresh
   * session with a digest of what survives, or not at all (`code` scope).
   */
  conversation: 'native' | 'synthetic' | 'skipped';
  files?: {
    mounts: Array<{
      alias: string;
      ok: boolean;
      restored?: number;
      deleted?: number;
      skipped?: number;
      error?: string;
    }>;
    restored: number;
    deleted: number;
    skipped: number;
  };
}

/** Response of `POST /api/chats/:id/fork`. */
export interface ForkChatResult {
  chat: Chat;
  turnId?: string;
  conversation: 'native' | 'synthetic';
}

/** Response of `GET /api/agents/:id/usage`. */
export interface AgentUsageResponse {
  chats: Array<{ id: string; name: string }>;
  stages: Array<{ id: string; name: string; workflowDefinitionId: string }>;
  workflows: Array<{ id: string; name: string }>;
}

/** One directory entry from `GET /api/fs/dirs`. */
export interface FsDirEntry {
  name: string;
  path: string;
  /** The directory is itself a git repository. */
  isGit: boolean;
}

/** Response of `GET /api/fs/dirs?path=`. An empty path lists `roots`. */
export interface FsDirListing {
  path: string;
  parent: string | null;
  entries: FsDirEntry[];
  /** Only for the empty-path listing: home + drive roots. */
  roots?: string[];
  /** Whether `path` itself is a repository. */
  isGit?: boolean;
}

/** Response of `GET /api/fs/git-info?path=`. */
export interface FsGitInfo {
  path: string;
  isRepo: boolean;
  currentBranch: string | null;
  branches: string[];
  dirty: boolean;
  nestedRepos: string[];
}

/** `GET /api/workspaces/:id` — the mount plan as it was actually realised. */
export interface WorkspaceInfoDto {
  id: string;
  ownerType: string;
  ownerId: string;
  projectId?: string;
  rootPath: string;
  workingDirectory: string;
  scratchPath: string;
  status: string;
  prepStatus: WorkspacePrepStatus;
  prepError?: string;
  mounts: WorkspaceMount[];
  worktrees?: unknown[];
  createdAt: string;
}

/** `GET /api/workspaces/:id/files` — the @-mention / file-panel index. */
export interface WorkspaceFilesDto {
  workspaceId: string;
  rootPath: string;
  scratchPath?: string;
  codeRoot?: string;
  /** One entry per mount, in workspace order. */
  mounts?: Array<{ alias: string; path: string; mode: string }>;
  /** Managed scratch + plans files, relative to `rootPath`. */
  workspaceFiles: string[];
  artifactFiles: string[];
  /** Always empty since the mount rewrite; kept so old servers still work. */
  sourceFiles: string[];
  /** One entry per mount (in-place mounts included), files repo-relative. */
  worktrees: Array<{ alias: string; worktreePath: string; mode?: string; files: string[] }>;
}

/** Driver process health, from `GET /api/workspaces/:id/computer/runtime`. */
export interface ComputerRuntime {
  provider: string;
  providerVersion?: string;
  host: 'in-process' | 'attached' | 'none';
  state: 'ready' | 'stopped' | 'degraded' | 'unavailable';
  detail?: string;
  checks?: Array<{ name: string; status: 'pass' | 'fail' | 'skip'; message: string }>;
  enabled: boolean;
  sessionActive: boolean;
}

/** Response of `GET|PUT /api/system/computer-use`. */
export interface ComputerUseSettings {
  enabled: boolean;
  /** Synthetic OS input — the only tier that can take over the screen. */
  allowSynthetic: boolean;
  /** Hard-disabled by `GENERATORAI_COMPUTER_USE` in the server environment. */
  killSwitch: boolean;
  skillId: string;
  runtime?: ComputerRuntime;
}


/** Settings -> Audio, as the server reports them. */
export interface AudioSettings {
  sttEngine: string;
  textFormatter: string;
  endpointSilenceMs: number;
  interimResults: boolean;
  ttsEnabled: boolean;
  ttsVoice: string;
  ttsSpeed: number;
  engines?: string[];
  formatters?: string[];
  minEndpointMs?: number;
  maxEndpointMs?: number;
  /** Non-null when an operator pinned the engine via the environment. */
  engineLockedByEnv?: string | null;
}

/** Whether the Nemotron weights are downloaded, and download progress. */
export interface SpeechModelStatus {
  present: boolean;
  dir: string;
  repo: string;
  bytesOnDisk: number;
  approxTotalBytes: number;
  downloading?: boolean;
  progress?: number;
  error?: string;
}

/** Server-side state for the nightly execution-workspace sweep. */
export interface WorkspaceRetentionSettings {
  enabled: boolean;
  retentionDays: number;
  minDays: number;
  maxDays: number;
}

/** What one sweep reclaimed. */
export interface WorkspaceRetentionRunResult {
  tracked: number;
  orphans: number;
  failed: number;
}
import type { PersistedEvent, AgentEventKind } from '@generatorai/shared';
import type {
  Chat,
  CreateChatParams,
  WorkflowRun,
  WorkflowRunWithStages,
  RunWorkspaceInfo,
  Automation,
  AutomationWithExecutions,
  AutomationExecution,
  AutomationExecutionWithRuns,
  CreateAutomationParams,
  UpdateAutomationParams,
  TriggerAutomationBody,
  Project,
  ProjectCodebase,
  ProjectConfig,
  WorktreeInfo,
  ProjectSettings,
  CodebaseType,
  CodebaseSettings,
  ConfigType,
} from '@generatorai/shared';
import { apiFetch, ApiError } from './apiFetch.js';
import { getAuthRuntime } from './authRuntime.js';
import { openMultiplexedStream } from './muxStream.js';
import type {
  ChangeSummary,
  ChangeFileRef,
  ChangeFileVersions,
  ChangeFilePatch,
  CheckpointRecord,
  DiscardChangesResult,
  RestoreCheckpointResult,
  ReviewChangesResult,
  WorkspaceTree,
  WorkspaceTreeFile,
} from '../types/changes.js';
import type {
  ReviewThread,
  ReviewComment,
  ReviewThreadStatus,
  CreateReviewThreadInput,
  ReviewSubmitTarget,
  ReviewSubmitResult,
} from '../types/review.js';

/**
 * Model metadata surfaced by the agent harness provider via
 * `GET /api/copilot/models`. Mirrors `HarnessModel` in
 * `@generatorai/core` — capability/billing fields drive the model picker
 * UI so nothing is hardcoded on the client.
 */
export interface ChatModel {
  id: string;
  name: string;
  provider?: string;
  /** Provider blurb — for Claude Code this carries the concrete version + pricing. */
  description?: string;
  category?: string;
  /** Maximum PROMPT tokens (default tier) — the context-gauge denominator. */
  promptTokenLimit?: number;
  /** Advertised total window = promptTokenLimit + maxOutputTokens. Display only. */
  totalContextWindow?: number;
  /** Long-context tier limits, when the model offers one. */
  longContext?: { promptTokenLimit?: number; totalContextWindow?: number };
  /** @deprecated Use `totalContextWindow` / `promptTokenLimit`. */
  contextWindow?: number;
  /** @deprecated Use `promptTokenLimit`. */
  standardContextWindow?: number;
  maxOutputTokens?: number;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
  reasoningEfforts?: string[];
  defaultReasoningEffort?: string;
  priceCategory?: string;
  billingMultiplier?: number;
  pricing?: {
    input?: number;
    output?: number;
    cached?: number;
    batchSize?: number;
  };
  supportsLongContext?: boolean;
}

/**
 * System health snapshot returned by `GET /api/health`. Drives the
 * dashboard heartbeat / connection card.
 */
export interface SystemHealth {
  status: 'ok' | 'degraded';
  copilot: boolean;
  harness: { type: string; healthy: boolean };
  db: boolean;
  uptime: number;
  timestamp: string;
  /**
   * `process.platform` of the SERVER host. That is where terminals, editors
   * and the agent run — not necessarily this machine, so nothing may infer it
   * from the user agent.
   */
  platform?: string;
  activeChats: number;
  activeWorkflowRuns: number;
  /** IDs of chats currently streaming a response (in-flight turn). */
  runningChatIds: string[];
  otel: { enabled: boolean; endpoint?: string; serviceName?: string };
}

/**
 * A human gate still awaiting a response, as serialised by
 * `GET /api/chats/:id/interactions`.
 *
 * Deliberately NOT `AgentInteraction`: the route projects the entity and
 * renames `id` to `interactionId`. Typing this as the entity made every
 * consumer read `i.id` as `undefined`, which silently expired live gates.
 */
export interface PendingInteraction {
  interactionId: string;
  kind: 'plan_review' | 'question' | string;
  status: string;
  payload?: Record<string, unknown>;
}

/**
 * Row shape of `GET /api/chats/:id/plans`. Like {@link PendingInteraction},
 * the route projects the entity and renames `id` to `planId`.
 */
export interface PlanSummary {
  planId: string;
  revision: number;
  title: string;
  summary: string;
  status: string;
  actions: string[];
  fileName?: string;
}

/**
 * A client-core call, with its failure re-thrown as this app's `ApiError`:
 * the global error toast, the retry policy and the inline error views all
 * read `code`, `status` and the envelope's `issues` from that one class.
 */
async function viaClientCore<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (err) {
    if (!(err instanceof CoreApiError)) throw err;
    const envelope = (err.body as { error?: { code?: string; message?: string; issues?: unknown } } | undefined)?.error;
    throw new ApiError(
      err.status,
      envelope?.code ?? `HTTP_${String(err.status)}`,
      envelope?.message ?? err.message,
      envelope?.issues !== undefined ? { issues: envelope.issues } : undefined,
    );
  }
}

/** Browser files → the bytes client-core uploads. */
async function uploadFiles(files: InvocationFiles | undefined): Promise<InvocationUploadFiles | undefined> {
  if (!files) return undefined;
  const out: InvocationUploadFiles = {};
  for (const [category, list] of Object.entries(files) as Array<[InvocationUploadCategory, InvocationFiles[InvocationUploadCategory]]>) {
    if (!list?.length) continue;
    out[category] = await Promise.all(
      list.map(async (file) => ({
        name: file.name,
        data: new Uint8Array(await file.arrayBuffer()),
        ...(file.type ? { mimeType: file.type } : {}),
      })),
    );
  }
  return out;
}

export class HttpPlatformClient implements IPlatformClient {
  readonly platform: PlatformType = 'web';
  readonly baseUrl: string;

  /**
   * client-core's typed API over this app's authenticated fetch. Workflow
   * runs start and are read through it, so the web keeps no second
   * hand-written client for them (G3 5.13).
   */
  private readonly admin = createAdminApi((path, init) => getAuthRuntime().fetch(`${this.baseUrl}${path}`, init));

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

  // ── Lifecycle ──

  async initialize(): Promise<void> {
    // Verify connectivity via health endpoint
    await apiFetch(`${this.baseUrl}/api/health`);
  }

  async shutdown(): Promise<void> {
    // No-op for web client
  }

  // ── Chat ──

  async sendPrompt(
    sessionId: string,
    prompt: string,
    attachments?: Array<{ type: 'file'; path: string; displayName?: string }>,
  ): Promise<void> {
    const formData = new FormData();
    formData.append('prompt', prompt);

    if (attachments?.length) {
      for (const attachment of attachments) {
        formData.append('attachmentPaths', JSON.stringify(attachment));
      }
    }

    await apiFetch(`${this.baseUrl}/api/sessions/${sessionId}/prompt`, {
      method: 'POST',
      body: formData,
    });
  }

  /** Browser-specific: send prompt with actual File objects */
  async sendPromptWithFiles(
    sessionId: string,
    prompt: string,
    files?: File[],
  ): Promise<void> {
    const formData = new FormData();
    formData.append('prompt', prompt);

    if (files?.length) {
      for (const file of files) {
        formData.append('attachments', file, file.name);
      }
    }

    await apiFetch(`${this.baseUrl}/api/sessions/${sessionId}/prompt`, {
      method: 'POST',
      body: formData,
    });
  }

  async getChatHistory(sessionId: string, limit?: number, offset?: number, stageRunId?: string): Promise<ChatMessage[]> {
    const params = new URLSearchParams();
    // Only send limit/offset when explicitly provided. Omitting them tells the
    // server to return ALL messages, avoiding truncation of long chat histories
    // that previously caused newest messages to be missing after page refresh.
    if (limit !== undefined) params.set('limit', String(limit));
    if (offset !== undefined) params.set('offset', String(offset));
    if (stageRunId) params.set('stageRunId', stageRunId);
    const qs = params.toString();
    return apiFetch<ChatMessage[]>(`${this.baseUrl}/api/sessions/${sessionId}/chat${qs ? `?${qs}` : ''}`);
  }

  // ── Templates ──

  async getWorkflowTemplates(): Promise<WorkflowTemplate[]> {
    return apiFetch<WorkflowTemplate[]>(`${this.baseUrl}/api/templates`);
  }

  // ── Artifacts ──

  async getArtifacts(sessionId: string): Promise<Artifact[]> {
    return apiFetch<Artifact[]>(`${this.baseUrl}/api/sessions/${sessionId}/artifacts`);
  }

  async downloadArtifact(artifactId: string): Promise<{ data: Buffer; mimeType: string; name: string }> {
    // Binary download: `apiFetch` only understands JSON, so we go through the
    // runtime directly to keep the DPoP proof while reading the raw body.
    const response = await getAuthRuntime().fetch(
      `${this.baseUrl}/api/artifacts/${artifactId}/download`,
    );
    if (!response.ok) {
      throw new ApiError(response.status, 'DOWNLOAD_FAILED', `Failed to download artifact ${artifactId}`);
    }

    const blob = await response.blob();
    const mimeType = response.headers.get('content-type') ?? 'application/octet-stream';
    const disposition = response.headers.get('content-disposition');
    const nameMatch = disposition?.match(/filename="?([^";\n]+)"?/);
    const name = nameMatch?.[1] ?? artifactId;

    // In the browser we use Uint8Array; cast to satisfy the shared interface
    const arrayBuffer = await blob.arrayBuffer();
    return {
      data: new Uint8Array(arrayBuffer) as unknown as Buffer,
      mimeType,
      name,
    };
  }

  // ── Event Subscription (SSE) ──

  subscribeToEvents(
    sessionId: string,
    handler: (event: PersistedEvent) => void,
    options?: EventSubscriptionOptions & {
      onConnected?: () => void;
      onReconnecting?: () => void;
      onDisconnected?: () => void;
    },
  ): () => void {
    // W09-a — the two call sites this comment used to warn about are now one
    // connection. `sseManager` and this method both subscribe scopes on the
    // shared multiplexed stream, so using both for the same session costs a
    // subscription rather than a socket, and the frames are deduplicated by
    // the global event id.
    const handle = openMultiplexedStream(
      'session',
      sessionId,
      {
        onOpen: () => options?.onConnected?.(),
        onError: (source) => {
          if (source && source.readyState === EventSource.CONNECTING) {
            options?.onReconnecting?.();
          } else {
            options?.onDisconnected?.();
          }
        },
        onMessage: (msg) => {
          try {
            const parsed = JSON.parse(msg.data) as PersistedEvent;
            handler(parsed);
          } catch {
            // Ignore malformed events
          }
        },
      },
      options?.kindPrefixes?.length ? options.kindPrefixes : undefined,
    );

    // Unsubscribe function
    return () => {
      handle.close();
    };
  }

  // ── Platform-specific ──

  /**
   * CLN-05 — Previously returned `null` silently, which callers could not
   * distinguish from "user cancelled the picker". Now:
   *
   *   - If the browser supports the File System Access API
   *     (`window.showDirectoryPicker`), open the native picker and return
   *     the chosen directory name. Returns `null` ONLY when the user
   *     explicitly cancels the picker.
   *   - Otherwise throws `NotSupportedError` so the UI can show a clear
   *     "paste a path instead" fallback rather than silently misbehaving.
   *
   * Note: the File System Access API only exposes the directory's *name*
   * (not its absolute path) due to browser sandboxing — server-side APIs
   * that need a real filesystem path must still accept user-typed input.
   */
  async selectDirectory(): Promise<string | null> {
    const picker = (window as unknown as {
      showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<{ name: string }>;
    }).showDirectoryPicker;
    if (typeof picker !== 'function') {
      const err = new Error(
        'Directory picker is not supported in this browser. Type the path manually or use a Chromium-based browser.',
      );
      err.name = 'NotSupportedError';
      throw err;
    }
    try {
      const handle = await picker({ mode: 'read' });
      return handle.name;
    } catch (e) {
      // User-cancelled pickers reject with AbortError in all browsers that
      // implement the spec. Treat as "no selection" (null); re-throw anything else.
      if (e instanceof DOMException && e.name === 'AbortError') return null;
      throw e;
    }
  }

  /**
   * STR-04 — REST replay against the new unified stream. Mirrors the
   * `/api/stream/replay` endpoint. Returns raw broker rows; the caller
   * (sseManager) reshapes into PersistedEvent. Uses `StreamEventRow`
   * shape as declared on the server: `{id, scope, scopeId, seq, kind, payload, ts}`.
   */
  async streamReplay(
    scope: 'chat' | 'run' | 'session' | 'global',
    id: string,
    afterSeq: number,
    limit: number = 500,
  ): Promise<Array<{
    id: number;
    scope: string;
    scopeId: string;
    seq: number;
    kind: string;
    payload: unknown;
    ts: number;
  }>> {
    const params = new URLSearchParams({
      scope,
      id,
      afterSeq: String(afterSeq),
      limit: String(limit),
    });
    const response = await apiFetch<{
      rows: Array<{
        id: number;
        scope: string;
        scopeId: string;
        seq: number;
        kind: string;
        payload: unknown;
        ts: number;
      }>;
      nextAfterSeq: number;
    }>(`${this.baseUrl}/api/stream/replay?${params.toString()}`);
    return response.rows;
  }

  // ── v2: Chat Operations ──

  async createChat(params: CreateChatParams): Promise<Chat> {
    return apiFetch<Chat>(`${this.baseUrl}/api/chats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async listChats(filter?: { status?: string }): Promise<Chat[]> {
    const params = new URLSearchParams();
    if (filter?.status) params.set('status', filter.status);
    const qs = params.toString();
    return apiFetch<Chat[]>(`${this.baseUrl}/api/chats${qs ? `?${qs}` : ''}`);
  }

  async getChat(chatId: string): Promise<Chat> {
    return apiFetch<Chat>(`${this.baseUrl}/api/chats/${chatId}`);
  }

  /**
   * Replace what the chat works on. Rejected with 409 CHAT_BUSY while a turn
   * is running (mounts cannot move under a live agent) and with 400 and a
   * readable message when a source does not validate — both are surfaced
   * inline by the editor rather than as a toast.
   */
  async updateChatSources(
    chatId: string,
    sources: ChatSourceSpec[],
    primary?: string,
  ): Promise<Chat> {
    return apiFetch<Chat>(`${this.baseUrl}/api/chats/${chatId}/sources`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources, ...(primary ? { primary } : {}) }),
    });
  }

  /** Re-run mount preparation after it failed. Answers 202; progress arrives on SSE. */
  async prepareChatWorkspace(chatId: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/chats/${chatId}/workspace/prepare`, { method: 'POST' });
  }

  // ── Filesystem browsing (local-folder source picker) ──

  /** Child directories of `path`; an empty path lists the drive / home roots. */
  async listFsDirs(path?: string): Promise<FsDirListing> {
    const qs = new URLSearchParams({ path: path ?? '' });
    return apiFetch<FsDirListing>(`${this.baseUrl}/api/fs/dirs?${qs.toString()}`);
  }

  /** Branches, dirty state and nested repositories of a folder. */
  async getFsGitInfo(path: string): Promise<FsGitInfo> {
    const qs = new URLSearchParams({ path });
    return apiFetch<FsGitInfo>(`${this.baseUrl}/api/fs/git-info?${qs.toString()}`);
  }

  // ── Orchestrator background tasks ──

  async getBackgroundTasks(chatId: string): Promise<{
    tasks: Array<{ taskId: string; taskName: string; status: string; model?: string; reviewRounds: number }>;
  }> {
    return apiFetch(`${this.baseUrl}/api/chats/${chatId}/background-tasks`);
  }

  async getBackgroundTaskDigest(chatId: string, taskId: string): Promise<Record<string, unknown>> {
    return apiFetch(`${this.baseUrl}/api/chats/${chatId}/background-tasks/${taskId}`);
  }

  async cancelBackgroundTask(chatId: string, taskId: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/chats/${chatId}/background-tasks/${taskId}/cancel`, {
      method: 'POST',
    });
  }

  async updateChat(chatId: string, updates: { model?: string; gitRepositories?: unknown; codebaseIds?: string[]; harnessConfig?: Record<string, unknown>; defaultAgentMode?: AgentMode; permissionMode?: 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan' }): Promise<Chat> {
    return apiFetch<Chat>(`${this.baseUrl}/api/chats/${chatId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
  }

  async archiveChat(chatId: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/chats/${chatId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'archived' }),
    });
  }

  async deleteChat(chatId: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/chats/${chatId}`, { method: 'DELETE' });
  }

  /**
   * Stop the in-flight turn for a chat (aborts the SDK conversation).
   *
   * `options` is what the two-phase Stop control computes: `force` on the
   * second press tears the provider conversation down as well; `budgetSeconds`
   * bounds how long the server waits for the provider to acknowledge.
   */
  async cancelChat(
    chatId: string,
    options?: { force?: boolean; budgetSeconds?: number },
  ): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/chats/${chatId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options ?? {}),
    });
  }

  async sendChatPrompt(
    chatId: string,
    prompt: string,
    attachments?: Array<{ type: 'file'; path: string; displayName?: string }>,
    mode?: AgentMode,
  ): Promise<void> {
    const formData = new FormData();
    formData.append('prompt', prompt);
    // PLN-01 — per-turn agent mode.
    if (mode) formData.append('mode', mode);

    if (attachments?.length) {
      for (const attachment of attachments) {
        formData.append('attachmentPaths', JSON.stringify(attachment));
      }
    }

    await apiFetch(`${this.baseUrl}/api/chats/${chatId}/prompt`, {
      method: 'POST',
      body: formData,
    });
  }

  /**
   * The WHOLE transcript, oldest first — no page cap.
   *
   * "Copy transcript" must copy the conversation, not the last page of it,
   * and `getChatMessages` is deliberately bounded. This is the unbounded
   * read, used only for export.
   */
  async getChatTranscript(chatId: string): Promise<ChatTranscript> {
    return apiFetch<ChatTranscript>(`${this.baseUrl}/api/chats/${chatId}/transcript`);
  }

  /**
   * Rewind to the START of a turn — files, conversation, or both.
   *
   * Answers 409 `CHAT_BUSY` while a turn is in flight and 404 for a turn the
   * server does not know, both surfaced as `ApiError` with those codes.
   */
  async rewindChat(
    chatId: string,
    input: { turnId: string; scope?: RewindScope },
  ): Promise<RewindChatResult> {
    return apiFetch<RewindChatResult>(`${this.baseUrl}/api/chats/${chatId}/rewind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnId: input.turnId, scope: input.scope ?? 'all' }),
    });
  }

  /** Branch the conversation after a turn (default: the last one) into a new chat. */
  async forkChat(
    chatId: string,
    input: { turnId?: string; name?: string } = {},
  ): Promise<ForkChatResult> {
    return apiFetch<ForkChatResult>(`${this.baseUrl}/api/chats/${chatId}/fork`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(input.turnId ? { turnId: input.turnId } : {}),
        ...(input.name ? { name: input.name } : {}),
      }),
    });
  }

  async getChatMessages(chatId: string, limit?: number, offset?: number): Promise<ChatMessage[]> {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set('limit', String(limit));
    if (offset !== undefined) params.set('offset', String(offset));
    const qs = params.toString();
    return apiFetch<ChatMessage[]>(`${this.baseUrl}/api/chats/${chatId}/messages${qs ? `?${qs}` : ''}`);
  }

  /** Browser-specific: send chat prompt with actual File objects */
  async sendChatPromptWithFiles(
    chatId: string,
    prompt: string,
    files?: File[],
    mode?: AgentMode,
  ): Promise<void> {
    const formData = new FormData();
    formData.append('prompt', prompt);
    // PLN-01 — per-turn agent mode.
    if (mode) formData.append('mode', mode);

    if (files?.length) {
      for (const file of files) {
        formData.append('attachments', file, file.name);
      }
    }

    await apiFetch(`${this.baseUrl}/api/chats/${chatId}/prompt`, {
      method: 'POST',
      body: formData,
    });
  }

  // ── PLN-01: Plan mode ──

  async getChatPlans(chatId: string): Promise<PlanSummary[]> {
    return apiFetch<PlanSummary[]>(`${this.baseUrl}/api/chats/${chatId}/plans`);
  }

  async getChatPlan(chatId: string, planId: string): Promise<PlanDocument> {
    return apiFetch<PlanDocument>(`${this.baseUrl}/api/chats/${chatId}/plans/${planId}`);
  }

  async getChatPlanContent(
    chatId: string,
    planId: string,
    revision?: number,
  ): Promise<{ revision: number; content: string; summary: string; authoredBy: 'agent' | 'user' }> {
    const qs = revision !== undefined ? `?revision=${revision}` : '';
    return apiFetch(`${this.baseUrl}/api/chats/${chatId}/plans/${planId}/content${qs}`);
  }

  async updateChatPlanContent(
    chatId: string,
    planId: string,
    body: { content: string; summary?: string; expectedRevision: number },
  ): Promise<PlanRevision> {
    return apiFetch<PlanRevision>(`${this.baseUrl}/api/chats/${chatId}/plans/${planId}/content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async addChatPlanComment(
    chatId: string,
    planId: string,
    body: {
      body: string;
      revision: number;
      anchor?: { startLine: number; endLine: number; quotedText: string; contentHash: string };
    },
  ): Promise<PlanComment> {
    return apiFetch<PlanComment>(`${this.baseUrl}/api/chats/${chatId}/plans/${planId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async decideChatPlan(
    chatId: string,
    planId: string,
    decision: {
      approved: boolean;
      action?: PlanAction;
      feedback?: string;
      useEditedContent?: boolean;
      expectedRevision?: number;
    },
  ): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/chats/${chatId}/plans/${planId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(decision),
    });
  }

  async savePlanToWorkspace(chatId: string, planId: string): Promise<{ ok: boolean; path: string | null }> {
    return apiFetch(`${this.baseUrl}/api/chats/${chatId}/plans/${planId}/save-to-workspace`, {
      method: 'POST',
    });
  }

  async getChatInteractions(chatId: string): Promise<PendingInteraction[]> {
    return apiFetch<PendingInteraction[]>(`${this.baseUrl}/api/chats/${chatId}/interactions`);
  }

  async respondToChatInteraction(
    chatId: string,
    interactionId: string,
    response: { answers: Record<string, string[]>; freeformResponse?: string },
  ): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/chats/${chatId}/interactions/${interactionId}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    });
  }

  /**
   * Answer a blocking tool-permission prompt (review finding 5.1) — sibling
   * of {@link respondToChatInteraction}, same interaction resource, distinct
   * route (`ChatManagementService.buildPermissionHandler`'s answer route,
   * not the question/plan `/respond` route).
   */
  async respondToChatPermission(
    chatId: string,
    interactionId: string,
    response: { behavior: 'allow' | 'deny'; message?: string },
  ): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/chats/${chatId}/interactions/${interactionId}/permission`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    });
  }

  async setChatPermissionMode(
    chatId: string,
    mode: 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan',
  ): Promise<{ chatId: string; mode: string }> {
    return apiFetch(`${this.baseUrl}/api/chats/${chatId}/permission-mode`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
  }

  // ── Workflow definitions (v2 documents) ──

  async createDefinition(graph: WorkflowGraphInput): Promise<WorkflowDefinitionRecord> {
    return apiFetch<WorkflowDefinitionRecord>(`${this.baseUrl}/api/workflow-definitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(graph),
    });
  }

  /** Every definition: follows `nextCursor` across pages. */
  async listDefinitions(): Promise<WorkflowDefinitionSummary[]> {
    const items: WorkflowDefinitionSummary[] = [];
    let cursor: string | undefined;
    do {
      const qs = new URLSearchParams({ limit: '200' });
      if (cursor) qs.set('cursor', cursor);
      const page = await apiFetch<{ items: WorkflowDefinitionSummary[]; nextCursor?: string }>(
        `${this.baseUrl}/api/workflow-definitions?${qs.toString()}`,
      );
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return items;
  }

  async getDefinition(id: string): Promise<WorkflowDefinitionRecord> {
    return apiFetch<WorkflowDefinitionRecord>(`${this.baseUrl}/api/workflow-definitions/${id}`);
  }

  /** Replace the whole graph. A stale `expectedRevision` is a 409 `REVISION_CONFLICT` carrying the current record. */
  async saveDefinitionGraph(
    id: string,
    graph: WorkflowGraphInput,
    expectedRevision: number,
  ): Promise<WorkflowDefinitionRecord> {
    return apiFetch<WorkflowDefinitionRecord>(`${this.baseUrl}/api/workflow-definitions/${id}/graph`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph, expectedRevision }),
    });
  }

  async publishDefinition(id: string): Promise<WorkflowDefinitionRecord> {
    return apiFetch<WorkflowDefinitionRecord>(`${this.baseUrl}/api/workflow-definitions/${id}/publish`, {
      method: 'POST',
    });
  }

  /** The immutable version a run pinned (`run.definitionVersionId`). */
  async getDefinitionVersion(id: string, versionId: string): Promise<WorkflowDefinitionVersionRecord> {
    return apiFetch<WorkflowDefinitionVersionRecord>(
      `${this.baseUrl}/api/workflow-definitions/${id}/versions/${versionId}`,
    );
  }

  /** Hard delete, or archive when runs exist (their history stays readable). */
  async deleteDefinition(id: string): Promise<DefinitionDeleteOutcome> {
    return apiFetch<DefinitionDeleteOutcome>(`${this.baseUrl}/api/workflow-definitions/${id}`, { method: 'DELETE' });
  }

  /** Create a draft from a registered template. */
  async importTemplate(templateId: string, name?: string): Promise<WorkflowDefinitionRecord> {
    return apiFetch<WorkflowDefinitionRecord>(`${this.baseUrl}/api/workflow-definitions/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId, ...(name ? { name } : {}) }),
    });
  }

  /** Create a draft from a canonical workflow document (the export format). */
  async importDefinition(document: unknown): Promise<WorkflowDefinitionRecord> {
    return apiFetch<WorkflowDefinitionRecord>(`${this.baseUrl}/api/workflow-definitions/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(document),
    });
  }

  /** The canonical document text (`GET /:id/export`), exactly as the server wrote it. */
  async exportDefinition(id: string): Promise<string> {
    const resp = await getAuthRuntime().fetch(`${this.baseUrl}/api/workflow-definitions/${id}/export`);
    if (!resp.ok) throw new ApiError(resp.status, 'EXPORT_FAILED', `Export failed: ${resp.statusText}`);
    return resp.text();
  }

  // ── v2: Workflow Run Operations ──

  /**
   * THE way a run starts (P04): a definition, a script or a fork of an
   * earlier run. Files ride in the same request (multipart) and become the
   * run's uploads; the idempotency key makes a double click one run.
   */
  async invokeWorkflow(
    request: InvocationRequest,
    opts: { idempotencyKey?: string; files?: InvocationFiles } = {},
  ): Promise<InvocationResult> {
    const files = await uploadFiles(opts.files);
    return viaClientCore(
      this.admin.workflows.invoke(request, {
        ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
        ...(files ? { files } : {}),
      }),
    );
  }

  /** What `invokeWorkflow` would do (stages by layer, skips, codebases, phases), without writing anything. */
  async planWorkflowInvocation(request: InvocationRequest): Promise<InvocationPlan> {
    return viaClientCore(this.admin.workflows.plan(request));
  }

  async listRuns(filter?: { definitionId?: string; status?: string }): Promise<WorkflowRun[]> {
    const params = new URLSearchParams();
    if (filter?.definitionId) params.set('definitionId', filter.definitionId);
    if (filter?.status) params.set('status', filter.status);
    const qs = params.toString();
    return apiFetch<WorkflowRun[]>(`${this.baseUrl}/api/workflow-runs${qs ? `?${qs}` : ''}`);
  }

  async getRun(id: string): Promise<WorkflowRunWithStages> {
    return apiFetch<WorkflowRunWithStages>(`${this.baseUrl}/api/workflow-runs/${id}`);
  }

  async runCommand(runId: string, command: RunCommand): Promise<void> {
    // 202 `{runId, command}`; a refused command (409 invalid_state /
    // version_conflict, 404, 400) throws an ApiError the caller surfaces.
    await apiFetch(`${this.baseUrl}/api/workflow-runs/${runId}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    });
  }

  // ── A stage is a compact chat (P03b, the stage conversation API) ──

  /**
   * An operator message to a stage instance: queued between turns, an
   * amendment of a completed stage, a retry of a paused one. 409
   * `STAGE_BUSY` mid-turn and `INTERACTION_PENDING` on an open gate throw
   * an ApiError the caller surfaces.
   */
  async sendStageMessage(
    runId: string,
    instanceId: string,
    prompt: string,
    files?: File[],
    mode?: 'auto' | 'plan',
  ): Promise<{ outcome: 'queued' | 'amending' | 'retrying'; attachmentIds: string[] }> {
    const formData = new FormData();
    formData.append('prompt', prompt);
    if (mode) formData.append('mode', mode);
    for (const file of files ?? []) formData.append('attachments', file, file.name);
    return apiFetch(`${this.baseUrl}/api/workflow-runs/${runId}/instances/${instanceId}/messages`, {
      method: 'POST',
      body: formData,
    });
  }

  /** Stop the stage's turn in flight; the stage carries on. */
  async cancelStageTurn(runId: string, instanceId: string, options: { force?: boolean } = {}): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/workflow-runs/${runId}/instances/${instanceId}/turn/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
  }

  /** Answer a stage's in-turn gate, in the chat's body shapes. */
  async resolveStageInteraction(
    runId: string,
    instanceId: string,
    interactionId: string,
    answer:
      | { kind: 'permission'; behavior: 'allow' | 'deny'; message?: string }
      | { kind: 'answer'; answers: Record<string, string[]>; freeformResponse?: string }
      | { kind: 'plan'; approved: boolean; action?: 'exit_only' | 'implement_interactive' | 'implement_autopilot'; feedback?: string },
  ): Promise<void> {
    const { kind, ...body } = answer;
    await apiFetch(`${this.baseUrl}/api/workflow-runs/${runId}/instances/${instanceId}/interactions/${interactionId}/${kind}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async deleteRun(id: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/workflow-runs/${id}`, { method: 'DELETE' });
  }

  // ── HITL — permission mode (HITL-04) ──

  async getPermissionMode(
    runId: string,
  ): Promise<{ runId: string; mode: 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan' }> {
    return apiFetch(`${this.baseUrl}/api/workflow-runs/${runId}/permission-mode`);
  }

  async setPermissionMode(
    runId: string,
    mode: 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan',
  ): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/workflow-runs/${runId}/permission-mode`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
  }


  // ── Copilot-specific API calls (not in IPlatformClient but useful for web) ──

  async getModels(): Promise<ChatModel[]> {
    // Canonical catalog endpoint — provider-tagged, with prompt/total token
    // limits and reasoning-effort metadata. (`/api/copilot/models` is a
    // deprecated alias that returns the same merged list.)
    return apiFetch<ChatModel[]>(`${this.baseUrl}/api/harness/models`);
  }

  /** Active harness/agent provider. */
  async getHarnessConfig(): Promise<{ harness: { type: string } }> {
    return apiFetch<{ harness: { type: string } }>(`${this.baseUrl}/api/health/config`);
  }

  /** System health snapshot — connection heartbeat + live component status. */
  async getHealth(): Promise<SystemHealth> {
    return apiFetch<SystemHealth>(`${this.baseUrl}/api/health`);
  }

  async getCopilotState(): Promise<{ state: string }> {
    return apiFetch<{ state: string }>(`${this.baseUrl}/api/copilot/state`);
  }

  // ── Run workspace: the managed root, artifacts, uploads and every mount ──

  async getRunWorkspace(runId: string): Promise<RunWorkspaceInfo> {
    return (await viaClientCore(this.admin.runs.workspace(runId))) as unknown as RunWorkspaceInfo;
  }

  /**
   * Workspace file index — one `worktrees` entry per mount (in-place mounts
   * included), plus the managed scratch/plans files. `sourceFiles` is empty
   * since mounts replaced the `source/<alias>` layout.
   */
  async getWorkspaceFiles(workspaceId: string): Promise<WorkspaceFilesDto> {
    return apiFetch<WorkspaceFilesDto>(`${this.baseUrl}/api/workspaces/${workspaceId}/files`);
  }

  /** Get a file's content from a workspace */
  async getWorkspaceFileContent(workspaceId: string, filePath: string, source: 'workspace' | 'artifacts' | 'source' | 'worktree', worktreeAlias?: string): Promise<{ path: string; content: string | null; truncated: boolean; size: number }> {
    const params = new URLSearchParams({ path: filePath, source });
    if (source === 'worktree' && worktreeAlias) params.set('worktreeAlias', worktreeAlias);
    return apiFetch(`${this.baseUrl}/api/workspaces/${workspaceId}/files/content?${params}`);
  }

  async getRunFileContent(runId: string, filePath: string, source: 'workspace' | 'artifacts' | 'uploads' | 'worktree', worktreeAlias?: string): Promise<{ path: string; content: string | null; truncated: boolean; size: number }> {
    return viaClientCore(
      this.admin.runs.workspaceContent(runId, filePath, source, source === 'worktree' ? worktreeAlias : undefined),
    );
  }

  // ── Centralized change set + source control (workspace-scoped) ──

  /**
   * v2 change summary — per-file metadata only. File bodies are fetched
   * separately from `getWorkspaceChangeFile`, so this stays small no matter
   * how much the agent changed.
   *
   * `base` / `head` accept: 'baseline' | 'working' | 'checkpoint:<id>' |
   * 'turn:<turnId>' | 'stage:<stageRunId>' | 'ref:<rev>'.
   */
  async getWorkspaceChangeSummary(
    workspaceId: string,
    options: {
      base?: string;
      head?: string;
      alias?: string;
      includeTree?: boolean;
    } = {},
  ): Promise<ChangeSummary> {
    const params = new URLSearchParams();
    if (options.base) params.set('base', options.base);
    if (options.head) params.set('head', options.head);
    if (options.alias) params.set('alias', options.alias);
    if (options.includeTree) params.set('includeTree', 'true');
    const qs = params.toString();
    return apiFetch(
      `${this.baseUrl}/api/workspaces/${workspaceId}/changes${qs ? `?${qs}` : ''}`,
    );
  }

  // ── Per-file review (Keep / Undo) ──

  /**
   * Accept files ("Keep"), drop the acceptance, or accept everything.
   *
   * `blob` is the head blob the client is looking at (`''` for a deleted
   * file). The server stores that, not a flag, so an acceptance expires by
   * itself the moment the agent touches the file again.
   */
  async reviewWorkspaceChanges(
    workspaceId: string,
    body: {
      keep?: Array<ChangeFileRef & { blob: string }>;
      unkeep?: ChangeFileRef[];
      keepAll?: boolean;
    },
  ): Promise<ReviewChangesResult> {
    return apiFetch(`${this.baseUrl}/api/workspaces/${workspaceId}/changes/review`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Undo files. Each mount is restored from its OWN base, so this works on
   * every mount kind — including the ones whose base is a plain commit and
   * therefore had no discard action at all before.
   */
  async discardWorkspaceChanges(
    workspaceId: string,
    body: { files?: ChangeFileRef[]; all?: boolean },
  ): Promise<DiscardChangesResult> {
    return apiFetch(`${this.baseUrl}/api/workspaces/${workspaceId}/changes/discard`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /** Both versions of one changed file (enables expand-unchanged rendering). */
  async getWorkspaceChangeFile(
    workspaceId: string,
    filePath: string,
    options: {
      alias?: string;
      base?: string;
      head?: string;
      /**
       * Blob SHAs from the change summary. Optional, and purely a speed-up:
       * the server reads those two objects directly instead of re-deriving
       * them, which is several git subprocesses less per file.
       */
      oldBlob?: string | undefined;
      newBlob?: string | undefined;
      /** The file's path on the base side, for a rename. */
      oldPath?: string | undefined;
    } = {},
  ): Promise<ChangeFileVersions> {
    const params = new URLSearchParams({ path: filePath, form: 'versions' });
    if (options.alias) params.set('alias', options.alias);
    if (options.base) params.set('base', options.base);
    if (options.head) params.set('head', options.head);
    if (options.oldBlob) params.set('oldBlob', options.oldBlob);
    if (options.newBlob) params.set('newBlob', options.newBlob);
    if (options.oldPath) params.set('oldPath', options.oldPath);
    return apiFetch(`${this.baseUrl}/api/workspaces/${workspaceId}/changes/file?${params}`);
  }

  /** Unified patch for one file (used when the bodies are too large). */
  async getWorkspaceChangeFilePatch(
    workspaceId: string,
    filePath: string,
    options: { alias?: string; base?: string; head?: string; oldPath?: string } = {},
  ): Promise<ChangeFilePatch> {
    const params = new URLSearchParams({ path: filePath, form: 'patch' });
    if (options.alias) params.set('alias', options.alias);
    if (options.base) params.set('base', options.base);
    if (options.head) params.set('head', options.head);
    if (options.oldPath) params.set('oldPath', options.oldPath);
    return apiFetch(`${this.baseUrl}/api/workspaces/${workspaceId}/changes/file?${params}`);
  }

  // ── Workspace file tree (browsing, not diffing) ──

  /**
   * Every browsable path in the workspace, grouped by repo.
   *
   * Separate from the change summary on purpose: this list only moves when
   * files are created or deleted, so the Files view can switch between "all
   * files" and "changed only" without refetching a single diff.
   */
  async getWorkspaceTree(
    workspaceId: string,
    options: { alias?: string } = {},
  ): Promise<WorkspaceTree> {
    const params = new URLSearchParams();
    if (options.alias) params.set('alias', options.alias);
    const qs = params.toString();
    return apiFetch(`${this.baseUrl}/api/workspaces/${workspaceId}/tree${qs ? `?${qs}` : ''}`);
  }

  /** One file's current content — works for any tracked path, changed or not. */
  async getWorkspaceTreeFile(
    workspaceId: string,
    filePath: string,
    options: { alias?: string } = {},
  ): Promise<WorkspaceTreeFile> {
    const params = new URLSearchParams({ path: filePath });
    if (options.alias) params.set('alias', options.alias);
    return apiFetch(`${this.baseUrl}/api/workspaces/${workspaceId}/tree/file?${params}`);
  }

  // ── Checkpoints (snapshots / rewind) ──
  async listWorkspaceCheckpoints(
    workspaceId: string,
    options: { alias?: string; includeLive?: boolean; limit?: number } = {},
  ): Promise<{ workspaceId: string; checkpoints: CheckpointRecord[] }> {
    const params = new URLSearchParams();
    if (options.alias) params.set('alias', options.alias);
    if (options.includeLive) params.set('includeLive', 'true');
    if (options.limit) params.set('limit', String(options.limit));
    const qs = params.toString();
    return apiFetch(
      `${this.baseUrl}/api/workspaces/${workspaceId}/checkpoints${qs ? `?${qs}` : ''}`,
    );
  }

  async createWorkspaceCheckpoint(
    workspaceId: string,
    label?: string,
  ): Promise<{ workspaceId: string; checkpoints: CheckpointRecord[] }> {
    return apiFetch(`${this.baseUrl}/api/workspaces/${workspaceId}/checkpoints`, {
      method: 'POST',
      body: JSON.stringify({ label }),
    });
  }

  async restoreWorkspaceCheckpoint(
    workspaceId: string,
    checkpointId: string,
    paths?: string[],
    /**
     * Mount to restore. A checkpoint belongs to one mount; naming another
     * makes the server pick that mount's equivalent snapshot (same turn, or
     * its baseline), which is what a per-file discard on a second mount needs.
     */
    alias?: string,
  ): Promise<RestoreCheckpointResult> {
    return apiFetch(
      `${this.baseUrl}/api/workspaces/${workspaceId}/checkpoints/${checkpointId}/restore`,
      { method: 'POST', body: JSON.stringify({ ...(paths ? { paths } : {}), ...(alias ? { alias } : {}) }) },
    );
  }

  // ── Review threads (inline comments on diffs) ──

  async listReviewThreads(
    workspaceId: string,
    options: {
      scope?: string;
      scopeId?: string;
      path?: string;
      alias?: string;
      status?: string;
      all?: boolean;
    } = {},
  ): Promise<{ workspaceId: string; threads: ReviewThread[] }> {
    const params = new URLSearchParams();
    if (options.scope) params.set('scope', options.scope);
    if (options.scopeId) params.set('scopeId', options.scopeId);
    if (options.path) params.set('path', options.path);
    if (options.alias) params.set('alias', options.alias);
    if (options.status) params.set('status', options.status);
    if (options.all) params.set('all', 'true');
    const qs = params.toString();
    return apiFetch(
      `${this.baseUrl}/api/workspaces/${workspaceId}/review/threads${qs ? `?${qs}` : ''}`,
    );
  }

  async createReviewThread(
    workspaceId: string,
    input: CreateReviewThreadInput,
  ): Promise<ReviewThread> {
    return apiFetch(`${this.baseUrl}/api/workspaces/${workspaceId}/review/threads`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async addReviewComment(
    workspaceId: string,
    threadId: string,
    body: string,
    intent?: string,
  ): Promise<ReviewComment> {
    return apiFetch(
      `${this.baseUrl}/api/workspaces/${workspaceId}/review/threads/${threadId}/comments`,
      { method: 'POST', body: JSON.stringify({ body, intent }) },
    );
  }

  async updateReviewComment(
    workspaceId: string,
    threadId: string,
    commentId: string,
    body: string,
  ): Promise<ReviewThread> {
    return apiFetch(
      `${this.baseUrl}/api/workspaces/${workspaceId}/review/threads/${threadId}/comments/${commentId}`,
      { method: 'PATCH', body: JSON.stringify({ body }) },
    );
  }

  async updateReviewThreadStatus(
    workspaceId: string,
    threadId: string,
    status: ReviewThreadStatus,
  ): Promise<ReviewThread> {
    return apiFetch(
      `${this.baseUrl}/api/workspaces/${workspaceId}/review/threads/${threadId}`,
      { method: 'PATCH', body: JSON.stringify({ status }) },
    );
  }

  async deleteReviewThread(workspaceId: string, threadId: string): Promise<void> {
    await apiFetch(
      `${this.baseUrl}/api/workspaces/${workspaceId}/review/threads/${threadId}`,
      { method: 'DELETE' },
    );
  }

  /**
   * Serialise + deliver a batch of review threads to the agent.
   * `preview: true` returns the exact prompt without sending it.
   */
  async submitReview(
    workspaceId: string,
    input: {
      threadIds: string[];
      target: ReviewSubmitTarget;
      note?: string;
      preview?: boolean;
    },
  ): Promise<ReviewSubmitResult> {
    return apiFetch(`${this.baseUrl}/api/workspaces/${workspaceId}/review/submit`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  /** Legacy v1 change set (full diffs inline). Kept for back-compat. */
  async getWorkspaceChanges(workspaceId: string): Promise<{
    workspaceId: string;
    hasGit: boolean;
    repos: Array<{
      alias: string;
      kind: 'mount' | 'nested' | 'linked' | 'generated' | 'root';
      files: Array<{ path: string; status: string; diff: string }>;
    }>;
  }> {
    return apiFetch(`${this.baseUrl}/api/workspaces/${workspaceId}/changes?v=1`);
  }

  /** Old-vs-new content for a single changed file. */
  async getWorkspaceChangeContent(
    workspaceId: string,
    filePath: string,
    alias = '.',
  ): Promise<{ path: string; current: string | null; baseline: string | null }> {
    const params = new URLSearchParams({ path: filePath, alias });
    return apiFetch(`${this.baseUrl}/api/workspaces/${workspaceId}/changes/content?${params}`);
  }

  /** Open a pull request for a workspace's repo via the active provider. */
  async createWorkspacePullRequest(
    workspaceId: string,
    input: { title: string; body?: string; base?: string; head?: string; alias?: string; draft?: boolean },
  ): Promise<{ provider: string; number: number; url: string; title: string; state: string; head: string; base: string }> {
    return apiFetch(`${this.baseUrl}/api/workspaces/${workspaceId}/pull-request`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  /** List pull requests for a workspace's repo. */
  async listWorkspacePullRequests(
    workspaceId: string,
    alias = '.',
  ): Promise<{ provider: string; pullRequests: Array<{ number: number; url: string; title: string; state: string; head: string; base: string }> }> {
    const params = new URLSearchParams({ alias });
    return apiFetch(`${this.baseUrl}/api/workspaces/${workspaceId}/pull-requests?${params}`);
  }

  /** Commit all workspace changes. */
  async commitWorkspaceChanges(workspaceId: string, message?: string): Promise<{ committed: boolean }> {
    return apiFetch(`${this.baseUrl}/api/workspaces/${workspaceId}/commit`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  }

  // ── Source control provider config ──

  async getSourceControlConfig(): Promise<{
    activeProvider: 'github' | 'none';
    availableProviders: string[];
    github: { configured: boolean; host?: string; defaultBase?: string };
  }> {
    return apiFetch(`${this.baseUrl}/api/source-control/config`);
  }

  async updateSourceControlConfig(update: {
    activeProvider?: 'github' | 'none';
    github?: { token?: string | null; host?: string | null; defaultBase?: string | null };
  }): Promise<{
    activeProvider: 'github' | 'none';
    availableProviders: string[];
    github: { configured: boolean; host?: string; defaultBase?: string };
  }> {
    return apiFetch(`${this.baseUrl}/api/source-control/config`, {
      method: 'PUT',
      body: JSON.stringify(update),
    });
  }

  async getSourceControlStatus(): Promise<{ activeProvider: 'github' | 'none'; enabled: boolean }> {
    return apiFetch(`${this.baseUrl}/api/source-control/status`);
  }


  // ── Source control v2 — accounts, readiness, flow, PRs, editors ──
  //
  // Every path here is the contract in `.github/docs/feature-source-control.md`.
  // Tokens are write-only: they go up in `addSourceControlAccount` and never
  // come back in any response shape.

  /** Accounts + settings + which login methods and editors the server has. */
  async getSourceControlSettings(): Promise<ScmSettingsResponse> {
    return apiFetch(`${this.baseUrl}/api/source-control/settings`);
  }

  /** Patch the client-safe settings. Omitted keys are left untouched. */
  async updateSourceControlSettings(update: {
    defaultAccountId?: string | null;
    generation?: { provider: string | null; model: string | null };
    editor?: { defaultEditor: ScmEditorId | null };
    defaultBase?: string | null;
  }): Promise<ScmSettings> {
    return apiFetch(`${this.baseUrl}/api/source-control/settings`, {
      method: 'PUT',
      body: JSON.stringify(update),
    });
  }

  /** Connect an account by pasted token or by importing the `gh` CLI's. */
  async addSourceControlAccount(
    input:
      | { provider: 'github'; method: 'token'; token: string; host?: string; label?: string }
      | { provider: 'github'; method: 'gh-cli'; host?: string },
  ): Promise<ScmAccount> {
    return apiFetch(`${this.baseUrl}/api/source-control/accounts`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async removeSourceControlAccount(accountId: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/source-control/accounts/${encodeURIComponent(accountId)}`, {
      method: 'DELETE',
    });
  }

  /** Begin the OAuth device flow; the UI shows the code and polls below. */
  async startSourceControlDeviceLogin(
    input: { provider: 'github'; host?: string },
  ): Promise<ScmDeviceLoginStart> {
    return apiFetch(`${this.baseUrl}/api/source-control/accounts/device/start`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async getSourceControlDeviceLogin(loginId: string): Promise<ScmDeviceLoginStatus> {
    return apiFetch(
      `${this.baseUrl}/api/source-control/accounts/device/${encodeURIComponent(loginId)}`,
    );
  }

  /** Per-mount answer to "can I commit / push / open a PR here, and why not". */
  async getWorkspaceScmReadiness(
    workspaceId: string,
    alias?: string,
  ): Promise<ScmWorkspaceReadiness> {
    const qs = alias ? `?${new URLSearchParams({ alias })}` : '';
    return apiFetch(`${this.baseUrl}/api/workspaces/${workspaceId}/scm/readiness${qs}`);
  }

  /** The same shape for a project codebase's checkout. */
  async getCodebaseScmReadiness(projectId: string, codebaseId: string): Promise<ScmRepoReadiness> {
    return apiFetch(`${this.baseUrl}/api/projects/${projectId}/codebases/${codebaseId}/readiness`);
  }

  /** branch → commit → sync → push → pull request, in one call. */
  async runWorkspaceScmFlow(workspaceId: string, request: ScmFlowRequest): Promise<ScmFlowResult> {
    return apiFetch(`${this.baseUrl}/api/workspaces/${workspaceId}/scm/flow`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /** Commit message / PR title+body, written by the configured model. */
  async generateScmText(
    workspaceId: string,
    request: ScmGenerateRequest,
  ): Promise<ScmGenerateResult> {
    return apiFetch(`${this.baseUrl}/api/workspaces/${workspaceId}/scm/generate`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /** Apply the conflicting merge to the working tree so it can be edited. */
  async startScmConflictResolution(
    workspaceId: string,
    input: { alias?: string },
  ): Promise<ScmConflictActionResult> {
    // The server answers with the conflict report (no `ok` field); an HTTP
    // error is thrown by apiFetch, so reaching here means the merge started.
    const report = await apiFetch<{ files: string[]; mergeStarted: boolean }>(
      `${this.baseUrl}/api/workspaces/${workspaceId}/scm/conflicts/start`,
      { method: 'POST', body: JSON.stringify(input) },
    );
    return { ok: true, unmerged: report.files };
  }

  /** Verify nothing is unmerged and commit the merge. */
  async continueScmConflictResolution(
    workspaceId: string,
    input: { alias?: string },
  ): Promise<ScmConflictActionResult> {
    return apiFetch(`${this.baseUrl}/api/workspaces/${workspaceId}/scm/conflicts/continue`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  /** Hand the conflict to the chat's agent as a normal, watchable turn. */
  async resolveScmConflictWithAgent(
    workspaceId: string,
    input: { alias?: string; chatId: string },
  ): Promise<ScmConflictActionResult> {
    const sent = await apiFetch<{ chatId: string; files: string[] }>(
      `${this.baseUrl}/api/workspaces/${workspaceId}/scm/conflicts/resolve-with-agent`,
      { method: 'POST', body: JSON.stringify(input) },
    );
    return { ok: true, unmerged: sent.files };
  }

  /** `git merge --abort`. */
  async abortScmConflictResolution(
    workspaceId: string,
    input: { alias?: string },
  ): Promise<ScmConflictActionResult> {
    await apiFetch(`${this.baseUrl}/api/workspaces/${workspaceId}/scm/conflicts/abort`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return { ok: true };
  }

  /** Every open/closed PR across a project's codebases, plus the ones we
   *  could not reach and why. */
  async listProjectPullRequests(
    projectId: string,
    state: 'open' | 'closed' | 'all' = 'open',
  ): Promise<ScmProjectPullRequests> {
    const params = new URLSearchParams({ state });
    return apiFetch(`${this.baseUrl}/api/projects/${projectId}/pull-requests?${params}`);
  }

  async getPullRequest(
    projectId: string,
    codebaseId: string,
    number: number,
  ): Promise<ScmPullRequestDetail> {
    return apiFetch(
      `${this.baseUrl}/api/projects/${projectId}/codebases/${codebaseId}/pull-requests/${number}`,
    );
  }

  async getPullRequestFiles(
    projectId: string,
    codebaseId: string,
    number: number,
  ): Promise<ScmPullRequestFile[]> {
    return apiFetch(
      `${this.baseUrl}/api/projects/${projectId}/codebases/${codebaseId}/pull-requests/${number}/files`,
    );
  }

  async getPullRequestComments(
    projectId: string,
    codebaseId: string,
    number: number,
  ): Promise<ScmPullRequestComment[]> {
    return apiFetch(
      `${this.baseUrl}/api/projects/${projectId}/codebases/${codebaseId}/pull-requests/${number}/comments`,
    );
  }

  /** Create a chat on the PR's head branch, seeded with the review prompt. */
  async createPullRequestReviewChat(
    projectId: string,
    codebaseId: string,
    number: number,
    input: { instructions?: string; model?: string; agentRef?: string },
  ): Promise<{ chat: Chat }> {
    return apiFetch(
      `${this.baseUrl}/api/projects/${projectId}/codebases/${codebaseId}/pull-requests/${number}/review-chat`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  }

  /** Editors the SERVER host can launch, plus their URL scheme for the
   *  browser-side fallback when it cannot. */
  async listEditors(): Promise<ScmEditorInfo[]> {
    return apiFetch(`${this.baseUrl}/api/editor/editors`);
  }

  async openInEditor(request: ScmOpenInEditorRequest): Promise<ScmOpenInEditorResult> {
    return apiFetch(`${this.baseUrl}/api/editor/open`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /** Agent-native source-control options on an existing chat. */
  async updateChatSourceControl(
    chatId: string,
    sourceControl: ChatSourceControlOptions | null,
  ): Promise<Chat> {
    return apiFetch(`${this.baseUrl}/api/chats/${chatId}`, {
      method: 'PATCH',
      body: JSON.stringify({ sourceControl }),
    });
  }

  // ── Automation API ──

  async createAutomation(params: CreateAutomationParams): Promise<Automation> {
    return apiFetch<Automation>(`${this.baseUrl}/api/automations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async listAutomations(): Promise<Automation[]> {
    return apiFetch<Automation[]>(`${this.baseUrl}/api/automations`);
  }

  async getAutomation(id: string): Promise<AutomationWithExecutions> {
    return apiFetch<AutomationWithExecutions>(`${this.baseUrl}/api/automations/${id}`);
  }

  async updateAutomation(id: string, params: UpdateAutomationParams): Promise<Automation> {
    return apiFetch<Automation>(`${this.baseUrl}/api/automations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async deleteAutomation(id: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/automations/${id}`, { method: 'DELETE' });
  }

  async enableAutomation(id: string): Promise<Automation> {
    return apiFetch<Automation>(`${this.baseUrl}/api/automations/${id}/enable`, { method: 'POST' });
  }

  async disableAutomation(id: string): Promise<Automation> {
    return apiFetch<Automation>(`${this.baseUrl}/api/automations/${id}/disable`, { method: 'POST' });
  }

  async triggerAutomation(
    id: string,
    body?: TriggerAutomationBody,
    opts?: { idempotencyKey?: string },
  ): Promise<AutomationExecution> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts?.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    return apiFetch<AutomationExecution>(`${this.baseUrl}/api/automations/${id}/trigger`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body ?? {}),
    });
  }

  /** Track C — preview iteration expansion without creating an execution. */
  async previewAutomationIterations(body: {
    dataSchema: unknown;
    iterationMode: unknown;
    dataset: unknown;
  }): Promise<{
    iterations: Array<{ variables: Record<string, unknown>; label: string }>;
    totalIterations: number;
    parsedRowCount: number;
    warnings: string[];
  }> {
    return apiFetch(`${this.baseUrl}/api/automations/preview-iterations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async getAutomationExecutions(automationId: string): Promise<AutomationExecution[]> {
    return apiFetch<AutomationExecution[]>(`${this.baseUrl}/api/automations/${automationId}/executions`);
  }

  async getAutomationExecution(automationId: string, executionId: string): Promise<AutomationExecutionWithRuns> {
    return apiFetch<AutomationExecutionWithRuns>(`${this.baseUrl}/api/automations/${automationId}/executions/${executionId}`);
  }

  async cancelAutomationExecution(automationId: string, executionId: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/automations/${automationId}/executions/${executionId}/cancel`, { method: 'POST' });
  }

  // ── Project Management API ──

  async createProject(params: { name: string; description?: string; settings?: Partial<ProjectSettings> }): Promise<Project> {
    return apiFetch<Project>(`${this.baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async listProjects(): Promise<Project[]> {
    // Return every project (active + archived). Consumers that only allow
    // active projects (pickers, chat/workflow/automation) filter client-side;
    // the Projects list shows all so archived ones can be re-activated.
    return apiFetch<Project[]>(`${this.baseUrl}/api/projects`);
  }

  async getProject(id: string): Promise<Project> {
    return apiFetch<Project>(`${this.baseUrl}/api/projects/${id}`);
  }

  async updateProject(id: string, params: { name?: string; description?: string; settings?: Partial<ProjectSettings>; status?: 'active' | 'archived' }): Promise<Project> {
    return apiFetch<Project>(`${this.baseUrl}/api/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async deleteProject(id: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/projects/${id}?force=true`, { method: 'DELETE' });
  }

  // ── Project Codebase API ──

  async linkCodebase(projectId: string, params: {
    alias: string;
    type: CodebaseType;
    url?: string;
    localPath?: string;
    defaultBranch?: string;
    subdirectory?: string;
    settings?: Partial<CodebaseSettings>;
  }): Promise<ProjectCodebase> {
    return apiFetch<ProjectCodebase>(`${this.baseUrl}/api/projects/${projectId}/codebases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async listCodebases(projectId: string): Promise<ProjectCodebase[]> {
    return apiFetch<ProjectCodebase[]>(`${this.baseUrl}/api/projects/${projectId}/codebases`);
  }

  async updateCodebase(projectId: string, codebaseId: string, params: {
    defaultBranch?: string;
    subdirectory?: string;
    settings?: Partial<CodebaseSettings>;
  }): Promise<ProjectCodebase> {
    return apiFetch<ProjectCodebase>(`${this.baseUrl}/api/projects/${projectId}/codebases/${codebaseId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async unlinkCodebase(projectId: string, codebaseId: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/projects/${projectId}/codebases/${codebaseId}`, { method: 'DELETE' });
  }

  async fetchCodebase(projectId: string, codebaseId: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/projects/${projectId}/codebases/${codebaseId}/fetch`, { method: 'POST' });
  }

  async getCodebaseBranches(projectId: string, codebaseId: string): Promise<string[]> {
    return apiFetch<string[]>(`${this.baseUrl}/api/projects/${projectId}/codebases/${codebaseId}/branches`);
  }

  // ── Project Config API ──

  async uploadProjectConfig(projectId: string, type: ConfigType, file: File): Promise<ProjectConfig> {
    const formData = new FormData();
    formData.append('type', type);
    formData.append('file', file);
    // Derive name and filePath from the file
    const fileName = (file as any).webkitRelativePath || file.name;
    formData.append('name', fileName.replace(/\.[^.]+$/, ''));
    formData.append('filePath', fileName);
    return apiFetch<ProjectConfig>(`${this.baseUrl}/api/projects/${projectId}/configs`, {
      method: 'POST',
      body: formData,
    });
  }

  async listProjectConfigs(projectId: string, type?: ConfigType): Promise<ProjectConfig[]> {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    const qs = params.toString();
    return apiFetch<ProjectConfig[]>(`${this.baseUrl}/api/projects/${projectId}/configs${qs ? `?${qs}` : ''}`);
  }

  async deleteProjectConfig(projectId: string, configId: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/projects/${projectId}/configs/${configId}`, { method: 'DELETE' });
  }

  async getProjectConfigContent(projectId: string, configId: string): Promise<string> {
    const result = await apiFetch<{ content: string }>(`${this.baseUrl}/api/projects/${projectId}/configs/${configId}`);
    return result.content;
  }

  async updateProjectConfigContent(projectId: string, configId: string, content: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/projects/${projectId}/configs/${configId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  }

  // ── Project MCP Servers ──
  async listProjectMcpServers(projectId: string): Promise<any[]> {
    return apiFetch<any[]>(`${this.baseUrl}/api/projects/${projectId}/mcp-servers`);
  }

  async createProjectMcpServer(projectId: string, data: { name: string; description?: string; serverType: string; url?: string; command?: string; args?: string[] }): Promise<any> {
    return apiFetch<any>(`${this.baseUrl}/api/projects/${projectId}/mcp-servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  async deleteProjectMcpServer(projectId: string, serverId: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/projects/${projectId}/mcp-servers/${serverId}`, { method: 'DELETE' });
  }

  // ── System MCP Servers ──
  // Bundled catalog + custom (Settings → MCP Servers) servers, merged and
  // redacted server-side (ArtifactCatalog + toMcpServerEntry — W48).
  async listSystemMcpServers(): Promise<any[]> {
    return apiFetch<any[]>(`${this.baseUrl}/api/system/mcp-servers`);
  }

  /** Per-bundled-server prefs: on/off, `{{input}}` values, credentials. */
  async updateSystemMcpServerPrefs(
    id: string,
    data: { enabled?: boolean; inputs?: Record<string, string>; headers?: Record<string, string>; env?: Record<string, string> },
  ): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/system/mcp-servers/system/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  async createCustomMcpServer(data: {
    name: string; description?: string; serverType: string; url?: string; command?: string; args?: string[];
    timeoutMs?: number; headers?: Record<string, string>; env?: Record<string, string>;
  }): Promise<any> {
    return apiFetch<any>(`${this.baseUrl}/api/system/mcp-servers/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  async updateCustomMcpServer(id: string, data: {
    name: string; description?: string; serverType: string; url?: string; command?: string; args?: string[];
    timeoutMs?: number; enabled?: boolean; headers?: Record<string, string>; env?: Record<string, string>;
  }): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/system/mcp-servers/custom/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  async deleteCustomMcpServer(id: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/system/mcp-servers/custom/${id}`, { method: 'DELETE' });
  }

  // ── Agents API ──
  // Reading needs `read:workflows`; authoring needs `admin:settings`
  // (see packages/auth/src/routePolicy.ts → prefix '/agents').

  async listAgents(filter?: {
    scope?: AgentScope;
    role?: AgentRole;
    projectId?: string;
    q?: string;
    enabledOnly?: boolean;
  }): Promise<Agent[]> {
    const params = new URLSearchParams();
    if (filter?.scope) params.set('scope', filter.scope);
    if (filter?.role) params.set('role', filter.role);
    if (filter?.projectId) params.set('projectId', filter.projectId);
    if (filter?.q) params.set('q', filter.q);
    if (filter?.enabledOnly) params.set('enabledOnly', '1');
    const qs = params.toString();
    return apiFetch<Agent[]>(`${this.baseUrl}/api/agents${qs ? `?${qs}` : ''}`);
  }

  /** Picker list: a project agent shadows a global one with the same slug. */
  async listSelectableAgents(projectId?: string): Promise<Agent[]> {
    const params = new URLSearchParams({ selectable: '1' });
    if (projectId) params.set('projectId', projectId);
    return apiFetch<Agent[]>(`${this.baseUrl}/api/agents?${params.toString()}`);
  }

  async getAgent(id: string): Promise<Agent> {
    return apiFetch<Agent>(`${this.baseUrl}/api/agents/${encodeURIComponent(id)}`);
  }

  async createAgent(params: CreateAgentParams): Promise<Agent & { warnings?: ResolutionWarning[] }> {
    return apiFetch<Agent & { warnings?: ResolutionWarning[] }>(`${this.baseUrl}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async updateAgent(
    id: string,
    params: UpdateAgentParams,
  ): Promise<Agent & { warnings?: ResolutionWarning[] }> {
    return apiFetch<Agent & { warnings?: ResolutionWarning[] }>(
      `${this.baseUrl}/api/agents/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      },
    );
  }

  /** Without `force` the server answers 409 when the agent is still bound. */
  async deleteAgent(id: string, force = false): Promise<{ deleted: boolean; soft: boolean }> {
    return apiFetch<{ deleted: boolean; soft: boolean }>(
      `${this.baseUrl}/api/agents/${encodeURIComponent(id)}${force ? '?force=1' : ''}`,
      { method: 'DELETE' },
    );
  }

  /**
   * Where the agent is bound. Returns the ENTITIES, not counts — the delete
   * dialog needs to name what will be affected, and a bare number cannot.
   */
  async getAgentUsage(id: string): Promise<AgentUsageResponse> {
    return apiFetch<AgentUsageResponse>(`${this.baseUrl}/api/agents/${encodeURIComponent(id)}/usage`);
  }

  async exportAgent(id: string): Promise<string> {
    const result = await apiFetch<{ markdown: string }>(
      `${this.baseUrl}/api/agents/${encodeURIComponent(id)}/export`,
      { method: 'POST' },
    );
    return result.markdown;
  }

  async importAgent(params: {
    markdown: string;
    scope?: AgentScope;
    projectId?: string;
    overwrite?: boolean;
  }): Promise<Agent & { warnings?: ResolutionWarning[] }> {
    return apiFetch<Agent & { warnings?: ResolutionWarning[] }>(`${this.baseUrl}/api/agents/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  /**
   * Effective capabilities for a binding (or an unsaved draft). The response is
   * redacted server-side — MCP `env`/`headers` never reach the browser.
   */
  async resolveAgentPreview(body: {
    agentRef?: string;
    overrides?: AgentOverrides;
    projectId?: string;
    harnessType?: HarnessProviderId;
    scope: 'chat' | 'stage' | 'worker';
    draft?: Record<string, unknown>;
  }): Promise<ResolvedAgentProjection> {
    return apiFetch<ResolvedAgentProjection>(`${this.baseUrl}/api/agents/resolve-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  // ── Project Worktree API ──

  async listWorktrees(projectId: string): Promise<WorktreeInfo[]> {
    return apiFetch<WorktreeInfo[]>(`${this.baseUrl}/api/projects/${projectId}/worktrees`);
  }

  async removeWorktree(projectId: string, worktreeId: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/projects/${projectId}/worktrees/${worktreeId}`, { method: 'DELETE' });
  }

  async cleanupWorktrees(projectId: string): Promise<{ cleaned: number }> {
    return apiFetch<{ cleaned: number }>(`${this.baseUrl}/api/projects/${projectId}/worktrees/cleanup`, { method: 'POST' });
  }

  // ── System Artifacts API ──
  async listSystemArtifacts(type?: string): Promise<any[]> {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    const qs = params.toString();
    return apiFetch<any[]>(`${this.baseUrl}/api/system/artifacts${qs ? `?${qs}` : ''}`);
  }

  async getSystemArtifactContent(id: string): Promise<string> {
    const result = await apiFetch<{ content: string }>(`${this.baseUrl}/api/system/artifacts/${encodeURIComponent(id)}`);
    return result.content;
  }

  // ── Computer Use enablement ──
  async getComputerUseSettings(): Promise<ComputerUseSettings> {
    return apiFetch<ComputerUseSettings>(`${this.baseUrl}/api/system/computer-use`);
  }

  async setComputerUseEnabled(enabled: boolean, allowSynthetic?: boolean): Promise<ComputerUseSettings> {
    return apiFetch<ComputerUseSettings>(`${this.baseUrl}/api/system/computer-use`, {
      method: 'PUT',
      body: JSON.stringify({ enabled, ...(allowSynthetic === undefined ? {} : { allowSynthetic }) }),
    });
  }

  // ── Audio (STT / TTS) ──
  async getAudioSettings(): Promise<AudioSettings> {
    return apiFetch<AudioSettings>(`${this.baseUrl}/api/system/audio`);
  }

  async setAudioSettings(patch: Partial<AudioSettings>): Promise<AudioSettings> {
    return apiFetch<AudioSettings>(`${this.baseUrl}/api/system/audio`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
  }

  async getSpeechModelStatus(): Promise<SpeechModelStatus> {
    return apiFetch<SpeechModelStatus>(`${this.baseUrl}/api/system/audio/model`);
  }

  async downloadSpeechModel(): Promise<SpeechModelStatus> {
    return apiFetch<SpeechModelStatus>(`${this.baseUrl}/api/system/audio/model`, { method: 'POST', body: '{}' });
  }

  async deleteSpeechModel(): Promise<SpeechModelStatus> {
    return apiFetch<SpeechModelStatus>(`${this.baseUrl}/api/system/audio/model`, { method: 'DELETE' });
  }

  // ── Workspace retention (nightly cleanup) ──
  async getWorkspaceRetention(): Promise<WorkspaceRetentionSettings> {
    return apiFetch<WorkspaceRetentionSettings>(`${this.baseUrl}/api/system/workspace-retention`);
  }

  async setWorkspaceRetention(
    enabled: boolean,
    retentionDays?: number,
  ): Promise<WorkspaceRetentionSettings> {
    return apiFetch<WorkspaceRetentionSettings>(`${this.baseUrl}/api/system/workspace-retention`, {
      method: 'PUT',
      body: JSON.stringify({ enabled, ...(retentionDays === undefined ? {} : { retentionDays }) }),
    });
  }

  async runWorkspaceRetention(retentionDays?: number): Promise<WorkspaceRetentionRunResult> {
    return apiFetch<WorkspaceRetentionRunResult>(
      `${this.baseUrl}/api/system/workspace-retention/run`,
      {
        method: 'POST',
        body: JSON.stringify(retentionDays === undefined ? {} : { retentionDays }),
      },
    );
  }

  async getComputerRuntime(workspaceId: string): Promise<ComputerRuntime> {
    return apiFetch<ComputerRuntime>(
      `${this.baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/computer/runtime`,
    );
  }

  async controlComputerRuntime(
    workspaceId: string,
    action: 'start' | 'restart' | 'stop',
  ): Promise<ComputerRuntime> {
    return apiFetch<ComputerRuntime>(
      `${this.baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/computer/runtime`,
      { method: 'POST', body: JSON.stringify({ action }) },
    );
  }

  // ── Available Artifacts (system + project merged) ──
  async listAvailableArtifacts(projectId: string, type?: string): Promise<any[]> {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    const qs = params.toString();
    return apiFetch<any[]>(`${this.baseUrl}/api/projects/${projectId}/available-artifacts${qs ? `?${qs}` : ''}`);
  }

  // ── Codebase-level Worktree API ──
  async listCodebaseWorktrees(projectId: string, codebaseId: string): Promise<any[]> {
    return apiFetch<any[]>(`${this.baseUrl}/api/projects/${projectId}/codebases/${codebaseId}/worktrees`);
  }

  async removeCodebaseWorktree(projectId: string, codebaseId: string, worktreeId: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/projects/${projectId}/codebases/${codebaseId}/worktrees/${worktreeId}`, { method: 'DELETE' });
  }

  async cleanupCodebaseWorktrees(projectId: string, codebaseId: string): Promise<{ cleaned: number }> {
    return apiFetch<{ cleaned: number }>(`${this.baseUrl}/api/projects/${projectId}/codebases/${codebaseId}/worktrees/cleanup`, { method: 'POST' });
  }

  // ── Codebase File Browser API ──
  async listCodebaseFiles(projectId: string, codebaseId: string, subPath?: string): Promise<any[]> {
    const params = new URLSearchParams();
    if (subPath) params.set('path', subPath);
    const qs = params.toString();
    return apiFetch<any[]>(`${this.baseUrl}/api/projects/${projectId}/codebases/${codebaseId}/files${qs ? `?${qs}` : ''}`);
  }

  async getCodebaseFileContent(projectId: string, codebaseId: string, filePath: string): Promise<string> {
    const params = new URLSearchParams({ path: filePath });
    const result = await apiFetch<{ content: string }>(`${this.baseUrl}/api/projects/${projectId}/codebases/${codebaseId}/files/content?${params.toString()}`);
    return result.content;
  }

  // ── Workflow Scripts API ──

  async listScripts(): Promise<any[]> {
    return apiFetch<any[]>(`${this.baseUrl}/api/workflow-scripts`);
  }

  async getScript(id: string): Promise<any> {
    return apiFetch<any>(`${this.baseUrl}/api/workflow-scripts/${id}`);
  }

  async getScriptProfiles(id: string): Promise<any[]> {
    return apiFetch<any[]>(`${this.baseUrl}/api/workflow-scripts/${id}/profiles`);
  }

  async materializeScript(id: string, options?: { name?: string; projectId?: string; variables?: Record<string, unknown> }): Promise<any> {
    return apiFetch<any>(`${this.baseUrl}/api/workflow-scripts/${id}/materialize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options ?? {}),
    });
  }

  async reloadScripts(): Promise<{ count: number; scripts: any[] }> {
    return apiFetch<{ count: number; scripts: any[] }>(`${this.baseUrl}/api/workflow-scripts/reload`, { method: 'POST' });
  }

  async reloadScript(id: string): Promise<any> {
    return apiFetch<any>(`${this.baseUrl}/api/workflow-scripts/${id}/reload`, { method: 'POST' });
  }

  // SCRIPT-1: upload a user-authored .workflow.mjs. Server-gated behind
  // GENERATORAI_ALLOW_SCRIPT_UPLOAD (returns 403 when disabled).
  async uploadScript(filename: string, source: string): Promise<any> {
    return apiFetch<any>(`${this.baseUrl}/api/workflow-scripts/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, source }),
    });
  }

  async validateScript(filePath: string): Promise<{ valid: boolean; errors: string[] }> {
    return apiFetch<{ valid: boolean; errors: string[] }>(`${this.baseUrl}/api/workflow-scripts/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath }),
    });
  }

  // ════════════════════════════════════════════════════════════════
  // CLI↔Web parity — methods that hit existing server endpoints but were
  // previously CLI-only. Typed loosely (consistent with the script helpers
  // above) so the web client has feature parity at the client layer.
  // ════════════════════════════════════════════════════════════════

  // PARITY-3: workspace lifecycle management (archive / commit / delete / cleanup).
  async listWorkspaces(filters?: Record<string, string>): Promise<any[]> {
    const qs = filters && Object.keys(filters).length ? `?${new URLSearchParams(filters)}` : '';
    return apiFetch<any[]>(`${this.baseUrl}/api/workspaces${qs}`);
  }
  async getWorkspace(id: string): Promise<any> {
    return apiFetch<any>(`${this.baseUrl}/api/workspaces/${id}`);
  }
  /** The same document as `getWorkspace`, typed around its mounts. */
  async getWorkspaceInfo(id: string): Promise<WorkspaceInfoDto> {
    return apiFetch<WorkspaceInfoDto>(`${this.baseUrl}/api/workspaces/${id}`);
  }
  async archiveWorkspace(id: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/workspaces/${id}/archive`, { method: 'POST' });
  }
  async commitWorkspace(id: string, message?: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/workspaces/${id}/commit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }),
    });
  }
  async deleteWorkspace(id: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/workspaces/${id}`, { method: 'DELETE' });
  }
  async cleanupWorkspaces(retentionHours?: number, maxDiskMb?: number): Promise<Record<string, unknown>> {
    return apiFetch<Record<string, unknown>>(`${this.baseUrl}/api/workspaces/cleanup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retentionHours, maxDiskMb }),
    });
  }

  // PARITY-8: hook phase listing + dry-run hook testing.
  async listHookPhases(): Promise<any[]> {
    return apiFetch<any[]>(`${this.baseUrl}/api/hooks/phases`);
  }
  async testHook(sessionId: string, phase: string, payload?: Record<string, unknown>): Promise<Record<string, unknown>> {
    return apiFetch<Record<string, unknown>>(`${this.baseUrl}/api/hooks/sessions/${sessionId}/hooks/test`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phase, payload }),
    });
  }

  // PARITY-9: rotate an automation's webhook token.
  async rotateWebhookToken(automationId: string): Promise<{ token: string }> {
    return apiFetch<{ token: string }>(`${this.baseUrl}/api/automations/${automationId}/rotate-webhook-token`, {
      method: 'POST',
    });
  }
}
