// ────────────────────────────────────────────────────────────────
// IPlatformClient — Abstraction over platform-specific communication
// Web uses HTTP+SSE, CLI uses in-process direct calls, Desktop uses IPC
// ────────────────────────────────────────────────────────────────

import type { ChatMessage } from './ChatMessage.js';
import type { Artifact } from './Artifact.js';
import type { AgentEvent, PersistedEvent } from './AgentEvent.js';
import type { Chat, CreateChatParams } from './Chat.js';
import type {
  WorkflowDefinitionRecord,
  WorkflowDefinitionSummary,
  WorkflowGraphInput,
  WorkflowTemplate,
} from '@generatorai/workflow-spec';
import type { InvocationPlan, InvocationRequest, InvocationResult, RunCommand } from '@generatorai/workflow-spec';
import type { LoopIteration, PendingDecisionView, WorkflowRun, WorkflowRunWithStages } from './WorkflowRun.js';
import type { AttentionFilter, AttentionSnapshot } from './Attention.js';
import type { ChatBulkResult, ChatListPage, ChatListQuery } from './ChatList.js';
import type {
  HarnessLoginResult,
  HarnessProvidersResponse,
  HarnessSetDefaultResult,
  HarnessVisibilityResponse,
  HarnessVisibilityUpdate,
} from './HarnessCatalog.js';
import type {
  ComputerConsentAnswer,
  ComputerConsentAnswerResult,
  ComputerControlMode,
  ComputerControlState,
  ComputerGrant,
  ComputerPendingConsent,
} from './ComputerUse.js';

/** Files a run start uploads before invoking, by category. */
export type InvocationFiles = Partial<Record<'skills' | 'agents' | 'prompts', Array<Blob & { readonly name: string }>>>;

/**
 * A run search (`GET /workflow-runs`); every filter narrows. `status` and
 * `trigger` match any entry (a run without a trigger is `user`), `from`/`to`
 * bound the creation time, `q` matches part of the name or the start of the
 * id, `variables` are `name=value` pairs, `limit` keeps the newest matches.
 */
export interface WorkflowRunListFilter {
  definitionId?: string;
  status?: string | readonly string[];
  trigger?: readonly string[];
  from?: string | number | Date;
  to?: string | number | Date;
  q?: string;
  variables?: Readonly<Record<string, string>>;
  limit?: number;
}

/** Platform type discriminator */
export type PlatformType = 'web' | 'cli' | 'desktop';

/** Response wrapper for paginated results */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  offset: number;
  limit: number;
}

/** Event subscription options */
export interface EventSubscriptionOptions {
  /** Resume from this sequence ID (for replay) */
  afterSequence?: number;
  /** Filter events by kind prefix (e.g. ['harness.', 'workflow.']) */
  kindPrefixes?: string[];
}

/**
 * Platform-agnostic client interface.
 *
 * All presentation layers (CLI, Web, Desktop) depend on this
 * interface rather than on concrete services. This enables:
 * - CLI → DirectPlatformClient (in-process, no HTTP)
 * - Web → HttpPlatformClient (REST + SSE)
 * - Desktop → IpcPlatformClient (Electron IPC bridge)
 */
export interface IPlatformClient {
  /** Which platform this client targets */
  readonly platform: PlatformType;

  // ── Lifecycle ──
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  // ── Chat ──
  sendPrompt(sessionId: string, prompt: string, attachments?: Array<{ type: 'file'; path: string; displayName?: string }>): Promise<void>;
  getChatHistory(sessionId: string, limit?: number, offset?: number, stageRunId?: string): Promise<ChatMessage[]>;

  // ── Templates ──
  getWorkflowTemplates(): Promise<WorkflowTemplate[]>;

  // ── Artifacts ──
  getArtifacts(sessionId: string): Promise<Artifact[]>;
  downloadArtifact(artifactId: string): Promise<{ data: Buffer; mimeType: string; name: string }>;

  // ── Event Subscription ──
  /**
   * Subscribe to real-time session events.
   * Returns an unsubscribe function.
   */
  subscribeToEvents(
    sessionId: string,
    handler: (event: PersistedEvent) => void,
    options?: EventSubscriptionOptions,
  ): () => void;

  // ── v2: Chat Operations ──
  createChat(params: CreateChatParams): Promise<Chat>;
  /** One page of chats with row summaries (chat list v2, G-02). Pass `nextCursor` back as `cursor`. */
  listChats(query?: ChatListQuery): Promise<ChatListPage>;
  getChat(chatId: string): Promise<Chat>;
  updateChat(chatId: string, updates: Partial<Pick<Chat, 'name' | 'model' | 'harnessConfig'>>): Promise<Chat>;
  /** A chat's tool-approval policy (`PATCH /chats/:id/permission-mode`); applies from the next turn. */
  setChatPermissionMode(
    chatId: string,
    mode: 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan',
  ): Promise<{ chatId: string; mode: string }>;
  archiveChat(chatId: string): Promise<void>;
  /** Restore an archived chat to Active (`PATCH { status: 'active' }`; P3-07 row action). */
  unarchiveChat(chatId: string): Promise<void>;
  deleteChat(chatId: string): Promise<void>;
  sendChatPrompt(chatId: string, prompt: string, attachments?: Array<{ type: 'file'; path: string; displayName?: string }>): Promise<void>;
  getChatMessages(chatId: string, limit?: number, offset?: number): Promise<ChatMessage[]>;

  // ── Workflow definitions (v2 documents, P01 WP-1.7) ──
  /** Create a draft from a graph. */
  createDefinition(graph: WorkflowGraphInput): Promise<WorkflowDefinitionRecord>;
  listDefinitions(): Promise<WorkflowDefinitionSummary[]>;
  getDefinition(id: string): Promise<WorkflowDefinitionRecord>;
  /** Replace the whole graph; 409 REVISION_CONFLICT when `expectedRevision` is stale. */
  saveDefinitionGraph(id: string, graph: WorkflowGraphInput, expectedRevision: number): Promise<WorkflowDefinitionRecord>;
  /** Hard delete, or archive when runs pinned the definition. */
  deleteDefinition(id: string): Promise<{ deleted: true } | { archived: true; runs: number }>;

  // ── Workflow runs ──
  /**
   * THE way a run starts (P04): `POST /workflow-invocations`. A definition,
   * a script or a fork of an earlier run; the server derives the trigger.
   * `files` are uploaded first and sent as upload ids.
   */
  invokeWorkflow(
    request: InvocationRequest,
    opts?: { idempotencyKey?: string; files?: InvocationFiles },
  ): Promise<InvocationResult>;
  /** What `invokeWorkflow` would do, without writing anything. */
  planWorkflowInvocation(request: InvocationRequest): Promise<InvocationPlan>;
  listRuns(filter?: WorkflowRunListFilter): Promise<WorkflowRun[]>;
  getRun(id: string): Promise<WorkflowRunWithStages>;
  /**
   * Every operator action on a run or one of its instances (P03 commands
   * API): pause, resume, cancel, retry, skip, fail and approve (which also
   * answers an in-turn tool permission, question or plan review). A refused
   * command rejects with the server's 409/400/404 error.
   */
  runCommand(runId: string, command: RunCommand): Promise<void>;
  /** A loop instance's finished iterations, oldest first (P05). */
  listLoopIterations(runId: string, instanceId: string): Promise<LoopIteration[]>;
  /** Every decision the run waits on, its sub-workflow children's mirrored (P05). */
  listPendingDecisions(runId: string): Promise<PendingDecisionView[]>;
  /** The commands a check stage may run: the defaults plus the operator's extras (P05). */
  getScriptAllowlist(): Promise<{ commands: string[]; defaults: string[]; extras: string[] }>;
  deleteRun(id: string): Promise<void>;

  // ── HITL — permission mode + interrupt resume (HITL-04) ──
  getPermissionMode(runId: string): Promise<{
    runId: string;
    mode: 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan';
  }>;
  setPermissionMode(
    runId: string,
    mode: 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan',
  ): Promise<void>;
  // ── Attention feed (G-01) ──
  /**
   * Needs you + Running across chats, workflow runs and automation
   * executions (`GET /api/attention`). Live deltas arrive on the `global`
   * stream scope as `attention.*`; fold them in with client-core's
   * `attentionReducer`.
   */
  getAttention(filter?: AttentionFilter): Promise<AttentionSnapshot>;

  // ── Chat list v2 (G-02): bulk actions for the list's bulk bar ──
  /** Archive several chats in one request; the outcome is per id. */
  archiveChats(chatIds: string[]): Promise<ChatBulkResult>;
  /** Permanently delete several chats in one request; the outcome is per id. */
  deleteChats(chatIds: string[]): Promise<ChatBulkResult>;

  // ── Agent providers / model picker (G-09) ──
  /**
   * Every provider's readiness and model catalog (`GET /api/harness/providers`).
   * Answered from the server's snapshot (`stale: true` while it re-probes);
   * `refresh: true` forces a blocking re-probe that spawns each provider's CLI,
   * so pass it only on an explicit user action. Build the picker's view with
   * client-core's `buildModelPickerCatalog` (ready providers first).
   */
  getHarnessProviders(options?: { refresh?: boolean }): Promise<HarnessProvidersResponse>;
  /** Start the provider's own sign-in; open `authUrl` when present, then re-probe. */
  loginProvider(type: string): Promise<HarnessLoginResult>;
  /** Sign the provider's account out. */
  logoutProvider(type: string): Promise<void>;
  /** Start downloading a provider's CLI (Copilot, on first use); `installing` on the providers list tracks it. */
  installProvider(type: string): Promise<void>;
  /** Make a READY provider the default for requests that name none (409 otherwise). */
  setDefaultProvider(type: string): Promise<HarnessSetDefaultResult>;
  /** Which providers this server serves (`GET /api/harness/visibility`, D-131). */
  getHarnessVisibility(): Promise<HarnessVisibilityResponse>;
  /** Reveal or hide providers (`PUT /api/harness/visibility`, admin:harnesses); `null` = back to the default. */
  setHarnessVisibility(update: HarnessVisibilityUpdate): Promise<HarnessVisibilityResponse>;

  // ── Computer consent, grants and control (G-07) ──
  /** Prompts still awaiting an answer on a workspace (with `plan` for a batched request). */
  getComputerConsent(workspaceId: string): Promise<ComputerPendingConsent[]>;
  /** Answer a prompt; `scope: 'app' | 'any'` picks "this app only" or "any app". */
  answerComputerConsent(workspaceId: string, answer: ComputerConsentAnswer): Promise<ComputerConsentAnswerResult>;
  /** Standing grants; `appIdentity: '*'` covers any app. */
  listComputerGrants(workspaceId: string): Promise<ComputerGrant[]>;
  revokeComputerGrant(workspaceId: string, appIdentity: string): Promise<void>;
  /** Who drives the desktop (`agent | paused | user`). */
  getComputerControl(workspaceId: string): Promise<ComputerControlState>;
  /** Pause agent (`paused`), Take over (`user`) or hand back (`agent`). */
  setComputerControl(workspaceId: string, mode: ComputerControlMode): Promise<ComputerControlState>;
}
