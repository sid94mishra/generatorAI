// ────────────────────────────────────────────────────────────────
// Database Schema — Tables (Drizzle ORM + SQLite)
// ────────────────────────────────────────────────────────────────

import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, blob, index, uniqueIndex, primaryKey, foreignKey, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import type {
  ChatMessageMetadata,
  ProjectSettings,
  CodebaseSettings,
  DataSchema,
  IterationMode,
  AutomationDataset,
  AutomationRetryPolicy,
  AgentToolPolicy,
  AgentRuntimePolicy,
  AgentOrchestrationPolicy,
  AgentOverrides,
  ResolvedAgentProjection,
  ChatSourceControlOptions,
} from '@generatorai/shared';

// ── Sessions ──

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status', {
      enum: [
        'created', 'starting', 'running', 'paused',
        'cancelling', 'cancelled', 'completed', 'deleted',
        'active', 'closing', 'closed', 'error',
      ],
    }).notNull().default('created'),
    model: text('model'),
    repoBranch: text('repo_branch'),
    tags: text('tags', { mode: 'json' }).$type<string[]>().default([]),
    conversationId: text('conversation_id'),
    /** The provider's own session handle (Claude session id / Codex thread id). */
    providerSessionId: text('provider_session_id'),
    ownerType: text('owner_type').$type<'chat' | 'stage_run' | 'workflow_run'>(),
    ownerId: text('owner_id'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
    startedAt: integer('started_at', { mode: 'timestamp' }),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
    closedAt: integer('closed_at', { mode: 'timestamp' }),
  },
  (table) => ({
    statusIdx: index('idx_sessions_status').on(table.status),
    createdAtIdx: index('idx_sessions_created_at').on(table.createdAt),
  }),
);

// ── Events ──

export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: text('session_id').notNull(),
    sequenceId: integer('sequence_id').notNull(),
    kind: text('kind').notNull(),
    data: text('data', { mode: 'json' }).notNull(),
    timestamp: integer('timestamp').notNull(),
    workflowRunId: text('workflow_run_id'),
    stageRunId: text('stage_run_id'),
  },
  (table) => ({
    sessionSeqIdx: uniqueIndex('idx_events_session_seq').on(
      table.sessionId,
      table.sequenceId,
    ),
    sessionKindIdx: index('idx_events_session_kind').on(table.sessionId, table.kind),
    timestampIdx: index('idx_events_timestamp').on(table.timestamp),
  }),
);

// ── Event Sequences ──
// Atomic per-session sequence allocator. Replaces the in-memory counter
// inside EventRepository, which could collide across multiple server
// processes writing to the same DB. Incremented via
// `UPDATE ... SET next_sequence = next_sequence + 1 ... RETURNING`.
export const eventSequences = sqliteTable('event_sequences', {
  sessionId: text('session_id').primaryKey(),
  nextSequence: integer('next_sequence').notNull().default(1),
});

// ── Stream Cursors (STR-02 / Phase 4 streaming rewrite) ─────────────
// Persistent event log for the new `StreamBroker`. Unlike `events` (which
// is keyed by sessionId only), this table supports four scopes:
//   - session | run | chat | global
// Consumers resume via Last-Event-ID by querying rows where
// `(scope, scope_id, seq > lastEventId)`.
//
// Payloads are stored inline as JSON. We deliberately duplicate data
// with the `events` table for now — the goal is a single source of truth
// for the broker surface; existing per-session SSE infrastructure keeps
// using `events` until STR-04 migrates the web client.
export const streamCursors = sqliteTable(
  'stream_cursors',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    scope: text('scope').notNull(), // 'session' | 'run' | 'chat' | 'global'
    scopeId: text('scope_id').notNull(),
    seq: integer('seq').notNull(), // monotonic per (scope, scope_id)
    kind: text('kind').notNull(),
    payload: text('payload', { mode: 'json' }).notNull(),
    ts: integer('ts').notNull(),
  },
  (table) => ({
    // Primary query pattern: replay `(scope, scope_id, seq > X)` ordered asc.
    scopeIdSeqIdx: uniqueIndex('idx_stream_cursors_scope_id_seq').on(
      table.scope,
      table.scopeId,
      table.seq,
    ),
    // Retention sweep uses timestamp.
    tsIdx: index('idx_stream_cursors_ts').on(table.ts),
  }),
);

// Atomic per-(scope, scope_id) sequence allocator, mirrors `event_sequences`.
// Keyed by composite (scope, scope_id). Using SQLite's `INSERT ... ON
// CONFLICT DO UPDATE ... RETURNING` inside a transaction makes allocation
// race-free across concurrent writers.
export const streamSequences = sqliteTable(
  'stream_sequences',
  {
    scope: text('scope').notNull(),
    scopeId: text('scope_id').notNull(),
    lastSeq: integer('last_seq').notNull().default(0),
  },
  (table) => ({
    pk: uniqueIndex('pk_stream_sequences').on(table.scope, table.scopeId),
  }),
);

// ── Chat Messages ──

export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant', 'system', 'tool'] }).notNull(),
    content: text('content').notNull(),
    attachments: text('attachments', { mode: 'json' }).$type<
      Array<{ name: string; path: string; mimeType: string }>
    >(),
    toolName: text('tool_name'),
    toolArgs: text('tool_args', { mode: 'json' }),
    toolResult: text('tool_result', { mode: 'json' }),
    /** Rich metadata (thinking, tool calls, system msgs) for assistant messages */
    metadata: text('metadata', { mode: 'json' }).$type<ChatMessageMetadata>(),
    chatId: text('chat_id'),
    /** Agent that produced this message, for correct replay after a mid-chat switch. */
    agentRef: text('agent_ref'),
    agentVersion: integer('agent_version'),
    timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
    /**
     * v56 (RV-10) — true only when the message was written on the provider's
     * final turn event; false for a partial written on cancel or pause.
     */
    complete: integer('complete', { mode: 'boolean' }).notNull().default(true),
    /**
     * v57 — what a stage-session message is in its attempt: `context`,
     * `feedback`, `prompt`, `repair`, `summary`, `approval_feedback`,
     * `operator`, `iteration_input`, `wrap_up`, `digest`. NULL for chats.
     * Deliberately no CHECK: a later role needs no rebuild of this table.
     */
    turnRole: text('turn_role'),
  },
  (table) => ({
    sessionIdx: index('idx_chat_session_id').on(table.sessionId),
    sessionTimeIdx: index('idx_chat_session_time').on(table.sessionId, table.timestamp),
    chatIdx: index('idx_chat_messages_chat_id').on(table.chatId),
  }),
);

// ── Artifacts ──

export const artifacts = sqliteTable(
  'artifacts',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    path: text('path').notNull(),
    mimeType: text('mime_type'),
    size: integer('size').notNull(),
    direction: text('direction', { enum: ['inbound', 'outbound'] }).notNull(),
    content: blob('content', { mode: 'buffer' }),
    workflowRunId: text('workflow_run_id'),
    stageRunId: text('stage_run_id'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    sessionIdx: index('idx_artifacts_session_id').on(table.sessionId),
  }),
);

// ── Chats ──

export const chats = sqliteTable(
  'chats',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    model: text('model'),
    harnessConfig: text('harness_config', { mode: 'json' }),
    repoUrl: text('repo_url'),
    repoBranch: text('repo_branch'),
    workspacePath: text('workspace_path'),
    codebaseIds: text('codebase_ids', { mode: 'json' }).$type<string[]>(),
    gitRepositories: text('git_repositories', { mode: 'json' }),
    tags: text('tags', { mode: 'json' }).$type<string[]>().default([]),
    status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
    projectId: text('project_id'),
    workspaceId: text('workspace_id'),
    useWorktree: integer('use_worktree', { mode: 'boolean' }).notNull().default(true),
    // ── Mount plan (v51) — what the agent works on ──
    sources: text('sources', { mode: 'json' }),
    primarySource: text('primary_source'),
    // ── Agent-native source control (v54) ──
    /** Per-chat commit / push / open-PR options; NULL = source control off. */
    sourceControl: text('source_control', { mode: 'json' }).$type<ChatSourceControlOptions>(),
    // ── Orchestrator mode (v17) ──
    orchestratorMode: integer('orchestrator_mode', { mode: 'boolean' }).notNull().default(false),
    // ── W24 fix (v41) — durable orchestrator termination state ──
    // Only meaningful when orchestratorMode=true. See migration 41's comment.
    orchestratorWaveCount: integer('orchestrator_wave_count'),
    orchestratorStartedAt: integer('orchestrator_started_at'),
    parentChatId: text('parent_chat_id'),
    /** Conversation-branch provenance (a fork is NOT a worker: it stays in the sidebar). */
    forkedFromChatId: text('forked_from_chat_id'),
    forkedAtTurnId: text('forked_at_turn_id'),
    /**
     * Transcript digest to prepend to the next prompt after a SYNTHETIC
     * rewind/fork (provider without native branching). Cleared once consumed.
     */
    conversationSeed: text('conversation_seed'),
    backgroundTaskName: text('background_task_name'),
    backgroundTaskIndex: integer('background_task_index'),
    backgroundTaskStatus: text('background_task_status'),
    // ── Agent mode (v21, renamed v22) ──
    /** Sticky per-chat default agent mode; the composer can override per turn. */
    defaultAgentMode: text('default_agent_mode', { enum: ['auto', 'plan'] })
      .notNull()
      .default('auto'),
    /**
     * Chat-scoped permission policy. Defaults to `bypassPermissions` so every
     * pre-existing chat keeps its fully-autonomous behaviour (attaching a
     * permission handler would otherwise force Claude into 'default' mode and
     * turn every chat into a prompt storm — see HITL-06).
     */
    permissionMode: text('permission_mode', {
      enum: ['bypassPermissions', 'default', 'acceptEdits', 'plan'],
    })
      .notNull()
      .default('bypassPermissions'),
    // ── Agent binding (v26) ──
    /** Portable `scope:slug` ref — authoritative. */
    agentRef: text('agent_ref'),
    /** Resolution cache for `agentRef`. Allowed to be stale/orphaned. */
    agentId: text('agent_id'),
    /** Agent version at bind time. Part of the conversation binding key. */
    agentVersion: integer('agent_version'),
    agentOverrides: text('agent_overrides', { mode: 'json' }).$type<AgentOverrides>(),
    /** Frozen, redacted projection captured at session creation. */
    agentSnapshot: text('agent_snapshot', { mode: 'json' }).$type<ResolvedAgentProjection>(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    statusIdx: index('idx_chats_status').on(table.status),
    sessionIdx: index('idx_chats_session_id').on(table.sessionId),
    projectIdx: index('idx_chats_project_id').on(table.projectId),
    createdAtIdx: index('idx_chats_created_at').on(table.createdAt),
    parentChatIdx: index('idx_chats_parent_chat_id').on(table.parentChatId),
    agentRefIdx: index('idx_chats_agent_ref').on(table.agentRef),
  }),
);

// ── Workflow Definitions (v55: v2 documents) ──
//
// A definition is a `WorkflowGraph` (`@generatorai/workflow-spec`) stored as
// rows: the workflow spec (minus name/description/projectId, which are
// columns for listing) on `workflow_definitions.spec`, one row per stage
// (the stage spec minus key/name/position on `spec`) and one per edge, all
// keyed by stage KEY. `saveGraph` replaces them in one transaction and bumps
// `revision`; runs pin an immutable `workflow_definition_versions` row.

export const workflowDefinitions = sqliteTable(
  'workflow_definitions',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    projectId: text('project_id'),
    status: text('status', { enum: ['draft', 'published'] }).notNull().default('draft'),
    /** Bumped by every graph save; `PUT …/graph` requires the current value. */
    revision: integer('revision').notNull().default(1),
    /** The version runs of this definition use (the latest published one). */
    currentVersionId: text('current_version_id'),
    archivedAt: integer('archived_at', { mode: 'timestamp' }),
    /** JSON array of notes a migration left for the author; cleared by the next save. */
    needsAttention: text('needs_attention', { mode: 'json' }).$type<string[]>(),
    /** The WorkflowSpec without name, description and projectId. */
    spec: text('spec').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    createdAtIdx: index('idx_workflow_defs_created_at').on(table.createdAt),
    projectIdx: index('idx_workflow_defs_project').on(table.projectId),
    statusIdx: index('idx_workflow_defs_status').on(table.status),
  }),
);

// ── Stage Definitions ──

export const stageDefinitions = sqliteTable(
  'stage_definitions',
  {
    id: text('id').primaryKey(),
    workflowDefinitionId: text('workflow_definition_id')
      .notNull()
      .references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
    /** Stable stage key (`^[a-z][a-z0-9_]{0,47}$`), unique per definition. */
    key: text('key').notNull(),
    name: text('name').notNull(),
    /** Position in the document's `stages` array. */
    ordinal: integer('ordinal').notNull().default(0),
    positionX: real('position_x'),
    positionY: real('position_y'),
    /** The StageSpec without key, name and position. */
    spec: text('spec').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    keyIdx: uniqueIndex('idx_stage_defs_key').on(table.workflowDefinitionId, table.key),
  }),
);

// ── Stage Edges ──

export const stageEdges = sqliteTable(
  'stage_edges',
  {
    id: text('id').primaryKey(),
    workflowDefinitionId: text('workflow_definition_id')
      .notNull()
      .references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
    fromKey: text('from_key').notNull(),
    toKey: text('to_key').notNull(),
    /** EdgeSpec `on` (`on` is an SQL keyword, hence the column name). */
    edgeOn: text('edge_on', { enum: ['success', 'failure', 'completion', 'always'] }).notNull().default('success'),
    whenExpr: text('when_expr'),
    handlesFailure: integer('handles_failure', { mode: 'boolean' }),
    /** Position in the document's `edges` array. */
    ordinal: integer('ordinal').notNull().default(0),
  },
  (table) => ({
    pairIdx: uniqueIndex('idx_stage_edges_pair').on(table.workflowDefinitionId, table.fromKey, table.toKey),
    fromFk: foreignKey({
      columns: [table.workflowDefinitionId, table.fromKey],
      foreignColumns: [stageDefinitions.workflowDefinitionId, stageDefinitions.key],
    }).onDelete('cascade'),
    toFk: foreignKey({
      columns: [table.workflowDefinitionId, table.toKey],
      foreignColumns: [stageDefinitions.workflowDefinitionId, stageDefinitions.key],
    }).onDelete('cascade'),
  }),
);

// ── Workflow Definition Versions ──
// Immutable snapshots of a definition's canonical WorkflowGraph. `published`
// versions are what runs use; `test` versions back test runs of drafts.

export const workflowDefinitionVersions = sqliteTable(
  'workflow_definition_versions',
  {
    id: text('id').primaryKey(),
    workflowDefinitionId: text('workflow_definition_id')
      .notNull()
      .references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    /** sha256 of the canonical export text; publishing identical content reuses the version. */
    contentHash: text('content_hash').notNull(),
    kind: text('kind', { enum: ['published', 'test'] }).notNull(),
    /** The canonical WorkflowGraph JSON (the export format). */
    spec: text('spec').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    versionIdx: uniqueIndex('idx_wf_def_versions_version').on(table.workflowDefinitionId, table.version),
    hashIdx: index('idx_wf_def_versions_hash').on(table.workflowDefinitionId, table.contentHash),
  }),
);

// ── Workflow Runs (v57, the v2 engine: G5 §6.2) ──
//
// Every timestamp of the run-side tables is epoch MILLISECONDS
// (`timestamp_ms`). Status values are the v2 state machines of
// `@generatorai/workflow-spec` (the DDL carries the CHECK). Status is
// written only through the CAS `transition()` methods (R-4) — the v1
// engine's repository methods keep writing it until the P03 cutover.

export const workflowRuns = sqliteTable(
  'workflow_runs',
  {
    id: text('id').primaryKey(),
    workflowDefinitionId: text('workflow_definition_id')
      .notNull()
      .references(() => workflowDefinitions.id),
    /** The immutable definition version this run executes (W-13). */
    definitionVersionId: text('definition_version_id')
      .notNull()
      .references(() => workflowDefinitionVersions.id),
    name: text('name').notNull(),
    status: text('status', {
      enum: ['created', 'starting', 'running', 'waiting', 'paused', 'finalizing', 'cancelling', 'completed', 'failed', 'cancelled'],
    }).notNull().default('created'),
    /** Why the run is in its status (`budget_exhausted`, `setup:<phase>`, …). */
    statusReason: text('status_reason'),
    /** Fixed when the run enters `finalizing`. */
    outcome: text('outcome', { enum: ['completed', 'failed', 'cancelled'] }),
    /** CAS version, bumped by every run transition. */
    version: integer('version').notNull().default(0),
    variables: text('variables', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    /** The run's permission mode (P04 invocation writes the resolved mode). */
    permissionMode: text('permission_mode', {
      enum: ['bypassPermissions', 'default', 'acceptEdits', 'plan'],
    }).notNull(),
    projectId: text('project_id'),
    workspaceId: text('workspace_id'),
    /** P04 — the server-derived trigger (JSON). */
    trigger: text('trigger', { mode: 'json' }).$type<unknown>(),
    invocationId: text('invocation_id'),
    idempotencyKey: text('idempotency_key'),
    parentRunId: text('parent_run_id').references((): AnySQLiteColumn => workflowRuns.id, { onDelete: 'set null' }),
    parentStageRunId: text('parent_stage_run_id').references((): AnySQLiteColumn => stageRuns.id, { onDelete: 'set null' }),
    rootRunId: text('root_run_id').notNull(),
    depth: integer('depth').notNull().default(0),
    /** The run this one was forked from (a terminal run is never mutated). */
    ancestorRunId: text('ancestor_run_id').references((): AnySQLiteColumn => workflowRuns.id, { onDelete: 'set null' }),
    forkSpec: text('fork_spec', { mode: 'json' }).$type<unknown>(),
    runOverrides: text('run_overrides', { mode: 'json' }).$type<Record<string, unknown>>(),
    stageOverrides: text('stage_overrides', { mode: 'json' }).$type<unknown>(),
    codebaseSelection: text('codebase_selection', { mode: 'json' }).$type<unknown>(),
    systemVars: text('system_vars', { mode: 'json' }).$type<Record<string, unknown>>(),
    budget: text('budget', { mode: 'json' }).$type<unknown>(),
    usage: text('usage', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    /** RV-27 — the process hosting the run's actor, and the fencing epoch. */
    ownerId: text('owner_id'),
    ownerEpoch: integer('owner_epoch').notNull().default(0),
    ownerExpiresAt: integer('owner_expires_at', { mode: 'timestamp_ms' }),
    /** Outbox sequence (last `workflow_outbox.run_seq` written). */
    runSeq: integer('run_seq').notNull().default(0),
    /** Frozen, redacted agent projection captured when the run started. */
    agentSnapshot: text('agent_snapshot', { mode: 'json' }).$type<ResolvedAgentProjection>(),
    error: text('error'),
    errorCode: text('error_code'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  },
  (table) => ({
    definitionIdx: index('idx_workflow_runs_definition').on(table.workflowDefinitionId),
    versionIdx: index('idx_workflow_runs_version').on(table.definitionVersionId),
    projectIdx: index('idx_workflow_runs_project').on(table.projectId),
    statusIdx: index('idx_workflow_runs_status').on(table.status),
    createdAtIdx: index('idx_workflow_runs_created_at').on(table.createdAt),
    statusCreatedIdx: index('idx_workflow_runs_status_created').on(table.status, table.createdAt),
    ancestorIdx: index('idx_workflow_runs_ancestor').on(table.ancestorRunId).where(sql`ancestor_run_id IS NOT NULL`),
    parentStageIdx: index('idx_workflow_runs_parent_stage').on(table.parentStageRunId).where(sql`parent_stage_run_id IS NOT NULL`),
    parentRunIdx: index('idx_workflow_runs_parent_run').on(table.parentRunId).where(sql`parent_run_id IS NOT NULL`),
    idempotencyIdx: uniqueIndex('idx_workflow_runs_idempotency').on(table.idempotencyKey).where(sql`idempotency_key IS NOT NULL`),
  }),
);

// ── Stage Runs: node instances (v57) ──

export const stageRuns = sqliteTable(
  'stage_runs',
  {
    /** uuidv5(run id, instance path) for engine-created instances. */
    id: text('id').primaryKey(),
    workflowRunId: text('workflow_run_id')
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'cascade' }),
    /** Key of the stage in the run's pinned definition version. */
    stageKey: text('stage_key').notNull(),
    kind: text('kind').notNull().default('agent'),
    name: text('name').notNull(),
    /** `triage`, `review_loop#2/fix`, `fanout#3/impl`. Unique per run. */
    instancePath: text('instance_path').notNull(),
    /** The enclosing container instance (P05); null at the top level. */
    scopeId: text('scope_id').references((): AnySQLiteColumn => stageRuns.id, { onDelete: 'cascade' }),
    iterationIndex: integer('iteration_index'),
    itemIndex: integer('item_index'),
    status: text('status', {
      enum: ['pending', 'ready', 'starting', 'running', 'validating', 'awaiting_input', 'waiting', 'retry_wait', 'paused', 'completed', 'failed', 'skipped', 'cancelled'],
    }).notNull().default('pending'),
    statusReason: text('status_reason'),
    /** CAS version, bumped by every transition and patch. */
    version: integer('version').notNull().default(0),
    currentAttempt: integer('current_attempt').notNull().default(0),
    epoch: integer('epoch').notNull().default(1),
    sessionKey: text('session_key'),
    /** The conversation of the current attempt (what the run page shows). */
    sessionId: text('session_id').references(() => sessions.id),
    skipReason: text('skip_reason'),
    skipCauseId: text('skip_cause_id'),
    gateAs: text('gate_as', { enum: ['completed', 'skipped'] }),
    outputData: text('output_data', { mode: 'json' }).$type<unknown>(),
    outputText: text('output_text'),
    summary: text('summary'),
    artifactManifest: text('artifact_manifest', { mode: 'json' }).$type<unknown[]>(),
    /** Container state (P05): iteration, overrides, exit reason, history. */
    loopState: text('loop_state', { mode: 'json' }).$type<unknown>(),
    expansion: text('expansion', { mode: 'json' }).$type<unknown>(),
    /** What an `awaiting_input` instance asks an approver for. */
    interruptData: text('interrupt_data', { mode: 'json' }).$type<unknown>(),
    usage: text('usage', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    error: text('error'),
    errorClass: text('error_class'),
    errorCode: text('error_code'),
    /** Executor lease (G5 §5.6), stamped by the CAS that enters starting/running. */
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: integer('lease_expires_at', { mode: 'timestamp_ms' }),
    heartbeatAt: integer('heartbeat_at', { mode: 'timestamp_ms' }),
    lastProgressAt: integer('last_progress_at', { mode: 'timestamp_ms' }),
    copiedFromStageRunId: text('copied_from_stage_run_id'),
    /** P03b — set when a follow-up on a completed stage amended its output. */
    amendedAt: integer('amended_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  },
  (table) => ({
    instanceIdx: uniqueIndex('idx_stage_runs_instance').on(table.workflowRunId, table.instancePath),
    workflowRunIdx: index('idx_stage_runs_workflow_run').on(table.workflowRunId),
    runStatusIdx: index('idx_stage_runs_run_status').on(table.workflowRunId, table.status),
    sessionIdx: index('idx_stage_runs_session').on(table.sessionId),
    statusIdx: index('idx_stage_runs_status').on(table.status),
    statusCreatedIdx: index('idx_stage_runs_status_created').on(table.status, table.createdAt),
    scopeIdx: index('idx_stage_runs_scope').on(table.scopeId),
    leaseIdx: index('idx_stage_runs_lease').on(table.status, table.leaseExpiresAt).where(sql`lease_expires_at IS NOT NULL`),
    attentionIdx: index('idx_stage_runs_attention').on(table.status).where(sql`status IN ('awaiting_input', 'paused')`),
  }),
);

// ── Stage Attempts (v57): one execution try of an instance ──

export const stageAttempts = sqliteTable(
  'stage_attempts',
  {
    id: text('id').primaryKey(),
    stageRunId: text('stage_run_id')
      .notNull()
      .references(() => stageRuns.id, { onDelete: 'cascade' }),
    attemptNo: integer('attempt_no').notNull(),
    mode: text('mode', { enum: ['fresh', 'resume', 'restart'] }).notNull(),
    epoch: integer('epoch').notNull(),
    status: text('status', { enum: ['running', 'succeeded', 'failed', 'aborted', 'interrupted'] }).notNull(),
    /** sessions.id (no FK: sessions may be purged). */
    sessionId: text('session_id'),
    repairCount: integer('repair_count').notNull().default(0),
    structuredOutput: text('structured_output', { mode: 'json' }).$type<unknown>(),
    /** P02 — the frozen agent projection the attempt ran with. */
    agentSnapshot: text('agent_snapshot', { mode: 'json' }).$type<unknown>(),
    /** P05 — judge verdicts per repair round. */
    judge: text('judge', { mode: 'json' }).$type<unknown>(),
    error: text('error'),
    errorClass: text('error_class'),
    errorCode: text('error_code'),
    errorDetails: text('error_details', { mode: 'json' }).$type<unknown>(),
    /** Operator prompt or variables override (G5 §3.7). */
    overrides: text('overrides', { mode: 'json' }).$type<unknown>(),
    checkpointBeforeId: text('checkpoint_before_id'),
    usage: text('usage', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    endedAt: integer('ended_at', { mode: 'timestamp_ms' }),
  },
  (table) => ({
    attemptNoIdx: uniqueIndex('idx_stage_attempts_no').on(table.stageRunId, table.attemptNo),
  }),
);

// ── Run Sessions (v57): session_key → conversation, per run ──

export const runSessions = sqliteTable(
  'run_sessions',
  {
    id: text('id').primaryKey(),
    workflowRunId: text('workflow_run_id')
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'cascade' }),
    sessionKey: text('session_key').notNull(),
    sessionId: text('session_id').notNull(),
    /** The instance whose terminal state releases the session. */
    ownerScopeId: text('owner_scope_id'),
    configHash: text('config_hash').notNull(),
    status: text('status', { enum: ['active', 'released'] }).notNull().default('active'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    releasedAt: integer('released_at', { mode: 'timestamp_ms' }),
  },
  (table) => ({
    keyIdx: uniqueIndex('idx_run_sessions_key').on(table.workflowRunId, table.sessionKey),
  }),
);

// ── Workflow Timers (v57): durable timers (retry, pause TTL, waits, budgets) ──

export const workflowTimers = sqliteTable(
  'workflow_timers',
  {
    id: text('id').primaryKey(),
    workflowRunId: text('workflow_run_id')
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'cascade' }),
    stageRunId: text('stage_run_id').references(() => stageRuns.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    fireAt: integer('fire_at', { mode: 'timestamp_ms' }).notNull(),
    firedAt: integer('fired_at', { mode: 'timestamp_ms' }),
    cancelledAt: integer('cancelled_at', { mode: 'timestamp_ms' }),
    payload: text('payload', { mode: 'json' }).$type<unknown>(),
  },
  (table) => ({
    dueIdx: index('idx_workflow_timers_due').on(table.fireAt).where(sql`fired_at IS NULL AND cancelled_at IS NULL`),
    liveKindIdx: uniqueIndex('idx_workflow_timers_live_kind')
      .on(table.workflowRunId, sql`IFNULL(stage_run_id, '')`, table.kind)
      .where(sql`fired_at IS NULL AND cancelled_at IS NULL`),
  }),
);

// ── Workflow Outbox (v57): engine events, dispatched after commit ──

export const workflowOutbox = sqliteTable(
  'workflow_outbox',
  {
    workflowRunId: text('workflow_run_id')
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'cascade' }),
    runSeq: integer('run_seq').notNull(),
    kind: text('kind').notNull(),
    payload: text('payload', { mode: 'json' }).$type<unknown>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    dispatchedAt: integer('dispatched_at', { mode: 'timestamp_ms' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workflowRunId, table.runSeq] }),
    pendingIdx: index('idx_workflow_outbox_pending').on(table.dispatchedAt).where(sql`dispatched_at IS NULL`),
  }),
);

// ── Scheduler Journal (v57): one row per decision batch ──

export const schedulerJournal = sqliteTable(
  'scheduler_journal',
  {
    workflowRunId: text('workflow_run_id')
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    message: text('message', { mode: 'json' }).$type<unknown>().notNull(),
    decisions: text('decisions', { mode: 'json' }).$type<unknown>().notNull(),
    stateHash: text('state_hash').notNull(),
    at: integer('at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workflowRunId, table.seq] }),
  }),
);

// ── Engine Lock (v57, RV-27): one engine process per database ──

export const engineLock = sqliteTable('engine_lock', {
  id: integer('id').primaryKey(),
  ownerId: text('owner_id'),
  bootId: text('boot_id'),
  heartbeatAt: integer('heartbeat_at', { mode: 'timestamp_ms' }),
});


// ── Automations ──

export const automations = sqliteTable(
  'automations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    triggerType: text('trigger_type', { enum: ['manual', 'schedule', 'webhook'] }).notNull(),
    cronExpression: text('cron_expression'),
    /** IANA zone the cron expression is evaluated in (v47). Null = server zone. */
    timezone: text('timezone'),
    /** v47 — catch-up policy for slots missed while offline. */
    missedRunPolicy: text('missed_run_policy', { enum: ['skip', 'run_once'] }).notNull().default('skip'),
    /** v47 — what to do when a slot is due while an execution is still running. */
    overlapPolicy: text('overlap_policy', { enum: ['skip', 'queue'] }).notNull().default('skip'),
    /** sha256(raw token), hex. The only persisted form of the token (v47). */
    webhookTokenHash: text('webhook_token_hash'),
    workflowIds: text('workflow_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
    variables: text('variables', { mode: 'json' }).$type<Record<string, unknown>>().default({}),
    maxConcurrency: integer('max_concurrency').notNull().default(1),
    onError: text('on_error', { enum: ['continue', 'stop'] }).notNull().default('continue'),
    lastRunAt: integer('last_run_at', { mode: 'timestamp' }),
    /**
     * Next due instant for schedule triggers. Written on create / update /
     * enable / fire; the poller claims rows with `next_run_at <= now`.
     */
    nextRunAt: integer('next_run_at', { mode: 'timestamp' }),
    /**
     * Row-level lease. Stamped by the SAME conditional UPDATE that claims a
     * due row, extended by heartbeat while the execution runs, and cleared
     * when the execution finishes (not when it starts). A crashed owner's
     * lease expires and the row becomes claimable again.
     */
    lockedUntil: integer('locked_until', { mode: 'timestamp' }),
    lockedByProcess: text('locked_by_process'),
    scope: text('scope').default('global'),
    projectId: text('project_id'),
    useWorktree: integer('use_worktree', { mode: 'boolean' }).notNull().default(true),
    // ── Track C — schema-driven pipeline ──
    dataSchema: text('data_schema', { mode: 'json' }).$type<DataSchema>(),
    iterationMode: text('iteration_mode', { mode: 'json' }).$type<IterationMode>(),
    defaultDataset: text('default_dataset', { mode: 'json' }).$type<AutomationDataset>(),
    retryPolicy: text('retry_policy', { mode: 'json' }).$type<AutomationRetryPolicy>(),
    /**
     * v56 (PD-18) — the permission mode an automation's unattended runs use.
     * Required; bypass on a webhook trigger needs an admin-scoped opt-in.
     */
    permissionMode: text('permission_mode', { enum: ['default', 'acceptEdits', 'plan', 'bypassPermissions'] })
      .notNull()
      .default('acceptEdits'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    enabledIdx: index('idx_automations_enabled').on(table.enabled),
    scopeIdx: index('idx_automations_scope').on(table.scope),
    projectIdx: index('idx_automations_project').on(table.projectId),
    triggerTypeIdx: index('idx_automations_trigger_type').on(table.triggerType),
    createdAtIdx: index('idx_automations_created_at').on(table.createdAt),
    lockIdx: index('idx_automations_lock').on(table.lockedUntil),
    webhookTokenHashIdx: index('idx_automations_webhook_token_hash').on(table.webhookTokenHash),
    dueIdx: index('idx_automations_due').on(table.triggerType, table.enabled, table.nextRunAt),
  }),
);

// ── Automation Executions ──

export const automationExecutions = sqliteTable(
  'automation_executions',
  {
    id: text('id').primaryKey(),
    automationId: text('automation_id')
      .notNull()
      .references(() => automations.id, { onDelete: 'cascade' }),
    status: text('status', {
      enum: ['pending', 'running', 'completed', 'partial', 'failed', 'cancelled'],
    }).notNull().default('pending'),
    triggeredBy: text('triggered_by', { enum: ['manual', 'schedule', 'webhook'] }).notNull(),
    webhookPayload: text('webhook_payload'),
    totalIterations: integer('total_iterations').notNull().default(0),
    completedIterations: integer('completed_iterations').notNull().default(0),
    failedIterations: integer('failed_iterations').notNull().default(0),
    error: text('error'),
    workspaceId: text('workspace_id'),
    /**
     * Track C — audit snapshot of the dataset used for this run.
     * Null for legacy automations (no dataSchema).
     */
    datasetSnapshot: text('dataset_snapshot', { mode: 'json' }).$type<AutomationDataset>(),
    startedAt: integer('started_at', { mode: 'timestamp' }),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    automationIdx: index('idx_automation_executions_automation').on(table.automationId),
    statusIdx: index('idx_automation_executions_status').on(table.status),
    createdAtIdx: index('idx_automation_executions_created_at').on(table.createdAt),
  }),
);

// ── Automation Execution Runs ──

export const automationExecutionRuns = sqliteTable(
  'automation_execution_runs',
  {
    id: text('id').primaryKey(),
    executionId: text('execution_id')
      .notNull()
      .references(() => automationExecutions.id, { onDelete: 'cascade' }),
    /** Nulled when the run is deleted; the iteration record stays. */
    workflowRunId: text('workflow_run_id').references(() => workflowRuns.id, { onDelete: 'set null' }),
    workflowDefinitionId: text('workflow_definition_id')
      .notNull()
      .references(() => workflowDefinitions.id),
    iterationIndex: integer('iteration_index').notNull().default(0),
    iterationVariables: text('iteration_variables', { mode: 'json' }).$type<Record<string, unknown>>(),
    iterationLabel: text('iteration_label'),
    status: text('status', {
      enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
    }).notNull().default('pending'),
    /** Track A — how many attempts this run consumed (1 = no retry). */
    attemptCount: integer('attempt_count').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    executionIdx: index('idx_automation_exec_runs_execution').on(table.executionId),
    workflowRunIdx: index('idx_automation_exec_runs_workflow_run').on(table.workflowRunId),
    statusIdx: index('idx_automation_exec_runs_status').on(table.status),
    iterationIdx: index('idx_automation_exec_runs_iteration').on(table.iterationIndex),
  }),
);

// ── Idempotency Keys ──
// Track A-3: dedup key store for `POST /:id/trigger` and webhook deliveries.
// A previously-seen key returns the same executionId instead of spawning a
// new run. Expired rows are removed by the background sweeper.
export const idempotencyKeys = sqliteTable(
  'idempotency_keys',
  {
    key: text('key').notNull(),
    scope: text('scope').notNull(),
    executionId: text('execution_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    pk: uniqueIndex('pk_idempotency_keys').on(table.key, table.scope),
    // Sweep scans `WHERE expires_at < now`; leading column must be expires_at.
    expiresIdx: index('idx_idempotency_keys_expires').on(table.expiresAt),
  }),
);

// ── Projects ──

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    settings: text('settings', { mode: 'json' }).$type<ProjectSettings>().default({}),
    rootPath: text('root_path').notNull(),
    status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    statusIdx: index('idx_projects_status').on(table.status),
    createdAtIdx: index('idx_projects_created_at').on(table.createdAt),
    nameIdx: index('idx_projects_name').on(table.name),
  }),
);

// ── Project Codebases ──

export const projectCodebases = sqliteTable(
  'project_codebases',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    alias: text('alias').notNull(),
    type: text('type', { enum: ['git-remote', 'git-local', 'local-dir'] }).notNull(),
    url: text('url'),
    localPath: text('local_path'),
    defaultBranch: text('default_branch'),
    subdirectory: text('subdirectory'),
    clonePath: text('clone_path'),
    status: text('status', { enum: ['pending', 'cloning', 'ready', 'error', 'stale'] }).notNull().default('pending'),
    lastFetchedAt: integer('last_fetched_at', { mode: 'timestamp' }),
    lastError: text('last_error'),
    settings: text('settings', { mode: 'json' }).$type<CodebaseSettings>().default({}),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    projectIdx: index('idx_project_codebases_project').on(table.projectId),
    aliasIdx: uniqueIndex('idx_project_codebases_alias').on(table.projectId, table.alias),
    statusIdx: index('idx_project_codebases_status').on(table.status),
  }),
);

// ── Project Configs (agents/prompts/skills metadata) ──

export const projectConfigs = sqliteTable(
  'project_configs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['agent', 'prompt', 'skill', 'mcp'] }).notNull(), // W46-G16: project_configs enum
    name: text('name').notNull(),
    description: text('description'),
    filePath: text('file_path').notNull(),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>().default({}),
    /**
     * v48 — MCP configs only: NAMES of the credentials stored in the secrets
     * vault under `mcp/project/<id>` (`McpCredentialVault`). Never values.
     */
    credentialRefs: text('credential_refs', { mode: 'json' }).$type<{ headers?: string[]; env?: string[] }>(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    projectIdx: index('idx_project_configs_project').on(table.projectId),
    typeIdx: index('idx_project_configs_type').on(table.projectId, table.type),
    uniqueNameIdx: uniqueIndex('idx_project_configs_unique_name').on(table.projectId, table.type, table.name),
  }),
);

// ── Worktrees ──

export const worktrees = sqliteTable(
  'worktrees',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    codebaseId: text('codebase_id')
      .notNull()
      .references(() => projectCodebases.id, { onDelete: 'cascade' }),
    runId: text('run_id'),
    runType: text('run_type', { enum: ['workflow', 'automation', 'manual'] }),
    worktreePath: text('worktree_path').notNull(),
    branchName: text('branch_name').notNull(),
    status: text('status', { enum: ['active', 'completed', 'orphaned', 'cleanup-pending'] }).notNull().default('active'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    cleanedUpAt: integer('cleaned_up_at', { mode: 'timestamp' }),
  },
  (table) => ({
    projectIdx: index('idx_worktrees_project').on(table.projectId),
    codebaseIdx: index('idx_worktrees_codebase').on(table.codebaseId),
    runIdx: index('idx_worktrees_run').on(table.runId),
    statusIdx: index('idx_worktrees_status').on(table.status),
  }),
);

// ── System Configs (system-level skills/prompts/agents) ──

export const systemConfigs = sqliteTable(
  'system_configs',
  {
    id: text('id').primaryKey(),
    type: text('type', { enum: ['agent', 'prompt', 'skill', 'mcp'] }).notNull(), // W46-G16
    name: text('name').notNull(),
    description: text('description'),
    filePath: text('file_path').notNull(),
    version: text('version').default('1.0.0'),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>().default({}),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    typeIdx: index('idx_system_configs_type').on(table.type),
    uniqueNameIdx: uniqueIndex('idx_system_configs_unique').on(table.type, table.name),
  }),
);

// ── Execution Workspaces ──

export const executionWorkspaces = sqliteTable(
  'execution_workspaces',
  {
    id: text('id').primaryKey(),
    ownerType: text('owner_type', {
      enum: ['chat', 'workflow_run', 'automation_execution'],
    }).notNull(),
    ownerId: text('owner_id').notNull(),
    projectId: text('project_id'),
    rootPath: text('root_path').notNull(),
    // Where the agent works; defaults to root_path. Set when a chat is bound
    // to a local folder so artifacts stay out of the user's repository.
    codeRoot: text('code_root'),
    status: text('status', {
      enum: ['creating', 'active', 'completed', 'archived', 'failed'],
    }).notNull().default('creating'),
    // Mount preparation (v51). 'ready' for workspaces that predate mounts.
    prepStatus: text('prep_status', { enum: ['pending', 'preparing', 'ready', 'error'] }).notNull().default('ready'),
    prepError: text('prep_error'),
    gitEnabled: integer('git_enabled', { mode: 'boolean' }).notNull().default(true),
    useWorktree: integer('use_worktree', { mode: 'boolean' }).notNull().default(true),
    snapshotPath: text('snapshot_path'),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    // Integrated Browser (v13). All optional — browser is only initialised when
    // a workspace opts in via `browserConfig.enabled` or when the linked chat/run
    // includes the `playwright-cli` skill with browser enabled.
    browserConfig: text('browser_config', { mode: 'json' }).$type<Record<string, unknown>>(),
    browserStatus: text('browser_status', {
      enum: ['off', 'starting', 'active', 'idle', 'terminated', 'error'],
    }),
    browserCurrentUrl: text('browser_current_url'),
    /** CDP endpoint URL exposed by the shared Chromium (e.g. http://127.0.0.1:9333). */
    browserCdpEndpoint: text('browser_cdp_endpoint'),
    /** CDP `targetId` of the top-level page under agent+user control. */
    browserTargetId: text('browser_target_id'),
    browserStartedAt: integer('browser_started_at', { mode: 'timestamp' }),
    browserLastActivityAt: integer('browser_last_activity_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
    archivedAt: integer('archived_at', { mode: 'timestamp' }),
  },
  (table) => ({
    ownerIdx: index('idx_execution_workspaces_owner').on(table.ownerType, table.ownerId),
    ownerUnique: uniqueIndex('idx_execution_workspaces_owner_unique').on(table.ownerType, table.ownerId),
    projectIdx: index('idx_execution_workspaces_project').on(table.projectId),
    statusIdx: index('idx_execution_workspaces_status').on(table.status),
    browserStatusIdx: index('idx_execution_workspaces_browser_status').on(table.browserStatus),
  }),
);

// ── Workspace Mounts ──
//
// One row per directory the agent may edit. Position 0 is the primary mount
// (the agent's cwd); the rest are additional directories. Replaces the
// never-written `workspace_worktrees` tracking table (v51).

export const workspaceMounts = sqliteTable(
  'workspace_mounts',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => executionWorkspaces.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    alias: text('alias').notNull(),
    originKind: text('origin_kind', { enum: ['codebase', 'folder', 'generated'] }).notNull(),
    codebaseId: text('codebase_id'),
    projectId: text('project_id'),
    originPath: text('origin_path'),
    mode: text('mode', { enum: ['in-place', 'worktree', 'generated'] }).notNull(),
    path: text('path').notNull(),
    git: text('git', { mode: 'json' }).$type<Record<string, unknown>>(),
    status: text('status', { enum: ['preparing', 'ready', 'error', 'removed'] }).notNull().default('preparing'),
    error: text('error'),
    hasUncommittedChanges: integer('has_uncommitted_changes', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    workspaceIdx: index('idx_workspace_mounts_workspace').on(table.workspaceId),
    codebaseIdx: index('idx_workspace_mounts_codebase').on(table.codebaseId),
    aliasUnique: uniqueIndex('idx_workspace_mounts_alias').on(table.workspaceId, table.alias),
  }),
);

// ── Workspace Artifacts ──

export const workspaceArtifacts = sqliteTable(
  'workspace_artifacts',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => executionWorkspaces.id, { onDelete: 'cascade' }),
    stageRunId: text('stage_run_id'),
    artifactType: text('artifact_type', {
      enum: [
        'code_file',
        'response_md',
        'attachment',
        'script_output',
        'log',
        'snapshot',
        // Integrated Browser (v13) — outputs produced by the Playwright-CLI
        // skill and BrowserService (screenshot, DOM snapshot, HAR, console log,
        // recorded video, inspector selection).
        'browser_screenshot',
        'browser_dom',
        'browser_har',
        'browser_console_log',
        'browser_video',
        'browser_selection',
        // Computer Use — always a single-window capture, never full-screen.
        'computer_screenshot',
      ],
    }).notNull(),
    relativePath: text('relative_path').notNull(),
    fileSize: integer('file_size'),
    mimeType: text('mime_type'),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    workspaceIdx: index('idx_workspace_artifacts_workspace').on(table.workspaceId),
    stageRunIdx: index('idx_workspace_artifacts_stage').on(table.stageRunId),
  }),
);

// ── Computer Use ──
//
// `computer_use_grants` holds only durable decisions. `allow_once` is never
// written: a one-shot approval that survived the turn would be a standing
// grant under another name.
export const computerUseGrants = sqliteTable(
  'computer_use_grants',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => executionWorkspaces.id, { onDelete: 'cascade' }),
    /** Bundle id / AUMID / desktop-file id — never the display name. */
    appIdentity: text('app_identity').notNull(),
    appLabel: text('app_label').notNull(),
    decision: text('decision', { enum: ['always_allow', 'deny'] }).notNull(),
    /**
     * Privilege tier the grant covers. Approving a prompt that read
     * "snapshot in Slack" must not authorise every future keystroke there.
     */
    scope: text('scope', { enum: ['read', 'mutate', 'synthetic'] }).notNull().default('read'),
    grantedAt: integer('granted_at', { mode: 'timestamp' }).notNull(),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  },
  (table) => ({
    unique: uniqueIndex('idx_cu_grants_unique').on(table.workspaceId, table.appIdentity),
  }),
);

// Refusals are recorded alongside successes — a blocked attempt against a
// password manager is the row a security review most needs to see, and it is
// the only evidence the control fired.
export const computerUseAudit = sqliteTable(
  'computer_use_audit',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    chatId: text('chat_id'),
    appIdentity: text('app_identity').notNull(),
    appLabel: text('app_label').notNull(),
    action: text('action').notNull(),
    /** Element label or identifier — never typed content. */
    target: text('target'),
    /** ComputerActionPath: accessibility | hit-tested | synthetic | clipboard. */
    path: text('path'),
    verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
    refusalCode: text('refusal_code'),
    /** `<field>:<blocklist entry>` when the refusal was `app_blocked`. */
    blockedOn: text('blocked_on'),
    artifactPath: text('artifact_path'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    workspaceTimeIdx: index('idx_cu_audit_ws_time').on(table.workspaceId, table.createdAt),
    refusalIdx: index('idx_cu_audit_refusal').on(table.refusalCode),
  }),
);

// ── Workspace Checkpoints (snapshots via private git refs) ──
//
// One row per captured snapshot. `ref_value` is a commit object reachable
// only from `refs/generatorai/checkpoints/…`; `tree_sha` is the snapshot
// content used for every diff. Deleting a row makes the objects GC-able.
export const checkpoints = sqliteTable(
  'checkpoints',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    /** Repo alias within the workspace (`.` = workspace root). */
    repoAlias: text('repo_alias').notNull().default('.'),
    /** Monotonic per (workspace_id, repo_alias). */
    seq: integer('seq').notNull(),
    kind: text('kind', {
      enum: ['baseline', 'turn', 'stage', 'autorun', 'live', 'manual', 'pre_restore'],
    }).notNull(),
    label: text('label'),
    refKind: text('ref_kind', { enum: ['git_tree'] }).notNull().default('git_tree'),
    refValue: text('ref_value').notNull(),
    treeSha: text('tree_sha').notNull(),
    parentId: text('parent_id'),
    // Provenance — at most one branch populated.
    sessionId: text('session_id'),
    chatId: text('chat_id'),
    turnId: text('turn_id'),
    workflowRunId: text('workflow_run_id'),
    stageRunId: text('stage_run_id'),
    automationExecutionRunId: text('automation_execution_run_id'),
    /** `before` | `after` — which side of the turn/stage this snapshot is. */
    phase: text('phase', { enum: ['before', 'after'] }),
    promptExcerpt: text('prompt_excerpt'),
    fileCount: integer('file_count').notNull().default(0),
    additions: integer('additions').notNull().default(0),
    deletions: integer('deletions').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    workspaceIdx: index('idx_checkpoints_workspace').on(table.workspaceId),
    seqUnique: uniqueIndex('idx_checkpoints_ws_alias_seq').on(
      table.workspaceId,
      table.repoAlias,
      table.seq,
    ),
    turnIdx: index('idx_checkpoints_turn').on(table.turnId),
    stageRunIdx: index('idx_checkpoints_stage_run').on(table.stageRunId),
    kindIdx: index('idx_checkpoints_kind').on(table.kind),
  }),
);

// ── Review Threads (inline comments on diffs) ──
//
// A thread is anchored to a LINE RANGE in a file, against a specific
// base→head checkpoint pair. `anchor_text` + `anchor_hash` are what let the
// anchor survive later edits: line numbers are re-derived by content match
// rather than trusted, so a comment never drifts onto unrelated code.
export const reviewThreads = sqliteTable(
  'review_threads',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    scope: text('scope', { enum: ['chat', 'run', 'automation'] }).notNull(),
    scopeId: text('scope_id').notNull(),
    repoAlias: text('repo_alias').notNull().default('.'),
    path: text('path').notNull(),
    baseCheckpointId: text('base_checkpoint_id').notNull(),
    headCheckpointId: text('head_checkpoint_id').notNull(),
    side: text('side', { enum: ['additions', 'deletions'] }).notNull(),
    startLine: integer('start_line').notNull(),
    endLine: integer('end_line').notNull(),
    anchorText: text('anchor_text').notNull(),
    anchorHash: text('anchor_hash').notNull(),
    status: text('status', {
      enum: ['draft', 'pending', 'submitted', 'addressed', 'resolved', 'outdated'],
    })
      .notNull()
      .default('pending'),
    resolvedByCheckpointId: text('resolved_by_checkpoint_id'),
    submittedMessageId: text('submitted_message_id'),
    reviewRound: integer('review_round').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    workspaceIdx: index('idx_review_threads_workspace').on(table.workspaceId),
    scopeIdx: index('idx_review_threads_scope').on(table.scope, table.scopeId),
    fileIdx: index('idx_review_threads_file').on(
      table.workspaceId,
      table.repoAlias,
      table.path,
    ),
    statusIdx: index('idx_review_threads_status').on(table.status),
  }),
);

// ── Review Comments ──

export const reviewComments = sqliteTable(
  'review_comments',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => reviewThreads.id, { onDelete: 'cascade' }),
    author: text('author', { enum: ['user', 'agent'] }).notNull(),
    body: text('body').notNull(),
    intent: text('intent', { enum: ['fix', 'question', 'note', 'refactor', 'test'] }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    threadIdx: index('idx_review_comments_thread').on(table.threadId),
  }),
);

// ── Plan mode (v21) ──
//
// The DB is authoritative for plans; the markdown file under
// `.generatorai/plans/` is a git-ignored projection so draft plans never
// pollute the Changes panel, checkpoints, or commits.

export const planDocuments = sqliteTable(
  'plan_documents',
  {
    id: text('id').primaryKey(),
    chatId: text('chat_id').notNull(),
    sessionId: text('session_id').notNull(),
    /** The turn that produced the current revision. */
    turnId: text('turn_id').notNull(),
    title: text('title').notNull(),
    /** Server-generated. Never provider-supplied (path-traversal defence). */
    fileName: text('file_name').notNull(),
    filePath: text('file_path'),
    status: text('status', {
      enum: [
        'drafting',
        'recorded',
        'awaiting_review',
        'changes_requested',
        'approved',
        'rejected',
        'superseded',
        'expired',
      ],
    })
      .notNull()
      .default('drafting'),
    currentRevision: integer('current_revision').notNull().default(1),
    /** The harness that produced the plan (recorded, never defaulted). */
    harnessType: text('harness_type').notNull(),
    availableActions: text('available_actions', { mode: 'json' }).$type<string[]>().default([]),
    recommendedAction: text('recommended_action'),
    decision: text('decision', { mode: 'json' }).$type<unknown>(),
    /** Set when the plan came from a workflow stage rather than a chat turn (v22). */
    stageRunId: text('stage_run_id'),
    workflowRunId: text('workflow_run_id'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    chatIdx: index('idx_plan_documents_chat').on(table.chatId, table.createdAt),
    statusIdx: index('idx_plan_documents_status').on(table.chatId, table.status),
    stageIdx: index('idx_plan_documents_stage').on(table.stageRunId),
  }),
);

export const planRevisions = sqliteTable(
  'plan_revisions',
  {
    id: text('id').primaryKey(),
    planId: text('plan_id')
      .notNull()
      .references(() => planDocuments.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    content: text('content').notNull(),
    summary: text('summary').notNull().default(''),
    authoredBy: text('authored_by', { enum: ['agent', 'user'] }).notNull().default('agent'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    uniqueRevision: uniqueIndex('idx_plan_revisions_unique').on(table.planId, table.revision),
  }),
);

export const planComments = sqliteTable(
  'plan_comments',
  {
    id: text('id').primaryKey(),
    planId: text('plan_id')
      .notNull()
      .references(() => planDocuments.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    // Line numbers drift between revisions, so the anchor also stores the
    // quoted text and a content hash (same approach as review_threads).
    anchorStartLine: integer('anchor_start_line'),
    anchorEndLine: integer('anchor_end_line'),
    anchorText: text('anchor_text'),
    anchorHash: text('anchor_hash'),
    body: text('body').notNull(),
    resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    planIdx: index('idx_plan_comments_plan').on(table.planId, table.revision),
  }),
);

/**
 * Durable human-interaction gates.
 *
 * Generalises HITL beyond stage runs: a chat can block an in-flight SDK
 * callback on a human decision. Unlike a stage run, a chat gate CANNOT be
 * resumed after a restart (the blocked vendor callback is gone) — hence the
 * `expired` status.
 */
export const agentInteractions = sqliteTable(
  'agent_interactions',
  {
    id: text('id').primaryKey(),
    scopeKind: text('scope_kind', { enum: ['chat', 'stage_run'] }).notNull(),
    scopeId: text('scope_id').notNull(),
    chatId: text('chat_id'),
    sessionId: text('session_id'),
    turnId: text('turn_id'),
    kind: text('kind', { enum: ['plan_review', 'question', 'tool_permission'] }).notNull(),
    status: text('status', {
      enum: [
        'pending',
        'approved',
        'changes_requested',
        'answered',
        'rejected',
        'cancelled',
        'expired',
        'failed',
      ],
    })
      .notNull()
      .default('pending'),
    payload: text('payload', { mode: 'json' }).$type<unknown>(),
    resolution: text('resolution', { mode: 'json' }).$type<unknown>(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    resolvedAt: integer('resolved_at', { mode: 'timestamp' }),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
  },
  (table) => ({
    chatIdx: index('idx_agent_interactions_chat').on(table.chatId, table.status),
    scopeIdx: index('idx_agent_interactions_scope').on(table.scopeKind, table.scopeId, table.status),
  }),
);

// ── Widget Instances (extension-rendered UI) ──
//
// A row per rendered widget instance. Instances outlive turns for
// replay (chatMessageToBlocks stitches them back into the timeline) and
// carry the current state so refreshing the page shows the same UI.
export const widgetInstances = sqliteTable(
  'widget_instances',
  {
    id: text('id').primaryKey(),
    descriptorId: text('descriptor_id').notNull(),  // "<extensionId>/<component>"
    sessionId: text('session_id').notNull(),
    chatId: text('chat_id'),
    workflowRunId: text('workflow_run_id'),
    stageRunId: text('stage_run_id'),
    messageId: text('message_id'),
    surface: text('surface', { enum: ['inline', 'widget'] }).notNull(),
    props: text('props', { mode: 'json' }).$type<unknown>(),
    state: text('state', { mode: 'json' }).$type<unknown>(),
    status: text('status', { enum: ['active', 'suspended', 'closed', 'error'] })
      .notNull()
      .default('active'),
    error: text('error'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    sessionIdx: index('idx_widget_instances_session').on(table.sessionId),
    chatIdx: index('idx_widget_instances_chat').on(table.chatId),
    runIdx: index('idx_widget_instances_run').on(table.workflowRunId),
    stageIdx: index('idx_widget_instances_stage').on(table.stageRunId),
  }),
);

// ── Agents (first-class, user-authored agent definitions) ──
//
// An agent bundles instructions, a capability policy and a runtime policy under a
// portable `scope:slug` ref. Bindings elsewhere store that REF, not this id, so
// workflow templates and exports stay portable across machines.
export const agents = sqliteTable(
  'agents',
  {
    id: text('id').primaryKey(),
    scope: text('scope', { enum: ['system', 'global', 'project'] }).notNull(),
    // NOT NULL DEFAULT '' — SQLite treats NULLs as distinct in UNIQUE indexes,
    // so a nullable column would allow unlimited ('global', NULL, slug) rows.
    projectId: text('project_id').notNull().default(''),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    instructions: text('instructions').notNull(),
    role: text('role', { enum: ['agent', 'orchestrator'] }).notNull().default('agent'),
    projection: text('projection', { enum: ['append', 'replace'] }).notNull().default('append'),
    icon: text('icon'),
    color: text('color'),
    tags: text('tags', { mode: 'json' }).$type<string[]>().default([]),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    skillIds: text('skill_ids', { mode: 'json' }).$type<string[]>().default([]),
    mcpServerIds: text('mcp_server_ids', { mode: 'json' }).$type<string[]>().default([]),
    tools: text('tools', { mode: 'json' }).$type<Partial<AgentToolPolicy>>().default({}),
    runtime: text('runtime', { mode: 'json' }).$type<AgentRuntimePolicy>().default({}),
    orchestration: text('orchestration', { mode: 'json' }).$type<AgentOrchestrationPolicy>(),
    version: integer('version').notNull().default(1),
    sourcePath: text('source_path'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    scopeIdx: index('idx_agents_scope').on(table.scope, table.projectId),
    slugIdx: uniqueIndex('idx_agents_slug_unique').on(table.scope, table.projectId, table.slug),
    roleIdx: index('idx_agents_role').on(table.role),
  }),
);

/** Re-exported so repositories can reference the JSON column shapes. */
export type AgentChatOverrides = AgentOverrides;
export type AgentChatSnapshot = ResolvedAgentProjection;
// ── Workspace change review (Changes tab "Keep" per file) ──
//
// A kept file is one the user reviewed and accepted at a given content blob.
// The change summary marks a file `kept` while its working-tree blob still
// equals `accepted_blob`; a later edit by the agent un-keeps it automatically.
export const workspaceFileReviews = sqliteTable(
  'workspace_file_reviews',
  {
    workspaceId: text('workspace_id').notNull(),
    alias: text('alias').notNull(),
    path: text('path').notNull(),
    /** Working-tree blob sha the user accepted; '' for a deleted file. */
    acceptedBlob: text('accepted_blob').notNull(),
    acceptedAt: integer('accepted_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.alias, table.path] }),
    workspaceIdx: index('idx_workspace_file_reviews_ws').on(table.workspaceId),
  }),
);
