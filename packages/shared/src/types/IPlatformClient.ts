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

/** Files a run start uploads before invoking, by category. */
export type InvocationFiles = Partial<Record<'skills' | 'agents' | 'prompts', Array<Blob & { readonly name: string }>>>;

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

  // ── Platform-specific ──
  /**
   * Open a directory picker (CLI: returns cwd, Web: no-op, Desktop: native dialog)
   */
  selectDirectory(): Promise<string | null>;

  // ── v2: Chat Operations ──
  createChat(params: CreateChatParams): Promise<Chat>;
  listChats(filter?: { status?: string }): Promise<Chat[]>;
  getChat(chatId: string): Promise<Chat>;
  updateChat(chatId: string, updates: Partial<Pick<Chat, 'model' | 'harnessConfig'>>): Promise<Chat>;
  archiveChat(chatId: string): Promise<void>;
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
  listRuns(filter?: { definitionId?: string; status?: string }): Promise<WorkflowRun[]>;
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
}
