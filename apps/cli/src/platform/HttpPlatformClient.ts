// HttpPlatformClient — REST + SSE client for the GeneratorAI server.
// Built fresh against the server's 105+ API endpoints.

import { EventSource } from 'eventsource';
import type {
  IPlatformClient,
  PlatformType,
  EventSubscriptionOptions,
  WorkflowTemplateSummary,
  Session,
  SessionWithWorkflows,
  Workflow,
  ChatMessage,
  Artifact,
  CreateSessionParams,
  PersistedEvent,
  Chat,
  CreateChatParams,
  WorkflowDefinition,
  WorkflowDefinitionWithStages,
  CreateWorkflowDefinitionParams,
  WorkflowRun,
  WorkflowRunWithStages,
  CreateWorkflowRunParams,
  StageRun,
  StageDefinition,
  StageEdge,
  CreateStageParams,
  CreateEdgeParams,
  ImportWorkflowJson,
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
  ConfigType,
  WorkflowTemplate,
  OrchestratedRunParams,
  OrchestratorContext,
  RunWorkspaceInfo,
  WorkspaceInfo,
  WorkspaceFilters,
  ArtifactWithSource,
  McpServerEntry,
  FileEntry,
  DataSourceTestResult,
  WebhookRegistration,
  Agent,
  AgentOverrides,
  CreateAgentParams,
  UpdateAgentParams,
  ResolvedAgentProjection,
} from '@generatorai/shared';

import {
  ApiError,
  type CLIPlatformClient,
  type SSEScope,
  type SSESubscriptionOptions,
  type ReplayResult,
  type AgentUsageResponse,
} from './types.js';
import { withRetry } from '../utils/retry.js';
import { getCliAuthRuntime } from './authRuntime.js';

// ── Auth ─────────────────────────────────────────────────────────
//
// Every request goes through the shared `AuthenticatedClientRuntime`, which
// signs it with this installation's device key (DPoP) and refreshes the
// access token transparently. `GENERATORAI_API_KEY` still works and is passed
// through as a legacy bearer credential.
//
// The runtime is resolved lazily per base URL because the CLI can be pointed
// at a different server with `--server` on any invocation.

function legacyApiKey(): string | undefined {
  return process.env['GENERATORAI_API_KEY'];
}

/** Base URL of the server the *current* command is talking to. */
let activeEndpoint = 'http://localhost:3100';

function runtime(): ReturnType<typeof getCliAuthRuntime> {
  return getCliAuthRuntime({
    endpoint: activeEndpoint,
    legacyApiKey: legacyApiKey(),
    profile: process.env['GENERATORAI_PROFILE'],
  });
}

// ── Generic fetch wrapper ────────────────────────────────────────

async function apiFetch<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await runtime().fetch(url, init ?? {});

  if (!response.ok) {
    let code = 'UNKNOWN';
    let message = response.statusText;
    try {
      const body = (await response.json()) as Record<string, unknown>;
      const errField = body['error'];
      if (typeof errField === 'object' && errField !== null) {
        const errObj = errField as Record<string, unknown>;
        code = (errObj['code'] as string) ?? (body['code'] as string) ?? code;
        message = (errObj['message'] as string) ?? message;
      } else {
        code = (body['code'] as string) ?? code;
        message = (errField as string) ?? (body['message'] as string) ?? message;
      }
    } catch { /* use statusText */ }
    throw new ApiError(response.status, code, message);
  }

  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/** apiFetch with automatic retry on 429/5xx */
function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  return withRetry(() => apiFetch<T>(url, init));
}

function jsonBody(data: unknown): { headers: Record<string, string>; body: string } {
  return {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ── Client Implementation ────────────────────────────────────────

export class HttpPlatformClient implements CLIPlatformClient {
  readonly platform: PlatformType = 'cli';
  readonly baseUrl: string;

  constructor(baseUrl = 'http://localhost:3100') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    // The module-level auth runtime follows whichever server this client was
    // constructed for. One CLI invocation only ever targets one server.
    activeEndpoint = this.baseUrl;
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  // ── Lifecycle ──

  async initialize(): Promise<void> {
    await api(this.url('/api/health'));
  }

  async shutdown(): Promise<void> { /* no-op for HTTP client */ }

  // ── Session CRUD ──

  async createSession(params: CreateSessionParams): Promise<Session> {
    return api<Session>(this.url('/api/sessions'), { method: 'POST', ...jsonBody(params) });
  }

  async getSession(sessionId: string): Promise<SessionWithWorkflows> {
    return api<SessionWithWorkflows>(this.url(`/api/sessions/${sessionId}`));
  }

  async getSessions(filter?: { status?: string }): Promise<Session[]> {
    return api<Session[]>(this.url(`/api/sessions${qs({ status: filter?.status })}`));
  }

  async deleteSession(sessionId: string): Promise<void> {
    await api(this.url(`/api/sessions/${sessionId}`), { method: 'DELETE' });
  }

  // ── Session Control ──

  async startSession(sessionId: string): Promise<void> {
    await api(this.url(`/api/sessions/${sessionId}/start`), { method: 'POST' });
  }

  async pauseSession(sessionId: string): Promise<void> {
    await api(this.url(`/api/sessions/${sessionId}/pause`), { method: 'POST' });
  }

  async resumeSession(sessionId: string): Promise<void> {
    await api(this.url(`/api/sessions/${sessionId}/resume`), { method: 'POST' });
  }

  async cancelSession(sessionId: string): Promise<void> {
    await api(this.url(`/api/sessions/${sessionId}/cancel`), { method: 'POST' });
  }

  // ── Workflow Control ──

  async getWorkflows(sessionId: string): Promise<Workflow[]> {
    return api<Workflow[]>(this.url(`/api/sessions/${sessionId}/workflows`));
  }

  async pauseWorkflow(workflowId: string): Promise<void> {
    await api(this.url(`/api/workflows/${workflowId}/pause`), { method: 'POST' });
  }

  async resumeWorkflow(workflowId: string): Promise<void> {
    await api(this.url(`/api/workflows/${workflowId}/resume`), { method: 'POST' });
  }

  // ── Chat (v1 session-based) ──

  async sendPrompt(
    sessionId: string,
    prompt: string,
    attachments?: Array<{ type: 'file'; path: string; displayName?: string }>,
  ): Promise<void> {
    const body: Record<string, unknown> = { prompt };
    if (attachments?.length) body['attachments'] = attachments;
    await api(this.url(`/api/sessions/${sessionId}/prompt`), { method: 'POST', ...jsonBody(body) });
  }

  async getChatHistory(sessionId: string, limit?: number, offset?: number, stageRunId?: string): Promise<ChatMessage[]> {
    return api<ChatMessage[]>(this.url(`/api/sessions/${sessionId}/chat${qs({ limit, offset, stageRunId })}`));
  }

  // ── Templates ──

  async getWorkflowTemplates(): Promise<WorkflowTemplateSummary[]> {
    return api<WorkflowTemplateSummary[]>(this.url('/api/templates'));
  }

  async getTemplate(id: string): Promise<Record<string, unknown>> {
    return api<Record<string, unknown>>(this.url(`/api/templates/${id}`));
  }

  // ── Workflow Scripts ──

  async listScripts(): Promise<Array<Record<string, unknown>>> {
    return api<Array<Record<string, unknown>>>(this.url('/api/workflow-scripts'));
  }

  async getScript(id: string): Promise<Record<string, unknown>> {
    return api<Record<string, unknown>>(this.url(`/api/workflow-scripts/${id}`));
  }

  async getScriptProfiles(id: string): Promise<Array<Record<string, unknown>>> {
    return api<Array<Record<string, unknown>>>(this.url(`/api/workflow-scripts/${id}/profiles`));
  }

  async materializeScript(id: string, params?: { name?: string; projectId?: string; variables?: Record<string, unknown> }): Promise<Record<string, unknown>> {
    return api<Record<string, unknown>>(this.url(`/api/workflow-scripts/${id}/materialize`), {
      method: 'POST',
      ...jsonBody(params ?? {}),
    });
  }

  async runScript(id: string, params?: { profileName?: string; variables?: Record<string, unknown>; projectId?: string }): Promise<{ definitionId: string; runId: string; status: string }> {
    return api<{ definitionId: string; runId: string; status: string }>(this.url(`/api/workflow-scripts/${id}/run`), {
      method: 'POST',
      ...jsonBody(params ?? {}),
    });
  }

  async reloadScripts(): Promise<{ count: number; scripts: Array<Record<string, unknown>> }> {
    return api<{ count: number; scripts: Array<Record<string, unknown>> }>(this.url('/api/workflow-scripts/reload'), {
      method: 'POST',
    });
  }

  async reloadScript(id: string): Promise<Record<string, unknown>> {
    return api<Record<string, unknown>>(this.url(`/api/workflow-scripts/${id}/reload`), {
      method: 'POST',
    });
  }

  async validateScript(path: string): Promise<{ valid: boolean; errors: string[] }> {
    return api<{ valid: boolean; errors: string[] }>(this.url('/api/workflow-scripts/validate'), {
      method: 'POST',
      ...jsonBody({ path }),
    });
  }

  // SCRIPT-1: upload a user-authored .workflow.mjs (server-gated behind
  // GENERATORAI_ALLOW_SCRIPT_UPLOAD; 403 when disabled).
  async uploadScript(filename: string, source: string): Promise<Record<string, unknown>> {
    return api<Record<string, unknown>>(this.url('/api/workflow-scripts/upload'), {
      method: 'POST',
      ...jsonBody({ filename, source }),
    });
  }

  // ── Artifacts ──

  async getArtifacts(sessionId: string): Promise<Artifact[]> {
    return api<Artifact[]>(this.url(`/api/sessions/${sessionId}/artifacts`));
  }

  async downloadArtifact(artifactId: string): Promise<{ data: Buffer; mimeType: string; name: string }> {
    const response = await runtime().fetch(this.url(`/api/artifacts/${artifactId}/download`));
    if (!response.ok) throw new ApiError(response.status, 'DOWNLOAD_FAILED', 'Failed to download artifact');
    const mimeType = response.headers.get('content-type') ?? 'application/octet-stream';
    const disposition = response.headers.get('content-disposition');
    const nameMatch = disposition?.match(/filename="?([^";\n]+)"?/);
    const name = nameMatch?.[1] ?? artifactId;
    const arrayBuffer = await response.arrayBuffer();
    return { data: Buffer.from(arrayBuffer), mimeType, name };
  }

  // ── Event Subscription (SSE) — legacy session-scoped ──

  subscribeToEvents(
    sessionId: string,
    handler: (event: PersistedEvent) => void,
    options?: EventSubscriptionOptions,
  ): () => void {
    return this.subscribeToStream('session', sessionId, handler, {
      afterSequence: options?.afterSequence,
      filter: options?.kindPrefixes,
    });
  }

  async selectDirectory(): Promise<string | null> {
    return process.cwd();
  }

  // ── v2: Chat Operations ──

  async createChat(params: CreateChatParams): Promise<Chat> {
    return api<Chat>(this.url('/api/chats'), { method: 'POST', ...jsonBody(params) });
  }

  async listChats(filter?: { status?: string }): Promise<Chat[]> {
    return api<Chat[]>(this.url(`/api/chats${qs({ status: filter?.status })}`));
  }

  async getChat(chatId: string): Promise<Chat> {
    return api<Chat>(this.url(`/api/chats/${chatId}`));
  }

  async updateChat(chatId: string, updates: Partial<Pick<Chat, 'model' | 'harnessConfig'>>): Promise<Chat> {
    return api<Chat>(this.url(`/api/chats/${chatId}`), { method: 'PATCH', ...jsonBody(updates) });
  }

  async archiveChat(chatId: string): Promise<void> {
    await api(this.url(`/api/chats/${chatId}`), { method: 'DELETE' });
  }

  async deleteChat(chatId: string): Promise<void> {
    await api(this.url(`/api/chats/${chatId}`), { method: 'DELETE' });
  }

  async sendChatPrompt(
    chatId: string,
    prompt: string,
    attachments?: Array<{ type: 'file'; path: string; displayName?: string }>,
  ): Promise<void> {
    const body: Record<string, unknown> = { prompt };
    if (attachments?.length) body['attachments'] = attachments;
    await api(this.url(`/api/chats/${chatId}/prompt`), { method: 'POST', ...jsonBody(body) });
  }

  async getChatMessages(chatId: string, limit?: number, offset?: number): Promise<ChatMessage[]> {
    return api<ChatMessage[]>(this.url(`/api/chats/${chatId}/messages${qs({ limit, offset })}`));
  }

  // ── v2: Workflow Definition Operations ──

  async createDefinition(params: CreateWorkflowDefinitionParams): Promise<WorkflowDefinition> {
    return api<WorkflowDefinition>(this.url('/api/workflow-definitions'), { method: 'POST', ...jsonBody(params) });
  }

  async listDefinitions(): Promise<WorkflowDefinition[]> {
    return api<WorkflowDefinition[]>(this.url('/api/workflow-definitions'));
  }

  async getDefinition(id: string): Promise<WorkflowDefinitionWithStages> {
    return api<WorkflowDefinitionWithStages>(this.url(`/api/workflow-definitions/${id}`));
  }

  async updateDefinition(id: string, params: Partial<CreateWorkflowDefinitionParams>): Promise<WorkflowDefinition> {
    return api<WorkflowDefinition>(this.url(`/api/workflow-definitions/${id}`), { method: 'PATCH', ...jsonBody(params) });
  }

  async deleteDefinition(id: string): Promise<void> {
    await api(this.url(`/api/workflow-definitions/${id}`), { method: 'DELETE' });
  }

  async validateDefinition(id: string): Promise<{ valid: boolean; errors: string[] }> {
    return api<{ valid: boolean; errors: string[] }>(this.url(`/api/workflow-definitions/${id}/validate`), { method: 'POST' });
  }

  async importFromTemplate(templateId: string, name?: string): Promise<WorkflowDefinition> {
    return api<WorkflowDefinition>(this.url('/api/workflow-definitions/import'), {
      method: 'POST', ...jsonBody({ templateId, name }),
    });
  }

  async importFromJSON(data: ImportWorkflowJson): Promise<WorkflowDefinitionWithStages> {
    return api<WorkflowDefinitionWithStages>(this.url('/api/workflow-definitions/import-json'), {
      method: 'POST', ...jsonBody(data),
    });
  }

  async exportDefinition(id: string): Promise<Record<string, unknown>> {
    return api<Record<string, unknown>>(this.url(`/api/workflow-definitions/${id}/export`));
  }

  // ── Stage CRUD ──

  async addStage(defId: string, params: Omit<CreateStageParams, 'workflowDefinitionId'>): Promise<StageDefinition> {
    return api<StageDefinition>(this.url(`/api/workflow-definitions/${defId}/stages`), { method: 'POST', ...jsonBody(params) });
  }

  async updateStage(defId: string, stageId: string, params: Partial<Omit<CreateStageParams, 'workflowDefinitionId'>>): Promise<StageDefinition> {
    return api<StageDefinition>(this.url(`/api/workflow-definitions/${defId}/stages/${stageId}`), { method: 'PUT', ...jsonBody(params) });
  }

  async deleteStage(defId: string, stageId: string): Promise<void> {
    await api(this.url(`/api/workflow-definitions/${defId}/stages/${stageId}`), { method: 'DELETE' });
  }

  // ── Edge CRUD ──

  async addEdge(defId: string, params: Omit<CreateEdgeParams, 'workflowDefinitionId'>): Promise<StageEdge> {
    return api<StageEdge>(this.url(`/api/workflow-definitions/${defId}/edges`), { method: 'POST', ...jsonBody(params) });
  }

  async deleteEdge(defId: string, edgeId: string): Promise<void> {
    await api(this.url(`/api/workflow-definitions/${defId}/edges/${edgeId}`), { method: 'DELETE' });
  }

  // ── v2: Workflow Run Operations ──

  async createRun(params: CreateWorkflowRunParams): Promise<WorkflowRun> {
    return api<WorkflowRun>(this.url('/api/workflow-runs'), { method: 'POST', ...jsonBody(params) });
  }

  async listRuns(filter?: { definitionId?: string; status?: string }): Promise<WorkflowRun[]> {
    return api<WorkflowRun[]>(this.url(`/api/workflow-runs${qs({ definitionId: filter?.definitionId, status: filter?.status })}`));
  }

  async getRun(id: string): Promise<WorkflowRunWithStages> {
    return api<WorkflowRunWithStages>(this.url(`/api/workflow-runs/${id}`));
  }

  async startRun(id: string): Promise<void> {
    await api(this.url(`/api/workflow-runs/${id}/start`), { method: 'POST' });
  }

  async pauseRun(id: string): Promise<void> {
    await api(this.url(`/api/workflow-runs/${id}/pause`), { method: 'POST' });
  }

  async resumeRun(id: string): Promise<void> {
    await api(this.url(`/api/workflow-runs/${id}/resume`), { method: 'POST' });
  }

  async cancelRun(id: string): Promise<void> {
    await api(this.url(`/api/workflow-runs/${id}/cancel`), { method: 'POST' });
  }

  async deleteRun(id: string): Promise<void> {
    await api(this.url(`/api/workflow-runs/${id}`), { method: 'DELETE' });
  }

  async retryRun(id: string): Promise<void> {
    await api(this.url(`/api/workflow-runs/${id}/retry`), { method: 'POST' });
  }

  async getRunStages(runId: string): Promise<StageRun[]> {
    return api<StageRun[]>(this.url(`/api/workflow-runs/${runId}/stages`));
  }

  // ── HITL ──

  async getPermissionMode(runId: string): Promise<{ runId: string; mode: 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan' }> {
    return api(this.url(`/api/workflow-runs/${runId}/permission-mode`));
  }

  async setPermissionMode(runId: string, mode: 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan'): Promise<void> {
    await api(this.url(`/api/workflow-runs/${runId}/permission-mode`), { method: 'PATCH', ...jsonBody({ mode }) });
  }

  async listPendingInterrupts(runId: string): Promise<StageRun[]> {
    return api<StageRun[]>(this.url(`/api/workflow-runs/${runId}/pending-interrupts`));
  }

  async resumeStage(
    runId: string,
    stageId: string,
    resolution: { approved: boolean; value?: unknown; reason?: string },
  ): Promise<{ ok: boolean; reason?: string }> {
    // API-1: HITL approval must hit /approve (which feeds the resolution back
    // to the awaiting stage via hitlService.resume), NOT /resume (pause/resume,
    // which ignores the body entirely). Pause/resume has its own method
    // (resumeStageRun). This reconciles the web↔CLI divergence: both clients'
    // HITL resume now targets the same /approve endpoint.
    try {
      const body = await api<{ ok?: boolean; reason?: string }>(
        this.url(`/api/workflow-runs/${runId}/stages/${stageId}/approve`),
        { method: 'POST', ...jsonBody(resolution) },
      );
      return { ok: body?.ok ?? true, reason: body?.reason };
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        return { ok: false, reason: err.message };
      }
      throw err;
    }
  }

  // ── Stage Run Controls ──

  async pauseStageRun(runId: string, stageId: string): Promise<void> {
    await api(this.url(`/api/workflow-runs/${runId}/stages/${stageId}/pause`), { method: 'POST' });
  }

  async resumeStageRun(runId: string, stageId: string): Promise<void> {
    await api(this.url(`/api/workflow-runs/${runId}/stages/${stageId}/resume`), { method: 'POST' });
  }

  async retryStageRun(runId: string, stageId: string): Promise<void> {
    await api(this.url(`/api/workflow-runs/${runId}/stages/${stageId}/retry`), { method: 'POST' });
  }

  async cancelStageRun(runId: string, stageId: string): Promise<void> {
    await api(this.url(`/api/workflow-runs/${runId}/stages/${stageId}/cancel`), { method: 'POST' });
  }

  // ── Unified SSE ──

  subscribeToStream(
    scope: SSEScope,
    id: string,
    handler: (event: PersistedEvent) => void,
    opts?: SSESubscriptionOptions,
  ): () => void {
    const params: Record<string, string> = { scope, id };
    if (opts?.filter?.length) params['filter'] = opts.filter.join(',');
    if (opts?.afterSequence !== undefined) params['afterSequence'] = String(opts.afterSequence);
    const urlStr = this.url(`/api/stream?${new URLSearchParams(params).toString()}`);

    let source: EventSource | null = null;
    let closed = false;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    /** Resume point so a re-mint reconnect does not drop events. */
    let lastSeq = opts?.afterSequence;

    const connect = async (): Promise<void> => {
      if (closed) return;
      try {
        // SSE cannot carry an Authorization header, so the connection is
        // authorised by a 30-second single-use ticket. Because the ticket is
        // single-use, EventSource's built-in retry would fail — we own
        // reconnection instead and mint a fresh ticket each time.
        const ticket = await runtime().createStreamTicket(scope, id);
        if (closed) return;
        const target = new URL(urlStr);
        // Empty means the server accepts unauthenticated requests; a bogus
        // ticket would be rejected before it reached that branch.
        if (ticket) target.searchParams.set('ticket', ticket);
        if (lastSeq !== undefined) target.searchParams.set('afterSeq', String(lastSeq));

        const es = new EventSource(target.toString());
        source = es;
        es.onopen = () => {
          attempts = 0;
          opts?.onConnected?.();
        };
        es.onerror = () => {
          if (es.readyState === EventSource.CONNECTING) {
            opts?.onReconnecting?.();
            return;
          }
          opts?.onDisconnected?.();
          if (closed) return;
          try { es.close(); } catch { /* already closed */ }
          scheduleRetry();
        };
        es.onmessage = (msg: MessageEvent) => {
          try {
            const seq = parseInt(msg.lastEventId ?? '0', 10) || 0;
            if (seq > 0) lastSeq = seq;
            const frame = JSON.parse(msg.data as string) as { kind?: string; payload?: unknown };
            // Map SSE frame { kind, payload } to PersistedEvent shape
            const event: PersistedEvent = {
              id: seq,
              sessionId: id,
              sequenceId: seq,
              kind: (frame.kind ?? 'unknown') as PersistedEvent['kind'],
              data: frame.payload ?? frame,
              timestamp: Date.now(),
            };
            handler(event);
          } catch { /* ignore malformed */ }
        };
      } catch {
        if (!closed) {
          opts?.onDisconnected?.();
          scheduleRetry();
        }
      }
    };

    const scheduleRetry = (): void => {
      if (closed || retryTimer) return;
      attempts += 1;
      const delay = Math.min(8000, 500 * 2 ** Math.min(attempts - 1, 4));
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void connect();
      }, delay);
      // Never hold the CLI process open just to retry a stream.
      retryTimer.unref?.();
    };

    void connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      try { source?.close(); } catch { /* already closed */ }
    };
  }

  async streamReplay(scope: SSEScope, id: string, afterSeq: number, limit = 500): Promise<ReplayResult> {
    const result = await api<{ events: PersistedEvent[]; lastSequence: number; hasMore: boolean }>(
      this.url(`/api/stream/replay${qs({ scope, id, afterSeq, limit })}`),
    );
    return result;
  }

  // ── Convenience SSE wrappers ──

  subscribeToRunEvents(runId: string, handler: (e: PersistedEvent) => void, opts?: { afterSequence?: number }): () => void {
    return this.subscribeToStream('run', runId, handler, { afterSequence: opts?.afterSequence });
  }

  subscribeToChatEvents(sessionId: string, handler: (e: PersistedEvent) => void, opts?: { afterSequence?: number }): () => void {
    return this.subscribeToStream('session', sessionId, handler, { afterSequence: opts?.afterSequence });
  }

  // ── Health & System ──

  async getHealthInfo(): Promise<Record<string, unknown>> {
    return api<Record<string, unknown>>(this.url('/api/health'));
  }

  async getHealthConfig(): Promise<Record<string, unknown>> {
    return api<Record<string, unknown>>(this.url('/api/health/config'));
  }

  async getCopilotModels(): Promise<Array<{ id: string; name: string }>> {
    return api<Array<{ id: string; name: string }>>(this.url('/api/copilot/models'));
  }

  async getCopilotState(): Promise<Record<string, unknown>> {
    return api<Record<string, unknown>>(this.url('/api/copilot/state'));
  }

  async getSystemArtifacts(type?: string): Promise<ArtifactWithSource[]> {
    return api<ArtifactWithSource[]>(this.url(`/api/system/artifacts${qs({ type })}`));
  }

  async getSystemMcpServers(): Promise<McpServerEntry[]> {
    return api<McpServerEntry[]>(this.url('/api/system/mcp-servers'));
  }

  // ── Agents ──

  async listAgents(filter?: {
    scope?: string;
    role?: string;
    projectId?: string;
    q?: string;
    enabledOnly?: boolean;
  }): Promise<Agent[]> {
    return api<Agent[]>(
      this.url(
        `/api/agents${qs({
          scope: filter?.scope,
          role: filter?.role,
          projectId: filter?.projectId,
          q: filter?.q,
          enabledOnly: filter?.enabledOnly ? '1' : undefined,
        })}`,
      ),
    );
  }

  async getAgent(id: string): Promise<Agent> {
    return api<Agent>(this.url(`/api/agents/${encodeURIComponent(id)}`));
  }

  async createAgent(params: CreateAgentParams): Promise<Agent> {
    return api<Agent>(this.url('/api/agents'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async updateAgent(id: string, params: UpdateAgentParams): Promise<Agent> {
    return api<Agent>(this.url(`/api/agents/${encodeURIComponent(id)}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async deleteAgent(id: string, force?: boolean): Promise<{ deleted: boolean; soft: boolean }> {
    return api<{ deleted: boolean; soft: boolean }>(
      this.url(`/api/agents/${encodeURIComponent(id)}${force ? '?force=1' : ''}`),
      { method: 'DELETE' },
    );
  }

  async getAgentUsage(id: string): Promise<AgentUsageResponse> {
    return api(this.url(`/api/agents/${encodeURIComponent(id)}/usage`));
  }

  async exportAgent(id: string): Promise<string> {
    const result = await api<{ markdown: string }>(
      this.url(`/api/agents/${encodeURIComponent(id)}/export`),
      { method: 'POST' },
    );
    return result.markdown;
  }

  async importAgent(params: {
    markdown: string;
    scope?: string;
    projectId?: string;
    overwrite?: boolean;
  }): Promise<Agent> {
    return api<Agent>(this.url('/api/agents/import'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async resolveAgentPreview(body: {
    agentRef?: string;
    overrides?: AgentOverrides;
    projectId?: string;
    harnessType?: 'copilot' | 'claude-agent';
    scope: 'chat' | 'stage' | 'worker';
  }): Promise<ResolvedAgentProjection> {
    return api<ResolvedAgentProjection>(this.url('/api/agents/resolve-preview'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  // ── Copilot ──

  async listCopilotConversations(): Promise<Array<Record<string, unknown>>> {
    return api<Array<Record<string, unknown>>>(this.url('/api/copilot/conversations'));
  }

  async getCopilotConversationMessages(conversationId: string): Promise<Array<Record<string, unknown>>> {
    return api<Array<Record<string, unknown>>>(this.url(`/api/copilot/conversations/${conversationId}/messages`));
  }

  async copilotPing(): Promise<{ alive: boolean }> {
    return api<{ alive: boolean }>(this.url('/api/copilot/ping'), { method: 'POST' });
  }

  // ── Session Messages ──

  async getSessionMessages(sessionId: string, stageRunId?: string): Promise<Array<Record<string, unknown>>> {
    return api<Array<Record<string, unknown>>>(this.url(`/api/sessions/${sessionId}/chat${qs({ stageRunId })}`));
  }

  // ── Orchestrator ──

  async listWorkflowTemplates(): Promise<WorkflowTemplate[]> {
    return api<WorkflowTemplate[]>(this.url('/api/orchestrator/system-workflows'));
  }

  async getWorkflowTemplate(id: string): Promise<WorkflowTemplate> {
    return api<WorkflowTemplate>(this.url(`/api/orchestrator/system-workflows/${id}`));
  }

  async createFromTemplate(templateId: string, params: Record<string, unknown>): Promise<WorkflowDefinition> {
    return api<WorkflowDefinition>(this.url('/api/orchestrator/from-template'), {
      method: 'POST', ...jsonBody({ templateId, ...params }),
    });
  }

  async startOrchestratedRun(params: OrchestratedRunParams): Promise<Record<string, unknown>> {
    return api<Record<string, unknown>>(this.url('/api/orchestrator/runs'), { method: 'POST', ...jsonBody(params) });
  }

  async getOrchestratorContext(runId: string): Promise<OrchestratorContext> {
    return api<OrchestratorContext>(this.url(`/api/orchestrator/runs/${runId}/context`));
  }

  async cancelOrchestratedRun(runId: string): Promise<void> {
    await api(this.url(`/api/orchestrator/runs/${runId}/cancel`), { method: 'POST' });
  }

  // PARITY-5: multipart upload via Node 20's global FormData/Blob (was a 501 stub).
  async uploadWorkflowFiles(defId: string, category: string, files: Array<{ name: string; content: Buffer }>): Promise<void> {
    const form = new FormData();
    form.append('category', category);
    for (const f of files) {
      form.append('files', new Blob([new Uint8Array(f.content)]), f.name);
    }
    await api(this.url(`/api/orchestrator/workflows/${defId}/uploads`), { method: 'POST', body: form });
  }

  async listWorkflowFiles(defId: string): Promise<FileEntry[]> {
    return api<FileEntry[]>(this.url(`/api/orchestrator/workflows/${defId}/files`));
  }

  async downloadWorkflowFile(defId: string, filePath: string): Promise<Buffer> {
    const response = await runtime().fetch(this.url(`/api/orchestrator/workflows/${defId}/files/download${qs({ path: filePath })}`));
    if (!response.ok) throw new ApiError(response.status, 'DOWNLOAD_FAILED', 'Download failed');
    return Buffer.from(await response.arrayBuffer());
  }

  async deleteWorkflowFile(defId: string, filePath: string): Promise<void> {
    await api(this.url(`/api/orchestrator/workflows/${defId}/files${qs({ path: filePath })}`), { method: 'DELETE' });
  }

  // PARITY-5: multipart upload via Node 20's global FormData/Blob (was a 501 stub).
  async uploadRunFiles(runId: string, category: string, files: Array<{ name: string; content: Buffer }>): Promise<void> {
    const form = new FormData();
    form.append('category', category);
    for (const f of files) {
      form.append('files', new Blob([new Uint8Array(f.content)]), f.name);
    }
    await api(this.url(`/api/orchestrator/runs/${runId}/uploads`), { method: 'POST', body: form });
  }

  async getRunWorkspace(runId: string): Promise<RunWorkspaceInfo> {
    return api<RunWorkspaceInfo>(this.url(`/api/orchestrator/runs/${runId}/workspace`));
  }

  async downloadRunFile(runId: string, filePath: string, source?: string): Promise<Buffer> {
    const response = await runtime().fetch(this.url(`/api/orchestrator/runs/${runId}/download${qs({ path: filePath, source })}`));
    if (!response.ok) throw new ApiError(response.status, 'DOWNLOAD_FAILED', 'Download failed');
    return Buffer.from(await response.arrayBuffer());
  }

  async getRunFileContent(runId: string, filePath: string, source?: string): Promise<string> {
    return api<string>(this.url(`/api/orchestrator/runs/${runId}/content${qs({ path: filePath, source })}`));
  }

  async getRunDiff(runId: string): Promise<string> {
    return api<string>(this.url(`/api/orchestrator/runs/${runId}/diff`));
  }

  // ── Automation ──

  async createAutomation(params: CreateAutomationParams): Promise<Automation> {
    return api<Automation>(this.url('/api/automations'), { method: 'POST', ...jsonBody(params) });
  }

  async listAutomations(projectId?: string): Promise<Automation[]> {
    return api<Automation[]>(this.url(`/api/automations${qs({ projectId })}`));
  }

  async getAutomation(id: string): Promise<AutomationWithExecutions> {
    return api<AutomationWithExecutions>(this.url(`/api/automations/${id}`));
  }

  async updateAutomation(id: string, params: UpdateAutomationParams): Promise<Automation> {
    return api<Automation>(this.url(`/api/automations/${id}`), { method: 'PATCH', ...jsonBody(params) });
  }

  async deleteAutomation(id: string): Promise<void> {
    await api(this.url(`/api/automations/${id}`), { method: 'DELETE' });
  }

  async enableAutomation(id: string): Promise<Automation> {
    return api<Automation>(this.url(`/api/automations/${id}/enable`), { method: 'POST' });
  }

  async disableAutomation(id: string): Promise<Automation> {
    return api<Automation>(this.url(`/api/automations/${id}/disable`), { method: 'POST' });
  }

  async triggerAutomation(
    id: string,
    body?: TriggerAutomationBody,
    opts?: { idempotencyKey?: string },
  ): Promise<AutomationExecution> {
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    return api<AutomationExecution>(this.url(`/api/automations/${id}/trigger`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body ?? {}),
    });
  }

  async rotateWebhookToken(id: string): Promise<{ token: string }> {
    return api<{ token: string }>(this.url(`/api/automations/${id}/rotate-webhook-token`), { method: 'POST' });
  }

  async testDataSource(config: Record<string, unknown>): Promise<DataSourceTestResult> {
    return api<DataSourceTestResult>(this.url('/api/automations/test-data-source'), { method: 'POST', ...jsonBody(config) });
  }

  async getExecutionsByAutomation(automationId: string): Promise<AutomationExecution[]> {
    return api<AutomationExecution[]>(this.url(`/api/automations/${automationId}/executions`));
  }

  async getExecutionWithRuns(automationId: string, execId: string): Promise<AutomationExecutionWithRuns> {
    return api<AutomationExecutionWithRuns>(this.url(`/api/automations/${automationId}/executions/${execId}`));
  }

  async cancelExecution(automationId: string, execId: string): Promise<void> {
    await api(this.url(`/api/automations/${automationId}/executions/${execId}/cancel`), { method: 'POST' });
  }

  // ── Project ──

  async createProject(params: { name: string; description?: string; settings?: Partial<ProjectSettings> }): Promise<Project> {
    return api<Project>(this.url('/api/projects'), { method: 'POST', ...jsonBody(params) });
  }

  async listProjects(status?: string): Promise<Project[]> {
    return api<Project[]>(this.url(`/api/projects${qs({ status })}`));
  }

  async getProject(id: string): Promise<Project> {
    return api<Project>(this.url(`/api/projects/${id}`));
  }

  async updateProject(id: string, params: { name?: string; description?: string; settings?: Partial<ProjectSettings> }): Promise<Project> {
    return api<Project>(this.url(`/api/projects/${id}`), { method: 'PUT', ...jsonBody(params) });
  }

  async deleteProject(id: string, force?: boolean): Promise<void> {
    await api(this.url(`/api/projects/${id}${qs({ force })}`), { method: 'DELETE' });
  }

  async getProjectAvailableArtifacts(id: string, type?: string): Promise<ArtifactWithSource[]> {
    return api<ArtifactWithSource[]>(this.url(`/api/projects/${id}/available-artifacts${qs({ type })}`));
  }

  // ── Codebase ──

  async linkCodebase(projectId: string, params: { alias: string; type: CodebaseType; url?: string; localPath?: string; defaultBranch?: string }): Promise<ProjectCodebase> {
    return api<ProjectCodebase>(this.url(`/api/projects/${projectId}/codebases`), { method: 'POST', ...jsonBody(params) });
  }

  async listCodebases(projectId: string): Promise<ProjectCodebase[]> {
    return api<ProjectCodebase[]>(this.url(`/api/projects/${projectId}/codebases`));
  }

  async updateCodebase(projectId: string, codebaseId: string, params: Record<string, unknown>): Promise<ProjectCodebase> {
    return api<ProjectCodebase>(this.url(`/api/projects/${projectId}/codebases/${codebaseId}`), { method: 'PUT', ...jsonBody(params) });
  }

  async unlinkCodebase(projectId: string, codebaseId: string): Promise<void> {
    await api(this.url(`/api/projects/${projectId}/codebases/${codebaseId}`), { method: 'DELETE' });
  }

  async fetchCodebase(projectId: string, codebaseId: string): Promise<void> {
    await api(this.url(`/api/projects/${projectId}/codebases/${codebaseId}/fetch`), { method: 'POST' });
  }

  async getCodebaseBranches(projectId: string, codebaseId: string): Promise<string[]> {
    return api<string[]>(this.url(`/api/projects/${projectId}/codebases/${codebaseId}/branches`));
  }

  async getCodebaseStatus(projectId: string, codebaseId: string): Promise<Record<string, unknown>> {
    return api<Record<string, unknown>>(this.url(`/api/projects/${projectId}/codebases/${codebaseId}/status`));
  }

  async browseCodebaseFiles(projectId: string, codebaseId: string, filePath?: string): Promise<FileEntry[]> {
    return api<FileEntry[]>(this.url(`/api/projects/${projectId}/codebases/${codebaseId}/files${qs({ path: filePath })}`));
  }

  async getCodebaseFileContent(projectId: string, codebaseId: string, filePath: string): Promise<string> {
    // The endpoint responds with `{ content: string }`; unwrap it so the
    // method honours its declared `Promise<string>` contract (previously it
    // leaked the wrapper object, breaking any caller treating it as a string).
    const res = await api<{ content: string }>(
      this.url(`/api/projects/${projectId}/codebases/${codebaseId}/files/content${qs({ path: filePath })}`),
    );
    return res.content;
  }

  // ── Project Config ──

  // PARITY-6: multipart project-config upload via Node 20 FormData/Blob (was a 501 stub).
  async uploadProjectConfig(projectId: string, type: ConfigType, file: { name: string; content: Buffer }): Promise<ProjectConfig> {
    const form = new FormData();
    form.append('type', type);
    form.append('file', new Blob([new Uint8Array(file.content)]), file.name);
    form.append('name', file.name.replace(/\.[^.]+$/, ''));
    form.append('filePath', file.name);
    return api<ProjectConfig>(this.url(`/api/projects/${projectId}/configs`), { method: 'POST', body: form });
  }

  async listProjectConfigs(projectId: string, type?: ConfigType): Promise<ProjectConfig[]> {
    return api<ProjectConfig[]>(this.url(`/api/projects/${projectId}/configs${qs({ type })}`));
  }

  async getProjectConfig(projectId: string, configId: string): Promise<ProjectConfig> {
    return api<ProjectConfig>(this.url(`/api/projects/${projectId}/configs/${configId}`));
  }

  // PARITY-6: update config content via the JSON PUT route (server accepts
  // { content }); decode the provided buffer as UTF-8 text. Was a 501 stub.
  async updateProjectConfig(projectId: string, configId: string, file: { name: string; content: Buffer }): Promise<ProjectConfig> {
    return api<ProjectConfig>(this.url(`/api/projects/${projectId}/configs/${configId}`), {
      method: 'PUT',
      ...jsonBody({ content: file.content.toString('utf-8') }),
    });
  }

  async deleteProjectConfig(projectId: string, configId: string): Promise<void> {
    await api(this.url(`/api/projects/${projectId}/configs/${configId}`), { method: 'DELETE' });
  }

  // ── Project MCP Servers ──

  async addProjectMcpServer(projectId: string, params: Record<string, unknown>): Promise<McpServerEntry> {
    return api<McpServerEntry>(this.url(`/api/projects/${projectId}/mcp-servers`), { method: 'POST', ...jsonBody(params) });
  }

  async listProjectMcpServers(projectId: string): Promise<McpServerEntry[]> {
    return api<McpServerEntry[]>(this.url(`/api/projects/${projectId}/mcp-servers`));
  }

  async updateProjectMcpServer(projectId: string, serverId: string, params: Record<string, unknown>): Promise<McpServerEntry> {
    return api<McpServerEntry>(this.url(`/api/projects/${projectId}/mcp-servers/${serverId}`), { method: 'PUT', ...jsonBody(params) });
  }

  async removeProjectMcpServer(projectId: string, serverId: string): Promise<void> {
    await api(this.url(`/api/projects/${projectId}/mcp-servers/${serverId}`), { method: 'DELETE' });
  }

  // ── Project Worktrees ──

  async listProjectWorktrees(projectId: string): Promise<WorktreeInfo[]> {
    return api<WorktreeInfo[]>(this.url(`/api/projects/${projectId}/worktrees`));
  }

  async removeProjectWorktree(projectId: string, worktreeId: string): Promise<void> {
    await api(this.url(`/api/projects/${projectId}/worktrees/${worktreeId}`), { method: 'DELETE' });
  }

  async cleanupProjectWorktrees(projectId: string): Promise<{ cleaned: number }> {
    return api<{ cleaned: number }>(this.url(`/api/projects/${projectId}/worktrees/cleanup`), { method: 'POST' });
  }

  // ── Workspace ──

  async listWorkspaces(filters?: WorkspaceFilters): Promise<WorkspaceInfo[]> {
    return api<WorkspaceInfo[]>(this.url(`/api/workspaces${qs(filters as Record<string, string> ?? {})}`));
  }

  async getWorkspace(id: string): Promise<WorkspaceInfo> {
    return api<WorkspaceInfo>(this.url(`/api/workspaces/${id}`));
  }

  async archiveWorkspace(id: string): Promise<void> {
    await api(this.url(`/api/workspaces/${id}/archive`), { method: 'POST' });
  }

  async commitWorkspace(id: string, message?: string): Promise<void> {
    await api(this.url(`/api/workspaces/${id}/commit`), { method: 'POST', ...jsonBody({ message }) });
  }

  async deleteWorkspace(id: string): Promise<void> {
    await api(this.url(`/api/workspaces/${id}`), { method: 'DELETE' });
  }

  async cleanupWorkspaces(retentionHours?: number, maxDiskMb?: number): Promise<Record<string, unknown>> {
    return api<Record<string, unknown>>(this.url('/api/workspaces/cleanup'), {
      method: 'POST', ...jsonBody({ retentionHours, maxDiskMb }),
    });
  }

  async listWorkspaceWorktrees(id: string): Promise<WorktreeInfo[]> {
    return api<WorktreeInfo[]>(this.url(`/api/workspaces/${id}/worktrees`));
  }

  // ── Webhook ──

  async createWebhookRegistration(params: Record<string, unknown>): Promise<WebhookRegistration> {
    return api<WebhookRegistration>(this.url('/api/webhooks/registrations'), { method: 'POST', ...jsonBody(params) });
  }

  async listWebhookRegistrations(): Promise<WebhookRegistration[]> {
    return api<WebhookRegistration[]>(this.url('/api/webhooks/registrations'));
  }

  async deleteWebhookRegistration(id: string): Promise<void> {
    await api(this.url(`/api/webhooks/registrations/${id}`), { method: 'DELETE' });
  }

  // ── Hooks ──

  async listHookPhases(): Promise<Array<Record<string, unknown>>> {
    // The server returns `{ totalPhases, categories: { workflow: [...], git: [...], ... } }`.
    // Flatten into a single array `[ {phase, category, description}, ... ]` so
    // the CLI table view (which expects an array with `name`/`description`)
    // can render uniformly. Map `phase` → `name` for the existing column key.
    const raw = await api<unknown>(this.url('/api/hooks/phases'));
    if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
    const body = raw as { categories?: Record<string, Array<{ phase: string; description?: string; category?: string }>> };
    const out: Array<Record<string, unknown>> = [];
    for (const [cat, items] of Object.entries(body.categories ?? {})) {
      for (const item of items) {
        out.push({
          name: item.phase,
          description: item.description ?? '',
          category: item.category ?? cat,
        });
      }
    }
    return out;
  }

  async testHook(sessionId: string, phase: string, hookConfig?: Record<string, unknown>): Promise<Record<string, unknown>> {
    // Server expects the full hook spec at the top level (phase, type, command/url/handler, ...).
    // hookConfig already includes `phase`; we keep the param for backwards compatibility.
    const body = hookConfig ?? { phase };
    if (!body['phase']) body['phase'] = phase;
    return api<Record<string, unknown>>(this.url(`/api/hooks/sessions/${sessionId}/hooks/test`), {
      method: 'POST', ...jsonBody(body),
    });
  }
}
