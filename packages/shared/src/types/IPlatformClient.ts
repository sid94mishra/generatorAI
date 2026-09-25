// ────────────────────────────────────────────────────────────────
// IPlatformClient — Abstraction over platform-specific communication
// Web uses HTTP+SSE, CLI uses in-process direct calls, Desktop uses IPC
// ────────────────────────────────────────────────────────────────

import type { ChatMessage } from './ChatMessage.js';
import type { Artifact } from './Artifact.js';
import type { AgentEvent, PersistedEvent } from './AgentEvent.js';
import type { Chat, CreateChatParams } from './Chat.js';
import type { WorkflowDefinition, WorkflowDefinitionWithStages, CreateWorkflowDefinitionParams } from './WorkflowDefinition.js';
import type { WorkflowRun, WorkflowRunWithStages, CreateWorkflowRunParams, StageRun } from './WorkflowRun.js';

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

/** Workflow template summary for listing */
export interface WorkflowTemplateSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  requiresCodebase: boolean;
  variables: Array<{
    name: string;
    label: string;
    type: string;
    required: boolean;
    default?: unknown;
    description?: string;
    options?: string[];
  }>;
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
  getWorkflowTemplates(): Promise<WorkflowTemplateSummary[]>;

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

  // ── v2: Workflow Definition Operations ──
  createDefinition(params: CreateWorkflowDefinitionParams): Promise<WorkflowDefinition>;
  listDefinitions(): Promise<WorkflowDefinition[]>;
  getDefinition(id: string): Promise<WorkflowDefinitionWithStages>;
  updateDefinition(id: string, params: Partial<CreateWorkflowDefinitionParams>): Promise<WorkflowDefinition>;
  deleteDefinition(id: string): Promise<void>;

  // ── v2: Workflow Run Operations ──
  createRun(params: CreateWorkflowRunParams): Promise<WorkflowRun>;
  listRuns(filter?: { definitionId?: string; status?: string }): Promise<WorkflowRun[]>;
  getRun(id: string): Promise<WorkflowRunWithStages>;
  startRun(id: string): Promise<void>;
  pauseRun(id: string): Promise<void>;
  resumeRun(id: string): Promise<void>;
  cancelRun(id: string): Promise<void>;
  /**
   * PARITY-1: run-level retry. Creates and starts a NEW run that inherits
   * the failed run's definition, variables and already-successful stages,
   * and resolves with that new run's id — the ancestor stays terminal.
   */
  retryRun(id: string): Promise<{ runId: string }>;
  deleteRun(id: string): Promise<void>;

  // ── PARITY-2: per-stage controls (dedicated /stages/:id/* endpoints) ──
  pauseStageRun(runId: string, stageId: string): Promise<void>;
  resumeStageRun(runId: string, stageId: string): Promise<void>;
  /**
   * Wake a stage parked by `step.sleep` ahead of its scheduled time. Rejects
   * with a 409 when the stage is not actually sleeping.
   */
  wakeStageRun(runId: string, stageId: string): Promise<void>;
  retryStageRun(runId: string, stageId: string): Promise<void>;
  cancelStageRun(runId: string, stageId: string): Promise<void>;

  // ── HITL — permission mode + interrupt resume (HITL-04) ──
  getPermissionMode(runId: string): Promise<{
    runId: string;
    mode: 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan';
  }>;
  setPermissionMode(
    runId: string,
    mode: 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan',
  ): Promise<void>;
  listPendingInterrupts(runId: string): Promise<StageRun[]>;
  resumeStage(
    runId: string,
    stageId: string,
    resolution: {
      outcome: 'approved' | 'changes_requested' | 'rejected';
      value?: unknown;
      reason?: string;
      followUpPrompt?: string;
    },
  ): Promise<{ ok: boolean; reason?: string }>;
}
