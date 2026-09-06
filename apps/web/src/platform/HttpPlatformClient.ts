// ────────────────────────────────────────────────────────────────
// HttpPlatformClient — Web platform IPlatformClient implementation
// Communicates with the server via REST + SSE
// ────────────────────────────────────────────────────────────────

import type {
  IPlatformClient,
  PlatformType,
  WorkflowTemplateSummary,
  EventSubscriptionOptions,
} from '@generatorai/shared';
import type { Session, SessionWithWorkflows } from '@generatorai/shared';
import type { Workflow } from '@generatorai/shared';
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

/** Response of `GET /api/agents/:id/usage`. */
export interface AgentUsageResponse {
  chats: Array<{ id: string; name: string }>;
  stages: Array<{ id: string; name: string; workflowDefinitionId: string }>;
  workflows: Array<{ id: string; name: string }>;
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
import type { CreateSessionParams } from '@generatorai/shared';
import type { PersistedEvent, AgentEventKind } from '@generatorai/shared';
import type {
  Chat,
  CreateChatParams,
  WorkflowDefinition,
  WorkflowDefinitionWithStages,
  CreateWorkflowDefinitionParams,
  WorkflowRun,
  WorkflowRunWithStages,
  CreateWorkflowRunParams,
  StageDefinition,
  StageEdge,
  StageRun,
  CreateStageParams,
  CreateEdgeParams,
  ImportWorkflowJson,
  WorkflowTemplate,
  OrchestratorContext,
  RunWorkspaceInfo,
  RunUploadResult,
  RunScratchpad,
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
  ChangeFileVersions,
  ChangeFilePatch,
  CheckpointRecord,
  RestoreCheckpointResult,
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
import { downloadBlobAsFile } from '../utils/downloadBlobAsFile.js';

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

export class HttpPlatformClient implements IPlatformClient {
  readonly platform: PlatformType = 'web';
  readonly baseUrl: string;

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

  // ── Session CRUD ──

  async createSession(params: CreateSessionParams): Promise<Session> {
    return apiFetch<Session>(`${this.baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async getSession(sessionId: string): Promise<SessionWithWorkflows> {
    return apiFetch<SessionWithWorkflows>(`${this.baseUrl}/api/sessions/${sessionId}`);
  }

  async getSessions(filter?: { status?: string }): Promise<Session[]> {
    const params = new URLSearchParams();
    if (filter?.status) params.set('status', filter.status);
    const qs = params.toString();
    return apiFetch<Session[]>(`${this.baseUrl}/api/sessions${qs ? `?${qs}` : ''}`);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/sessions/${sessionId}`, { method: 'DELETE' });
  }

  // ── Session Control ──

  async startSession(sessionId: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/sessions/${sessionId}/start`, { method: 'POST' });
  }

  async pauseSession(sessionId: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/sessions/${sessionId}/pause`, { method: 'POST' });
  }

  async resumeSession(sessionId: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/sessions/${sessionId}/resume`, { method: 'POST' });
  }

  async cancelSession(sessionId: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/sessions/${sessionId}/cancel`, { method: 'POST' });
  }

  // ── Workflow Control ──

  async getWorkflows(sessionId: string): Promise<Workflow[]> {
    return apiFetch<Workflow[]>(`${this.baseUrl}/api/sessions/${sessionId}/workflows`);
  }

  async pauseWorkflow(workflowId: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/workflows/${workflowId}/pause`, { method: 'POST' });
  }

  async resumeWorkflow(workflowId: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/workflows/${workflowId}/resume`, { method: 'POST' });
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

  async getWorkflowTemplates(): Promise<WorkflowTemplateSummary[]> {
    return apiFetch<WorkflowTemplateSummary[]>(`${this.baseUrl}/api/templates`);
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

  /** Stop the in-flight turn for a chat (aborts the SDK conversation). */
  async cancelChat(chatId: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/chats/${chatId}/cancel`, { method: 'POST' });
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

  // ── v2: Workflow Definition Operations ──

  async createDefinition(params: CreateWorkflowDefinitionParams): Promise<WorkflowDefinition> {
    return apiFetch<WorkflowDefinition>(`${this.baseUrl}/api/workflow-definitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async listDefinitions(): Promise<WorkflowDefinition[]> {
    return apiFetch<WorkflowDefinition[]>(`${this.baseUrl}/api/workflow-definitions`);
  }

  async getDefinition(id: string): Promise<WorkflowDefinitionWithStages> {
    return apiFetch<WorkflowDefinitionWithStages>(`${this.baseUrl}/api/workflow-definitions/${id}`);
  }

  async updateDefinition(id: string, params: Partial<CreateWorkflowDefinitionParams>): Promise<WorkflowDefinition> {
    return apiFetch<WorkflowDefinition>(`${this.baseUrl}/api/workflow-definitions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async deleteDefinition(id: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/workflow-definitions/${id}`, { method: 'DELETE' });
  }

  async validateDefinition(id: string): Promise<{ valid: boolean; errors: string[] }> {
    return apiFetch<{ valid: boolean; errors: string[] }>(
      `${this.baseUrl}/api/workflow-definitions/${id}/validate`,
      { method: 'POST' },
    );
  }

  async importFromTemplate(templateId: string): Promise<WorkflowDefinition> {
    return apiFetch<WorkflowDefinition>(`${this.baseUrl}/api/workflow-definitions/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId }),
    });
  }

  async importFromJSON(data: ImportWorkflowJson): Promise<WorkflowDefinitionWithStages> {
    return apiFetch<WorkflowDefinitionWithStages>(`${this.baseUrl}/api/workflow-definitions/import-json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  // ── v2: Workflow Run Operations ──

  async createRun(params: CreateWorkflowRunParams): Promise<WorkflowRun> {
    return apiFetch<WorkflowRun>(`${this.baseUrl}/api/workflow-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
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

  async startRun(id: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/workflow-runs/${id}/start`, { method: 'POST' });
  }

  async pauseRun(id: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/workflow-runs/${id}/pause`, { method: 'POST' });
  }

  async resumeRun(id: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/workflow-runs/${id}/resume`, { method: 'POST' });
  }

  async cancelRun(id: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/workflow-runs/${id}/cancel`, { method: 'POST' });
  }

  async deleteRun(id: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/workflow-runs/${id}`, { method: 'DELETE' });
  }

  // PARITY-1: run-level retry (re-runs a failed run from `failed → created`).
  async retryRun(id: string): Promise<{ runId: string }> {
    // The response carries the NEW run's id; callers navigate to it.
    const res = await apiFetch<{ runId: string }>(
      `${this.baseUrl}/api/workflow-runs/${id}/retry`,
      { method: 'POST' },
    );
    return { runId: res?.runId ?? id };
  }

  // ── PARITY-2: true per-stage controls ──
  // These hit the dedicated /stages/:stageId/{pause,resume,retry,cancel}
  // endpoints (handled by StageExecutionService), so pausing/retrying ONE
  // stage no longer cascades to the whole run (the prior web behaviour wired
  // these to run-level mutations). Matches the CLI's stage controls.
  async pauseStageRun(runId: string, stageId: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/workflow-runs/${runId}/stages/${stageId}/pause`, { method: 'POST' });
  }

  async resumeStageRun(runId: string, stageId: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/workflow-runs/${runId}/stages/${stageId}/resume`, { method: 'POST' });
  }

  async wakeStageRun(runId: string, stageId: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/workflow-runs/${runId}/stages/${stageId}/wake`, { method: 'POST' });
  }

  async retryStageRun(runId: string, stageId: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/workflow-runs/${runId}/stages/${stageId}/retry`, { method: 'POST' });
  }

  async cancelStageRun(runId: string, stageId: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/workflow-runs/${runId}/stages/${stageId}/cancel`, { method: 'POST' });
  }

  // ── HITL — permission mode + resume (HITL-04/05) ──

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

  async listPendingInterrupts(runId: string): Promise<StageRun[]> {
    return apiFetch(`${this.baseUrl}/api/workflow-runs/${runId}/pending-interrupts`);
  }

  /**
   * Read the on-disk scratchpad for a run. This is where each stage's
   * full output text (or structured JSON) is aggregated, keyed by
   * `stageRunId`. Returns `{ entries: [] }` for runs that haven't
   * written any output yet.
   */
  async getRunScratchpad(runId: string): Promise<RunScratchpad> {
    return apiFetch(`${this.baseUrl}/api/workflow-runs/${runId}/scratchpad`);
  }

  async resumeStage(
    runId: string,
    stageId: string,
    resolution: {
      /**
       * Tri-state verdict. `rejected` is terminal — it fails the stage and
       * blocks every downstream stage. Omit to fall back to `approved`.
       */
      outcome?: 'approved' | 'changes_requested' | 'rejected';
      approved: boolean;
      value?: unknown;
      reason?: string;
      followUpPrompt?: string;
    },
  ): Promise<{ ok: boolean; reason?: string }> {
    // Server returns 200 `{ok:true}` on success and 409 on lost races.
    // Catch the 409 and surface it as a business outcome so the HitlPanel
    // can display the reason rather than a generic error toast.
    //
    // NB: Uses /approve (HITL approval) rather than /resume (pause/resume).
    // Two routes existed at the same path; HITL was renamed to /approve
    // so Express routing picks the correct handler unambiguously.
    try {
      const body = await apiFetch<{ ok?: boolean; reason?: string } | undefined>(
        `${this.baseUrl}/api/workflow-runs/${runId}/stages/${stageId}/approve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(resolution),
        },
      );
      return { ok: body?.ok ?? true, reason: body?.reason };
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        return { ok: false, reason: err.message };
      }
      throw err;
    }
  }

  // ── v2: Stage CRUD (nested under workflow definitions) ──

  async addStage(definitionId: string, params: Omit<CreateStageParams, 'workflowDefinitionId'>): Promise<StageDefinition> {
    return apiFetch<StageDefinition>(`${this.baseUrl}/api/workflow-definitions/${definitionId}/stages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async updateStage(definitionId: string, stageId: string, params: Partial<Omit<CreateStageParams, 'workflowDefinitionId'>>): Promise<StageDefinition> {
    return apiFetch<StageDefinition>(`${this.baseUrl}/api/workflow-definitions/${definitionId}/stages/${stageId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async deleteStage(definitionId: string, stageId: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/workflow-definitions/${definitionId}/stages/${stageId}`, { method: 'DELETE' });
  }

  // ── v2: Edge CRUD (nested under workflow definitions) ──

  async addEdge(definitionId: string, params: Omit<CreateEdgeParams, 'workflowDefinitionId'>): Promise<StageEdge> {
    return apiFetch<StageEdge>(`${this.baseUrl}/api/workflow-definitions/${definitionId}/edges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async deleteEdge(definitionId: string, edgeId: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/workflow-definitions/${definitionId}/edges/${edgeId}`, { method: 'DELETE' });
  }

  // ── Copilot-specific API calls (not in IPlatformClient but useful for web) ──

  async getModels(): Promise<ChatModel[]> {
    // Canonical catalog endpoint — provider-tagged, with prompt/total token
    // limits and reasoning-effort metadata. (`/api/copilot/models` is a
    // deprecated alias that returns the same merged list.)
    return apiFetch<ChatModel[]>(`${this.baseUrl}/api/harness/models`);
  }

  /** Active harness/agent provider ('copilot' | 'claude-agent' | …). */
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

  // ── Orchestrator API ──

  async getOrchestratorTemplates(): Promise<WorkflowTemplate[]> {
    return apiFetch<WorkflowTemplate[]>(`${this.baseUrl}/api/orchestrator/system-workflows`);
  }

  async getOrchestratorTemplate(id: string): Promise<WorkflowTemplate> {
    return apiFetch<WorkflowTemplate>(`${this.baseUrl}/api/orchestrator/system-workflows/${id}`);
  }

  async createFromTemplate(
    templateId: string,
    params?: { name?: string; variables?: Record<string, unknown>; projectId?: string },
  ): Promise<WorkflowDefinition> {
    return apiFetch<WorkflowDefinition>(`${this.baseUrl}/api/orchestrator/from-template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId, ...params }),
    });
  }

  async startOrchestratedRun(params: {
    workflowDefinitionId: string;
    variables?: Record<string, unknown>;
    projectId?: string;
    selectedCodebases?: string[];
    stageOverrides?: Array<{ stageName?: string; stageIndex?: number; agentName?: string; contextFilter?: string; timeoutMs?: number; variables?: Record<string, unknown>; skip?: boolean }>;
  }): Promise<OrchestratorContext> {
    return apiFetch<OrchestratorContext>(`${this.baseUrl}/api/orchestrator/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async getOrchestratorContext(runId: string): Promise<OrchestratorContext> {
    return apiFetch<OrchestratorContext>(`${this.baseUrl}/api/orchestrator/runs/${runId}/context`);
  }

  async cancelOrchestratedRun(runId: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/orchestrator/runs/${runId}/cancel`, { method: 'POST' });
  }

  async getRunWorkspace(runId: string): Promise<RunWorkspaceInfo> {
    return apiFetch<RunWorkspaceInfo>(`${this.baseUrl}/api/orchestrator/runs/${runId}/workspace`);
  }

  /** Get workspace files listing by workspace ID (used by chat files panel) */
  async getWorkspaceFiles(workspaceId: string): Promise<{
    workspaceId: string;
    rootPath: string;
    workspaceFiles: string[];
    artifactFiles: string[];
    sourceFiles: string[];
    worktrees: Array<{ alias: string; worktreePath: string; files: string[] }>;
  }> {
    return apiFetch(`${this.baseUrl}/api/workspaces/${workspaceId}/files`);
  }

  /** Get a file's content from a workspace */
  async getWorkspaceFileContent(workspaceId: string, filePath: string, source: 'workspace' | 'artifacts' | 'source' | 'worktree', worktreeAlias?: string): Promise<{ path: string; content: string | null; truncated: boolean; size: number }> {
    const params = new URLSearchParams({ path: filePath, source });
    if (source === 'worktree' && worktreeAlias) params.set('worktreeAlias', worktreeAlias);
    return apiFetch(`${this.baseUrl}/api/workspaces/${workspaceId}/files/content?${params}`);
  }

  async uploadRunFiles(runId: string, category: 'skills' | 'agents' | 'prompts', files: File[]): Promise<RunUploadResult> {
    const formData = new FormData();
    formData.append('category', category);
    for (const file of files) {
      formData.append('files', file);
    }
    return apiFetch<RunUploadResult>(`${this.baseUrl}/api/orchestrator/runs/${runId}/uploads`, {
      method: 'POST',
      body: formData,
    });
  }

  async downloadRunFile(runId: string, filePath: string, source: 'workspace' | 'artifacts' | 'uploads' | 'worktree', worktreeAlias?: string): Promise<void> {
    const params = new URLSearchParams({ path: filePath, source });
    if (source === 'worktree' && worktreeAlias) params.set('worktreeAlias', worktreeAlias);
    const url = `${this.baseUrl}/api/orchestrator/runs/${runId}/workspace/download?${params}`;
    const resp = await getAuthRuntime().fetch(url);
    if (!resp.ok) throw new ApiError(resp.status, 'DOWNLOAD_FAILED', `Download failed: ${resp.statusText}`);
    const blob = await resp.blob();
    await downloadBlobAsFile(blob, filePath.split(/[/\\]/).pop() ?? 'download');
  }

  async getRunFileContent(runId: string, filePath: string, source: 'workspace' | 'artifacts' | 'uploads' | 'worktree', worktreeAlias?: string): Promise<{ path: string; content: string | null; truncated: boolean; size: number }> {
    const params = new URLSearchParams({ path: filePath, source });
    if (source === 'worktree' && worktreeAlias) params.set('worktreeAlias', worktreeAlias);
    return apiFetch(`${this.baseUrl}/api/orchestrator/runs/${runId}/workspace/content?${params}`);
  }

  async getRunDiff(runId: string): Promise<{
    hasGit: boolean;
    repos: Array<{
      alias: string;
      files: Array<{ path: string; status: string; diff: string }>;
    }>;
  }> {
    return apiFetch(`${this.baseUrl}/api/orchestrator/runs/${runId}/workspace/diff`);
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
    } = {},
  ): Promise<ChangeFileVersions> {
    const params = new URLSearchParams({ path: filePath, form: 'versions' });
    if (options.alias) params.set('alias', options.alias);
    if (options.base) params.set('base', options.base);
    if (options.head) params.set('head', options.head);
    if (options.oldBlob) params.set('oldBlob', options.oldBlob);
    if (options.newBlob) params.set('newBlob', options.newBlob);
    return apiFetch(`${this.baseUrl}/api/workspaces/${workspaceId}/changes/file?${params}`);
  }

  /** Unified patch for one file (used when the bodies are too large). */
  async getWorkspaceChangeFilePatch(
    workspaceId: string,
    filePath: string,
    options: { alias?: string; base?: string; head?: string } = {},
  ): Promise<ChangeFilePatch> {
    const params = new URLSearchParams({ path: filePath, form: 'patch' });
    if (options.alias) params.set('alias', options.alias);
    if (options.base) params.set('base', options.base);
    if (options.head) params.set('head', options.head);
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
  ): Promise<RestoreCheckpointResult> {
    return apiFetch(
      `${this.baseUrl}/api/workspaces/${workspaceId}/checkpoints/${checkpointId}/restore`,
      { method: 'POST', body: JSON.stringify(paths ? { paths } : {}) },
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
      kind: 'linked' | 'generated' | 'root';
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

  // ── Workflow-Level File Management ──

  async getWorkflowFiles(definitionId: string): Promise<{ definitionId: string; uploadsDir: string; files: string[] }> {
    return apiFetch(`${this.baseUrl}/api/orchestrator/workflows/${definitionId}/files`);
  }

  async uploadWorkflowFiles(definitionId: string, category: 'skills' | 'agents' | 'prompts', files: File[]): Promise<void> {
    const formData = new FormData();
    formData.append('category', category);
    for (const file of files) {
      formData.append('files', file);
    }
    await apiFetch(`${this.baseUrl}/api/orchestrator/workflows/${definitionId}/uploads`, {
      method: 'POST',
      body: formData,
    });
  }

  async deleteWorkflowFile(definitionId: string, filePath: string): Promise<void> {
    const params = new URLSearchParams({ path: filePath });
    await apiFetch(`${this.baseUrl}/api/orchestrator/workflows/${definitionId}/files?${params}`, {
      method: 'DELETE',
    });
  }

  async downloadWorkflowFile(definitionId: string, filePath: string): Promise<void> {
    const params = new URLSearchParams({ path: filePath });
    const url = `${this.baseUrl}/api/orchestrator/workflows/${definitionId}/files/download?${params}`;
    const resp = await getAuthRuntime().fetch(url);
    if (!resp.ok) throw new ApiError(resp.status, 'DOWNLOAD_FAILED', `Download failed: ${resp.statusText}`);
    const blob = await resp.blob();
    await downloadBlobAsFile(blob, filePath.split(/[/\\]/).pop() ?? 'download');
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
    harnessType?: 'copilot' | 'claude-agent';
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

  async runScript(id: string, options?: { profileName?: string; variables?: Record<string, unknown>; projectId?: string }): Promise<any> {
    return apiFetch<any>(`${this.baseUrl}/api/workflow-scripts/${id}/run`, {
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

  // PARITY-12: export a definition as portable JSON (web could re-derive, but
  // the dedicated endpoint preserves the canonical export shape).
  async exportDefinition(id: string): Promise<Record<string, unknown>> {
    return apiFetch<Record<string, unknown>>(`${this.baseUrl}/api/workflow-definitions/${id}/export`);
  }

  // PARITY-3: workspace lifecycle management (archive / commit / delete / cleanup).
  async listWorkspaces(filters?: Record<string, string>): Promise<any[]> {
    const qs = filters && Object.keys(filters).length ? `?${new URLSearchParams(filters)}` : '';
    return apiFetch<any[]>(`${this.baseUrl}/api/workspaces${qs}`);
  }
  async getWorkspace(id: string): Promise<any> {
    return apiFetch<any>(`${this.baseUrl}/api/workspaces/${id}`);
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

  // PARITY-4: webhook registration management.
  async listWebhookRegistrations(): Promise<any[]> {
    return apiFetch<any[]>(`${this.baseUrl}/api/webhooks/registrations`);
  }
  async createWebhookRegistration(params: Record<string, unknown>): Promise<any> {
    return apiFetch<any>(`${this.baseUrl}/api/webhooks/registrations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
    });
  }
  async deleteWebhookRegistration(id: string): Promise<void> {
    await apiFetch(`${this.baseUrl}/api/webhooks/registrations/${id}`, { method: 'DELETE' });
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
