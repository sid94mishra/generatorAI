// ────────────────────────────────────────────────────────────────
// AttentionService — the cross-entity "Needs you" + "Running" feed (G-01).
//
// docs/redesign/05-gap-matrix.md §G-01. One in-memory snapshot of everything
// waiting for a person and everything executing right now, across chats,
// workflow runs and automation executions:
//
//   Needs you  pending chat gates (tool_permission, question, plan_review),
//              stage runs in `awaiting_input` (stage_approval, stage_input),
//              pending computer consent, and paused runs (run_paused).
//   Running    top-level chats with an active turn (or with background
//              workers that have one), runs in running/starting/cancelling,
//              and automation executions in pending/running.
//
// Worker chats are internal (D-86): a worker that is working is not an item of
// its own — it rolls up into its orchestrator's Running item ("2 background
// tasks running"), so Running, its count and the Home System card all count
// what a person started. A worker that ASKS is still listed under Needs you
// (it is waiting on the person), opened on the orchestrator's Tasks dock.
//
// An entity with at least one ask is listed under Needs you only: a chat
// blocked on a permission prompt is technically still streaming, but "it is
// waiting for you" is the only thing worth saying about it (the same rule as
// `chatActivity` in the shared status map).
//
// How it stays correct
// --------------------
// Bus events are TRIGGERS, never data. Any event that touches an entity
// schedules a re-read of that one entity from its repositories and the result
// is diffed against the snapshot. Reading the authoritative rows means a
// missed, duplicated or reordered event cannot leave a stale ask behind —
// the next event for the entity repairs it — and there is no second copy of
// each gate's state machine to keep in sync. Re-reads of one entity are
// serialised and coalesced, so a burst of stage events costs one extra read.
//
// Streaming chats come from `ChatManagementService.onStreamingChange` rather
// than from `harness.turn_start` / `harness.idle`, which race the in-flight
// registry they would describe (see `StreamingChatRegistry`).
//
// Deltas
// ------
// Every change bumps `seq` and is emitted on the `global` scope as
// `attention.upsert` / `attention.remove`, followed by one `attention.counts`
// per batch. Emits are chained so the durable stream sees them in `seq`
// order. `seq` starts at `Date.now() * 1000` so a restart always jumps past
// any value a client saw from the previous process: the client sees a gap and
// refetches the snapshot, which is exactly right, since the new process
// rebuilt it from scratch.
//
// Workflow engine files are read-only for the redesign (07-phases §Running in
// parallel), so stage asks are read through `IStageRunRepository.getByRunId`:
// a v2 instance parked on a gate is `awaiting_input` with the ask in
// `interruptData`, inside a non-terminal run, and those runs are listed
// anyway. The definition's name comes from its working graph
// (`IWorkflowDefinitionStore.getGraph`); the run carries its own project.
// Empty run history (the overhaul's v55/v57 purge) simply yields no run items.
// ────────────────────────────────────────────────────────────────

import {
  STATUS_MAPS,
  compareAttentionItems,
  countAttention,
  type AgentEvent,
  type AgentInteraction,
  type AttentionAction,
  type AttentionAsk,
  type AttentionFilter,
  type AttentionItem,
  type AttentionItemState,
  type AttentionSnapshot,
  type ActivityMeta,
  type ActivityWorkerTally,
  type Automation,
  type AutomationExecution,
  type Chat,
  type ILogger,
  type PersistedEvent,
  type Project,
  type StageRun,
  type StatusMapping,
  type WorkflowRun,
  type WorkflowRunStatus,
} from '@generatorai/shared';
import { permissionWording, toolDisplayName } from '@generatorai/shared/ui-contract';

// ── Ports (narrow, so tests can hand in real repositories or fakes) ──

export interface AttentionEventBus {
  subscribeAll(handler: (event: PersistedEvent) => void, name?: string): () => void;
  subscribeGlobal(handler: (event: PersistedEvent) => void): () => void;
  emitGlobal(event: AgentEvent): Promise<void>;
}

export interface AttentionStreamingSource {
  getStreamingSince(): Map<string, Date>;
  onStreamingChange(listener: (chatId: string, streaming: boolean) => void): () => void;
}

export interface AttentionConsentEntry {
  requestId: string;
  workspaceId: string;
  chatId?: string;
  appLabel: string;
  action: string;
  summary: string;
  expiresAt: number;
}

export interface AttentionServiceDeps {
  eventBus: AttentionEventBus;
  chats: {
    getById(id: string): Promise<Chat>;
    /** The chats on a workspace — resolves a computer consent that carries no `chatId`. */
    getByWorkspaceId(workspaceId: string): Promise<Chat[]>;
    /** An orchestrator's worker chats, for its `meta.workers` tally (D-92). Optional: no tally without it. */
    listBackgroundTasks?(parentChatId: string): Promise<Chat[]>;
  };
  projects: { getById(id: string): Promise<Project> };
  interactions?: {
    listPendingAll(): Promise<AgentInteraction[]>;
    listPendingByChat(chatId: string): Promise<AgentInteraction[]>;
  };
  streaming: AttentionStreamingSource;
  runs: {
    getById(id: string): Promise<WorkflowRun>;
    getByStatus(statuses: WorkflowRunStatus[]): Promise<WorkflowRun[]>;
  };
  stageRuns: { getByRunId(workflowRunId: string): Promise<StageRun[]> };
  /** The definition store: only the working graph's name and project are read. */
  definitions: {
    getGraph(id: string): Promise<{
      graph: { workflow: { name: string; projectId?: string | null | undefined }; stages?: ReadonlyArray<{ key: string }> };
    }>;
  };
  automations: {
    getAll(): Promise<Automation[]>;
    getById(id: string): Promise<Automation>;
  };
  executions: {
    getExecutionById(id: string): Promise<AutomationExecution>;
    getExecutionsByAutomationId(automationId: string): Promise<AutomationExecution[]>;
    /**
     * Ids of the live executions in one query. When the store offers it (the
     * composition root wires `listAutomationExecutionIdsByStatus`), the boot
     * rebuild uses it instead of reading every automation's whole history.
     */
    listIdsByStatus?(statuses: readonly AutomationExecution['status'][]): Promise<string[]>;
  };
  consent?: { listAllPending(): AttentionConsentEntry[] };
  logger?: Pick<ILogger, 'info' | 'warn'>;
  /** Clock, for tests. */
  now?: () => number;
  /** First `seq` value, for tests. Defaults to `Date.now() * 1000`. */
  seqBase?: number;
}

// ── Pure helpers ──────────────────────────────────────────────────

/** Runs in these statuses are live (Running or, when paused, Needs you). Engine v2 states. */
const LIVE_RUN_STATUSES: readonly WorkflowRunStatus[] = ['starting', 'running', 'waiting', 'paused', 'finalizing', 'cancelling'];
const STOPPABLE_RUN_STATUSES: ReadonlySet<WorkflowRunStatus> = new Set(['starting', 'running', 'waiting', 'paused']);
/** Instances whose attempt is live: the Running item's progress label. */
const ACTIVE_STAGE_STATUSES: ReadonlySet<StageRun['status']> = new Set(['starting', 'running', 'validating']);
/** Instances that are live but idle on a timer, an event or a retry backoff. */
const WAITING_STAGE_STATUSES: ReadonlySet<StageRun['status']> = new Set(['waiting', 'retry_wait']);
const LIVE_EXECUTION_STATUS_LIST: readonly AutomationExecution['status'][] = ['pending', 'running'];
const LIVE_EXECUTION_STATUSES: ReadonlySet<AutomationExecution['status']> = new Set(LIVE_EXECUTION_STATUS_LIST);
const TERMINAL_STAGE_STATUSES: ReadonlySet<StageRun['status']> = new Set([
  'completed',
  'failed',
  'cancelled',
  'skipped',
]);

const SUMMARY_MAX = 120;
const DETAIL_MAX = 240;
const LABEL_MAX = 80;

function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** Last path segment, for either separator — a server on Windows sends `\`. */
function lastSegment(path: string): string {
  const parts = path.split(/[\\/]/).filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? path;
}

/** The server mints run names as `<definition> - Run <epoch-ms>`; the suffix is bookkeeping. */
export function stripRunEpoch(name: string): string {
  const stripped = name.replace(/\s*[-–—]\s*Run\s+\d{10,}\s*$/i, '').trim();
  return stripped.length > 0 ? stripped : name;
}

function stateOf(mapping: StatusMapping | null, fallback: AttentionItemState): AttentionItemState {
  const state = mapping?.state;
  return state === 'needs_you' || state === 'running' || state === 'waiting' || state === 'paused' || state === 'queued'
    ? state
    : fallback;
}

function iso(value: Date | string | number | undefined | null): string | undefined {
  if (value === undefined || value === null) return undefined;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * "Running pnpm build", "Edit App.tsx", "Grep TODO" — the latest step of a
 * streaming chat, from a `harness.tool_start` event.
 */
export function describeToolStep(tool: unknown, args: unknown): string | undefined {
  const raw = str(tool);
  if (!raw) return undefined;
  // `mcp__generatorai-tools__check_background_agents` reads as "Check tasks" (the transcript's name for it).
  const name = toolDisplayName(raw);
  const a = record(args);
  const command = str(a?.['command']) ?? str(a?.['cmd']) ?? str(a?.['fullCommandText']);
  if (command) return clip(`Running ${command.split('\n')[0] ?? command}`, LABEL_MAX);
  const path = str(a?.['file_path']) ?? str(a?.['filePath']) ?? str(a?.['path']);
  if (path) return clip(`${name} ${lastSegment(path)}`, LABEL_MAX);
  const target = str(a?.['pattern']) ?? str(a?.['query']) ?? str(a?.['url']);
  if (target) return clip(`${name} ${target}`, LABEL_MAX);
  return clip(name, LABEL_MAX);
}

/** Summary, detail and actions for a pending chat gate. */
export function describeInteraction(
  interaction: Pick<AgentInteraction, 'kind' | 'payload'>,
): Pick<AttentionAsk, 'summary' | 'detail' | 'actions' | 'risk'> {
  const payload = record(interaction.payload) ?? {};
  switch (interaction.kind) {
    case 'tool_permission': {
      const tool = str(payload['toolName']) ?? 'a tool';
      const detail = str(payload['inputSummary']) ?? str(payload['description']);
      const risk = payload['risk'];
      // D-107: the gate's own question ("Run this command?"), worded for payloads stamped before it existed.
      const title = str(payload['title']) ?? permissionWording(tool, str(payload['type']) ?? 'other').title;
      return {
        summary: clip(title, SUMMARY_MAX),
        ...(detail ? { detail: clip(detail, DETAIL_MAX) } : {}),
        actions: ['allow_once', 'deny', 'open'],
        ...(risk === 'risky' || risk === 'standard' ? { risk } : {}),
      };
    }
    case 'question': {
      const questions = Array.isArray(payload['questions']) ? (payload['questions'] as unknown[]) : [];
      const first = str(record(questions[0])?.['question']);
      const more = questions.length > 1 ? `${questions.length} questions` : undefined;
      return {
        summary: clip(first ?? 'Your agent has a question', SUMMARY_MAX),
        ...(more ? { detail: more } : {}),
        actions: ['answer', 'open'],
      };
    }
    case 'plan_review': {
      const title = str(payload['title']);
      const summary = str(payload['summary']);
      return {
        summary: clip(title ? `Review plan “${title}”` : 'Review the plan', SUMMARY_MAX),
        ...(summary ? { detail: clip(summary, DETAIL_MAX) } : {}),
        actions: ['approve', 'reject', 'open'],
      };
    }
  }
}

/** An orchestrator's workers by lifecycle (D-92). Archived workers are not counted. */
export function tallyWorkers(workers: readonly Pick<Chat, 'status' | 'backgroundTask'>[]): ActivityWorkerTally {
  const tally: ActivityWorkerTally = { total: 0, running: 0, queued: 0, inReview: 0, done: 0, failed: 0 };
  for (const worker of workers) {
    if (worker.status === 'archived') continue;
    tally.total += 1;
    switch (worker.backgroundTask?.status) {
      case 'spawned':
        tally.queued += 1;
        break;
      case 'running':
        tally.running += 1;
        break;
      case 'needs_review':
        tally.inReview += 1;
        break;
      case 'completed':
        tally.done += 1;
        break;
      case 'failed':
      case 'interrupted': // D-100: stopped by a restart; like a failure, it needs someone to act.
        tally.failed += 1;
        break;
      default:
        break;
    }
  }
  return tally;
}

/** Agent, model and worker tally of a chat (D-92); undefined when nothing is known. */
export function chatActivityMeta(
  chat: Pick<Chat, 'model' | 'harnessConfig' | 'agentSnapshot'>,
  workers?: ActivityWorkerTally,
): ActivityMeta | undefined {
  const agent = str(chat.agentSnapshot?.driving?.name);
  const model = str(chat.model) ?? str((chat.harnessConfig as { model?: unknown } | undefined)?.model);
  const meta: ActivityMeta = {
    ...(agent ? { agent } : {}),
    ...(model ? { model } : {}),
    ...(workers ? { workers } : {}),
  };
  return Object.keys(meta).length > 0 ? meta : undefined;
}

/**
 * The summary shown instead of one written from the agent's own words, for a
 * principal that may not read the entity. A tool, app or stage NAME is fine
 * ("Allow Bash?"); a question or a plan title is free text that can quote
 * paths and commands (P2-R15).
 */
const GENERIC_SUMMARY: Partial<Record<AttentionAsk['kind'], string>> = {
  question: 'Your agent has a question',
  plan_review: 'Review the plan',
};

/**
 * Strip the fields that can carry commands and file names (`ask.detail`,
 * `progress.label`, and the free-text `ask.summary` of a question or plan
 * review) unless the principal may read the entity itself: `read:chats` for
 * chat items, `read:workflows` for run and automation items.
 * `scopes === null` means unauthenticated local mode, which reads everything.
 */
export function redactAttentionItem(item: AttentionItem, scopes: readonly string[] | null): AttentionItem {
  if (scopes === null) return item;
  const needed = item.entity === 'chat' ? 'read:chats' : 'read:workflows';
  if (scopes.includes(needed)) return item;
  const genericSummary = item.ask ? GENERIC_SUMMARY[item.ask.kind] : undefined;
  if (item.ask?.detail === undefined && item.progress === undefined && genericSummary === undefined) return item;
  const { progress, ask, ...rest } = item;
  const out: AttentionItem = { ...rest };
  if (ask) {
    const keep = { ...ask, ...(genericSummary ? { summary: genericSummary } : {}) };
    delete keep.detail;
    out.ask = keep;
  }
  if (progress && (progress.step !== undefined || progress.of !== undefined)) {
    // A progress with no label is still useful ("step 3 of 6"), but only then.
    const keep = { ...progress };
    delete keep.label;
    out.progress = keep;
  }
  return out;
}

export function redactAttentionSnapshot(
  snapshot: AttentionSnapshot,
  scopes: readonly string[] | null,
): AttentionSnapshot {
  if (scopes === null) return snapshot;
  return {
    ...snapshot,
    needsYou: snapshot.needsYou.map((i) => redactAttentionItem(i, scopes)),
    running: snapshot.running.map((i) => redactAttentionItem(i, scopes)),
  };
}

/** Redacts an `attention.upsert` payload; every other kind is returned unchanged. */
export function redactAttentionEventPayload(
  kind: string,
  payload: unknown,
  scopes: readonly string[] | null,
): unknown {
  if (kind !== 'attention.upsert' || scopes === null) return payload;
  const rec = record(payload);
  const item = rec?.['item'] as AttentionItem | undefined;
  if (!rec || !item || typeof item !== 'object') return payload;
  const redacted = redactAttentionItem(item, scopes);
  return redacted === item ? payload : { ...rec, item: redacted };
}

// ── The service ───────────────────────────────────────────────────

/** An item before its `since` is settled: undefined means "keep the old one, else now". */
type Draft = Omit<AttentionItem, 'since'> & { since?: string };

type EntityRef = { entity: AttentionItem['entity']; id: string };

const entityKey = (ref: EntityRef): string => `${ref.entity}:${ref.id}`;

/** Chat events that can open, settle or expire a gate, or end a turn. */
const CHAT_TRIGGER_KINDS: ReadonlySet<string> = new Set([
  'chat.plan.review_requested',
  'chat.plan.decided',
  'chat.plan.expired',
  'chat.archived',
  'chat.deleted',
  // Rename, unarchive, project move: the item's title/project must follow.
  'chat.updated',
  'harness.idle',
  'harness.error',
  'harness.turn_start',
  'session.active',
  'computer.consent_required',
  'computer.consent_resolved',
]);

/** Worker lifecycle events (emitted on the orchestrator's session, `chatId` = the orchestrator). */
const BACKGROUND_TASK_TRIGGER_KINDS: ReadonlySet<string> = new Set([
  'chat.background_task.spawned',
  'chat.background_task.status',
  'chat.background_task.completed',
  'chat.background_task.failed',
]);

export class AttentionService {
  private readonly items = new Map<string, AttentionItem>();
  private seq: number;
  private emitChain: Promise<void> = Promise.resolve();
  /** entity key → the serialised re-read loop for that entity. */
  private readonly refreshing = new Map<string, Promise<void>>();
  private readonly dirty = new Set<string>();
  /** chatId → latest tool step of its current turn. */
  private readonly chatLabels = new Map<string, string>();
  /** worker chatId → its orchestrator, while the worker has an active turn and nothing to ask. */
  private readonly workingWorkers = new Map<string, string>();
  /** consent requestId → timer that re-reads its chat when the prompt expires unanswered. */
  private readonly consentTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly unsubscribers: Array<() => void> = [];
  private readonly now: () => number;
  private stopped = false;
  /** The last `attention.counts` payload emitted, so an unchanged total is not re-sent. */
  private lastCounts = '';
  /** True once `start()` has subscribed and rebuilt; until then the snapshot means nothing. */
  private available = false;

  constructor(private readonly deps: AttentionServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.seq = deps.seqBase ?? Date.now() * 1000;
  }

  /**
   * Subscribe, then rebuild from the repositories. Subscribing first means an
   * event that lands during the rebuild schedules its own re-read instead of
   * being lost between the two.
   */
  async start(): Promise<void> {
    const { eventBus, streaming } = this.deps;
    this.unsubscribers.push(
      eventBus.subscribeAll((event) => this.onEvent(event), 'attention'),
      eventBus.subscribeGlobal((event) => this.onEvent(event)),
      streaming.onStreamingChange((chatId, isStreaming) => {
        if (!isStreaming) this.chatLabels.delete(chatId);
        this.schedule({ entity: 'chat', id: chatId });
      }),
    );
    await this.rebuild();
    this.available = !this.stopped;
  }

  /**
   * False before `start()` finished or after it failed: an empty snapshot then
   * would read as "nothing needs you", which is invented data (D-36). The
   * route answers 503 instead (P2-R17).
   */
  isAvailable(): boolean {
    return this.available;
  }

  stop(): void {
    this.available = false;
    this.stopped = true;
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    for (const timer of this.consentTimers.values()) clearTimeout(timer);
    this.consentTimers.clear();
  }

  /** The current snapshot, optionally narrowed to one project. */
  getSnapshot(filter: AttentionFilter = {}): AttentionSnapshot {
    let list = [...this.items.values()];
    if (filter.projectId) list = list.filter((item) => item.project?.id === filter.projectId);
    const needsYou = list.filter((item) => item.ask !== undefined).sort(compareAttentionItems);
    const running = list.filter((item) => item.ask === undefined).sort(compareAttentionItems);
    return {
      seq: this.seq,
      generatedAt: new Date(this.now()).toISOString(),
      needsYou,
      running,
      counts: countAttention(needsYou, running),
    };
  }

  /**
   * Re-reads every item shown under `projectId`. A deleted project unlinks its
   * chats and workflow definitions without an event of their own, so their
   * items would keep the project until something else touched them (P2-R33).
   */
  refreshProject(projectId: string): void {
    for (const item of this.items.values()) {
      if (item.project?.id === projectId) this.schedule({ entity: item.entity, id: item.entityId });
    }
  }

  /** Resolves once every scheduled re-read and every queued emit has settled. Tests and shutdown. */
  async settled(): Promise<void> {
    for (;;) {
      const pending = [...this.refreshing.values()];
      if (pending.length === 0) break;
      await Promise.all(pending);
    }
    await this.emitChain;
  }

  // ── Rebuild ──

  private async rebuild(): Promise<void> {
    const { interactions, streaming, runs, automations, executions, consent, logger } = this.deps;
    const refs: EntityRef[] = [];
    const chatIds = new Set<string>(streaming.getStreamingSince().keys());
    try {
      for (const interaction of (await interactions?.listPendingAll()) ?? []) {
        if (interaction.chatId) chatIds.add(interaction.chatId);
      }
    } catch (err) {
      logger?.warn('[Attention] could not list pending interactions', { error: errorText(err) });
    }
    for (const entry of consent?.listAllPending() ?? []) {
      for (const id of await this.consentChatIds(entry.chatId, entry.workspaceId)) chatIds.add(id);
      this.armConsentExpiry(entry.requestId, entry.chatId, entry.workspaceId, entry.expiresAt);
    }
    for (const id of chatIds) refs.push({ entity: 'chat', id });

    try {
      for (const run of await runs.getByStatus([...LIVE_RUN_STATUSES])) {
        refs.push({ entity: 'workflow_run', id: run.id });
      }
    } catch (err) {
      logger?.warn('[Attention] could not list live workflow runs', { error: errorText(err) });
    }

    try {
      if (executions.listIdsByStatus) {
        for (const id of await executions.listIdsByStatus(LIVE_EXECUTION_STATUS_LIST)) {
          refs.push({ entity: 'automation_execution', id });
        }
      } else {
        for (const automation of await automations.getAll()) {
          for (const execution of await executions.getExecutionsByAutomationId(automation.id)) {
            if (LIVE_EXECUTION_STATUSES.has(execution.status)) {
              refs.push({ entity: 'automation_execution', id: execution.id });
            }
          }
        }
      }
    } catch (err) {
      logger?.warn('[Attention] could not list live automation executions', { error: errorText(err) });
    }

    for (const ref of refs) this.schedule(ref);
    await this.settled();
    logger?.info('[Attention] snapshot rebuilt', {
      needsYou: [...this.items.values()].filter((i) => i.ask).length,
      running: [...this.items.values()].filter((i) => !i.ask).length,
    });
  }

  // ── Event routing ──

  private onEvent(event: PersistedEvent): void {
    if (this.stopped) return;
    const kind = event.kind;
    if (kind.startsWith('attention.')) return;
    const data = record(event.data) ?? {};

    const chatId = str(data['chatId']);
    if (chatId) {
      if (kind === 'harness.tool_start') {
        this.onToolStart(chatId, data);
        return;
      }
      if (kind === 'harness.turn_start') this.chatLabels.delete(chatId);
      if (kind === 'computer.consent_required') {
        const requestId = str(data['requestId']);
        const expiresAt = typeof data['expiresAt'] === 'number' ? data['expiresAt'] : undefined;
        if (requestId && expiresAt !== undefined) {
          this.armConsentExpiry(requestId, chatId, str(data['workspaceId']), expiresAt);
        }
      }
      if (
        kind.startsWith('chat.permission.') ||
        kind.startsWith('chat.question.') ||
        CHAT_TRIGGER_KINDS.has(kind) ||
        // A worker's lifecycle changes its orchestrator's tally (`chatId` is the orchestrator).
        BACKGROUND_TASK_TRIGGER_KINDS.has(kind)
      ) {
        this.schedule({ entity: 'chat', id: chatId });
      }
    }

    // A consent prompt raised outside a chat turn carries only its workspace
    // (P2-R19): it belongs to the chat that owns that workspace.
    if (kind === 'computer.consent_required' || kind === 'computer.consent_resolved') {
      const workspaceId = str(data['workspaceId']);
      const requestId = str(data['requestId']);
      // The answer carries no `chatId`, but the prompt may be listed on a
      // worker chat that raised it (P2-R32): re-read whatever holds the ask.
      if (kind === 'computer.consent_resolved' && requestId) {
        clearTimeout(this.consentTimers.get(requestId));
        this.consentTimers.delete(requestId);
        this.scheduleAskHolders(requestId);
      }
      if (!chatId && workspaceId) {
        const expiresAt = typeof data['expiresAt'] === 'number' ? data['expiresAt'] : undefined;
        if (kind === 'computer.consent_required' && requestId && expiresAt !== undefined) {
          this.armConsentExpiry(requestId, undefined, workspaceId, expiresAt);
        }
        this.scheduleWorkspaceChats(workspaceId);
      }
      return;
    }

    if (kind.startsWith('workflow_run.') || kind.startsWith('stage_run.')) {
      const runId = str(data['workflowRunId']);
      if (runId) this.schedule({ entity: 'workflow_run', id: runId });
      return;
    }

    if (kind.startsWith('automation_execution.')) {
      const executionId = str(data['executionId']);
      if (executionId) this.schedule({ entity: 'automation_execution', id: executionId });
    }
  }

  /** A tool step only changes the label, so it is applied in memory with no re-read. */
  private onToolStart(chatId: string, data: Record<string, unknown>): void {
    const label = describeToolStep(data['tool'], data['args']);
    if (!label) return;
    this.chatLabels.set(chatId, label);
    const ref: EntityRef = { entity: 'chat', id: chatId };
    // A re-read in flight may already have read the old label; let it run
    // once more rather than race it.
    if (this.refreshing.has(entityKey(ref))) {
      this.dirty.add(entityKey(ref));
      return;
    }
    // An orchestrator's label also names its working workers: re-read it.
    if (this.workersOf(chatId).length > 0) {
      this.schedule(ref);
      return;
    }
    const current = this.items.get(`chat:${chatId}`);
    if (!current || current.ask || current.progress?.label === label) return;
    this.apply(ref, [{ ...current, progress: { ...current.progress, label } }]);
  }

  private armConsentExpiry(
    requestId: string,
    chatId: string | undefined,
    workspaceId: string | undefined,
    expiresAt: number,
  ): void {
    if ((!chatId && !workspaceId) || this.consentTimers.has(requestId)) return;
    const delay = Math.max(0, expiresAt - this.now()) + 250;
    const timer = setTimeout(() => {
      this.consentTimers.delete(requestId);
      this.scheduleAskHolders(requestId);
      if (chatId) this.schedule({ entity: 'chat', id: chatId });
      else if (workspaceId) this.scheduleWorkspaceChats(workspaceId);
    }, delay);
    timer.unref?.();
    this.consentTimers.set(requestId, timer);
  }

  /**
   * The chat a consent prompt belongs to: its own `chatId`, else the chat that
   * OWNS the workspace — every top-level chat on it (a worker shares its
   * orchestrator's workspace and rolls up to it anyway).
   */
  private async consentChatIds(chatId: string | undefined, workspaceId: string): Promise<string[]> {
    if (chatId) return [chatId];
    try {
      const chats = await this.deps.chats.getByWorkspaceId(workspaceId);
      return chats.filter((chat) => !chat.parentChatId).map((chat) => chat.id);
    } catch (err) {
      this.deps.logger?.warn('[Attention] could not resolve a consent prompt\'s chat', {
        workspaceId,
        error: errorText(err),
      });
      return [];
    }
  }

  /** Re-reads every entity whose listed ask is `askId`, whichever chat it is keyed on. */
  private scheduleAskHolders(askId: string): void {
    for (const item of this.items.values()) {
      if (item.ask?.id === askId) this.schedule({ entity: item.entity, id: item.entityId });
    }
  }

  private scheduleWorkspaceChats(workspaceId: string): void {
    void this.consentChatIds(undefined, workspaceId).then((ids) => {
      for (const id of ids) this.schedule({ entity: 'chat', id });
    });
  }

  // ── Per-entity re-read, serialised and coalesced ──

  private schedule(ref: EntityRef): void {
    if (this.stopped) return;
    const key = entityKey(ref);
    if (this.refreshing.has(key)) {
      this.dirty.add(key);
      return;
    }
    const loop = (async () => {
      try {
        do {
          this.dirty.delete(key);
          try {
            const drafts = await this.compute(ref);
            if (!this.stopped) this.apply(ref, drafts);
            // U-41: an automation's item reads its runs' asks, so a run's change re-reads its execution.
            const execution = ref.entity === 'workflow_run' ? this.runExecutions.get(ref.id) : undefined;
            if (execution && !this.stopped) this.schedule({ entity: 'automation_execution', id: execution });
          } catch (err) {
            this.deps.logger?.warn('[Attention] re-read failed', { entity: key, error: errorText(err) });
          }
        } while (this.dirty.has(key) && !this.stopped);
      } finally {
        this.refreshing.delete(key);
      }
    })();
    this.refreshing.set(key, loop);
  }

  private compute(ref: EntityRef): Promise<Draft[]> {
    switch (ref.entity) {
      case 'chat':
        return this.computeChat(ref.id);
      case 'workflow_run':
        return this.computeRun(ref.id);
      case 'automation_execution':
        return this.computeExecution(ref.id);
    }
  }

  /** Diff one entity's items against the snapshot and emit the deltas. */
  private apply(ref: EntityRef, drafts: Draft[]): void {
    const nowIso = new Date(this.now()).toISOString();
    const next = new Map<string, AttentionItem>();
    for (const draft of drafts) {
      const previous = this.items.get(draft.key);
      next.set(draft.key, { ...draft, since: draft.since ?? previous?.since ?? nowIso });
    }

    let changed = false;
    for (const [key, item] of this.items) {
      if (item.entity !== ref.entity || item.entityId !== ref.id || next.has(key)) continue;
      this.items.delete(key);
      this.seq += 1;
      this.queueEmit({ kind: 'attention.remove', data: { seq: this.seq, key } });
      changed = true;
    }
    for (const [key, item] of next) {
      const previous = this.items.get(key);
      if (previous && JSON.stringify(previous) === JSON.stringify(item)) continue;
      this.items.set(key, item);
      this.seq += 1;
      this.queueEmit({ kind: 'attention.upsert', data: { seq: this.seq, item } });
      changed = true;
    }
    if (changed) {
      // Counts-only consumers (the desktop badge and tray rebuild on every
      // one) need a new value, not a new label on a running chat (P2-R16).
      const { counts } = this.getSnapshot();
      const key = JSON.stringify(counts);
      if (key !== this.lastCounts) {
        this.lastCounts = key;
        this.queueEmit({ kind: 'attention.counts', data: { seq: this.seq, counts } });
      }
    }
  }

  private queueEmit(event: AgentEvent): void {
    this.emitChain = this.emitChain
      .then(() => this.deps.eventBus.emitGlobal(event))
      .catch((err: unknown) => {
        // The client sees the hole as a `seq` gap and refetches the snapshot.
        this.deps.logger?.warn('[Attention] could not emit a delta', { kind: event.kind, error: errorText(err) });
      });
  }

  // ── Entity readers ──

  private async projectRef(projectId: string | undefined): Promise<AttentionItem['project']> {
    if (!projectId) return undefined;
    try {
      const project = await this.deps.projects.getById(projectId);
      return { id: project.id, name: project.name };
    } catch {
      return undefined;
    }
  }

  private async computeChat(chatId: string): Promise<Draft[]> {
    const { chats, interactions, streaming, consent } = this.deps;
    let chat: Chat | undefined;
    try {
      chat = await chats.getById(chatId);
    } catch {
      chat = undefined;
    }
    if (!chat || chat.status === 'archived') {
      this.setWorking(chatId, undefined);
      return [];
    }

    const [pending, project, parent, tally] = await Promise.all([
      interactions ? interactions.listPendingByChat(chatId) : Promise.resolve([] as AgentInteraction[]),
      this.projectRef(chat.projectId),
      this.parentRef(chat.parentChatId),
      chat.parentChatId ? Promise.resolve(undefined) : this.workerTally(chat),
    ]);
    const meta = chatActivityMeta(chat, tally);
    // A prompt without a chat is shown on the top-level chat that owns its workspace (P2-R19).
    const ownsWorkspace = !chat.parentChatId && chat.workspaceId !== undefined;
    const consents = (consent?.listAllPending() ?? []).filter(
      (entry) => entry.chatId === chatId || (!entry.chatId && ownsWorkspace && entry.workspaceId === chat.workspaceId),
    );
    const streamingSince = streaming.getStreamingSince().get(chatId);

    const base = {
      entity: 'chat' as const,
      entityId: chatId,
      title: chat.name?.trim() || 'Untitled chat',
      ...(project ? { project } : {}),
      ...(parent ? { parent } : {}),
      stoppable: streamingSince !== undefined,
      ...(meta ? { meta } : {}),
    };
    const chatHref = (dock?: string): string =>
      parent ? `/chats/${parent.id}?dock=tasks` : `/chats/${chatId}${dock ? `?dock=${dock}` : ''}`;

    const drafts: Draft[] = [];
    for (const interaction of pending) {
      const described = describeInteraction(interaction);
      drafts.push({
        ...base,
        key: `chat:${chatId}:${interaction.id}`,
        href: chatHref(interaction.kind === 'plan_review' ? 'plan' : undefined),
        state: stateOf(STATUS_MAPS.interaction.pending, 'needs_you'),
        since: iso(interaction.createdAt),
        ask: { kind: interaction.kind, id: interaction.id, ...described },
      });
    }
    for (const entry of consents) {
      drafts.push({
        ...base,
        key: `chat:${chatId}:${entry.requestId}`,
        href: chatHref('computer'),
        state: stateOf(STATUS_MAPS.permission.pending, 'needs_you'),
        ask: {
          kind: 'computer_consent',
          id: entry.requestId,
          summary: clip(`Allow ${entry.appLabel}?`, SUMMARY_MAX),
          ...(entry.summary ? { detail: clip(entry.summary, DETAIL_MAX) } : {}),
          actions: ['allow_once', 'deny', 'open'],
        },
      });
    }

    // A working worker is not an item of its own: it rolls up into its orchestrator.
    if (chat.parentChatId) {
      this.setWorking(chatId, drafts.length === 0 && streamingSince ? chat.parentChatId : undefined);
      return drafts;
    }

    const workers = this.workersOf(chatId);
    if (drafts.length === 0 && (streamingSince || workers.length > 0)) {
      const label = [
        streamingSince ? this.chatLabels.get(chatId) : undefined,
        workers.length > 0 ? `${workers.length} background task${workers.length === 1 ? '' : 's'} running` : undefined,
      ]
        .filter((part): part is string => part !== undefined)
        .join(' · ');
      const since = streamingSince ?? this.earliestStreaming(workers);
      drafts.push({
        ...base,
        key: `chat:${chatId}`,
        href: chatHref(streamingSince ? undefined : 'tasks'),
        state: stateOf(STATUS_MAPS.stream.streaming, 'running'),
        ...(since ? { since: since.toISOString() } : {}),
        ...(label ? { progress: { label } } : {}),
      });
    }
    return drafts;
  }

  /** The worker tally of an orchestrator chat; undefined for a chat that never orchestrated (D-92). */
  private async workerTally(chat: Chat): Promise<ActivityWorkerTally | undefined> {
    const list = this.deps.chats.listBackgroundTasks;
    if (!list) return undefined;
    let tasks: Chat[];
    try {
      tasks = await list.call(this.deps.chats, chat.id);
    } catch {
      return undefined;
    }
    if (tasks.length === 0 && !chat.orchestratorMode) return undefined;
    return tallyWorkers(tasks);
  }

  /** The working workers of an orchestrator chat. */
  private workersOf(parentChatId: string): string[] {
    const ids: string[] = [];
    for (const [workerId, parentId] of this.workingWorkers) if (parentId === parentChatId) ids.push(workerId);
    return ids;
  }

  /** Records whether a worker is working (`parentChatId`) or not, and re-reads its orchestrator when that changes. */
  private setWorking(chatId: string, parentChatId: string | undefined): void {
    const before = this.workingWorkers.get(chatId);
    if (before === parentChatId) return;
    if (parentChatId) this.workingWorkers.set(chatId, parentChatId);
    else this.workingWorkers.delete(chatId);
    if (before) this.schedule({ entity: 'chat', id: before });
    if (parentChatId) this.schedule({ entity: 'chat', id: parentChatId });
  }

  private earliestStreaming(chatIds: readonly string[]): Date | undefined {
    const since = this.deps.streaming.getStreamingSince();
    let earliest: Date | undefined;
    for (const id of chatIds) {
      const at = since.get(id);
      if (at && (!earliest || at < earliest)) earliest = at;
    }
    return earliest;
  }

  private async parentRef(parentChatId: string | undefined): Promise<AttentionItem['parent']> {
    if (!parentChatId) return undefined;
    try {
      const parent = await this.deps.chats.getById(parentChatId);
      return { entity: 'chat', id: parent.id, title: parent.name?.trim() || 'Untitled chat' };
    } catch {
      return { entity: 'chat', id: parentChatId, title: 'Untitled chat' };
    }
  }

  /** The execution each automation-started run belongs to (U-41). */
  private readonly runExecutions = new Map<string, string>();

  private async computeRun(runId: string): Promise<Draft[]> {
    const { runs, stageRuns, definitions } = this.deps;
    let run: WorkflowRun;
    try {
      run = await runs.getById(runId);
    } catch {
      return [];
    }
    const executionId = run?.trigger?.kind === 'automation' ? run.trigger['executionId'] : undefined;
    if (typeof executionId === 'string' && executionId) this.runExecutions.set(runId, executionId);
    if (!run || !LIVE_RUN_STATUSES.includes(run.status)) return [];

    const [instances, graph] = await Promise.all([
      stageRuns.getByRunId(runId).catch(() => [] as StageRun[]),
      definitions.getGraph(run.workflowDefinitionId).then((d) => d.graph).catch(() => null),
    ]);
    const definition = graph?.workflow ?? null;
    // Graph order breaks creation-time ties (instances created together; the repository's row order is not it).
    const graphIndex = new Map((graph?.stages ?? []).map((stage, index) => [stage.key, index] as const));
    const order = (s: StageRun): number => graphIndex.get(s.stageKey) ?? Number.MAX_SAFE_INTEGER;
    const project = await this.projectRef(run.projectId ?? definition?.projectId ?? undefined);
    // "Stage N of M" counts the run's own stages, in the order they were
    // created: the body instances of a loop or map (`scopeId`) are iterations
    // inside one stage.
    const stages = instances
      .filter((s) => !s.scopeId)
      // An alphabetical tie-break put "Apply upgrades" second of six (D-92 desktop test).
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || order(a) - order(b) || a.instancePath.localeCompare(b.instancePath));
    const of = stages.length;
    const done = stages.filter((s) => TERMINAL_STAGE_STATUSES.has(s.status)).length;
    const step = of > 0 ? Math.min(done + 1, of) : undefined;

    const base = {
      entity: 'workflow_run' as const,
      entityId: runId,
      title: definition?.name?.trim() || stripRunEpoch(run.name),
      href: `/workflows/${run.workflowDefinitionId}/runs/${runId}`,
      ...(project ? { project } : {}),
      stoppable: STOPPABLE_RUN_STATUSES.has(run.status),
    };

    const drafts: Draft[] = [];
    // A gate can sit on any instance, a loop or map body stage included. An
    // approval `wait` stage parks as `waiting` with `{kind:'wait', type:'approval'}`
    // (D-92: it waits on a person, so it is Needs you, not Running).
    for (const stage of instances) {
      const data = record(stage.interruptData) ?? {};
      const approvalWait = stage.status === 'waiting' && data['kind'] === 'wait' && data['type'] === 'approval';
      if (stage.status !== 'awaiting_input' && !approvalWait) continue;
      const gate = str(data['kind']);
      const isApproval =
        approvalWait || gate === 'stage_completion_review' || gate === 'tool_permission' || data['approval'] === true;
      const reason = str(data['reason']) ?? str(data['prompt']) ?? str(record(data['request'])?.['description']);
      const index = stages.indexOf(stage);
      const position = of > 0 && index >= 0 ? `Stage ${index + 1} of ${of}` : undefined;
      const detail = [position, reason].filter((part): part is string => !!part).join(' · ');
      const actions: AttentionAction[] = isApproval ? ['approve', 'reject', 'open'] : ['answer', 'open'];
      drafts.push({
        ...base,
        key: `workflow_run:${runId}:${stage.id}`,
        state: stateOf(STATUS_MAPS.stageRun.awaiting_input, 'needs_you'),
        // D-92: where the gate sits, for the card's "Stage 4 of 6" and its stage bar.
        ...(of > 0 && index >= 0 ? { progress: { step: index + 1, of } } : {}),
        ask: {
          kind: isApproval ? 'stage_approval' : 'stage_input',
          id: stage.id,
          summary: clip(`${isApproval ? 'Approve' : 'Answer'} “${stage.name}”`, SUMMARY_MAX),
          ...(detail ? { detail: clip(detail, DETAIL_MAX) } : {}),
          actions,
        },
      });
    }

    if (run.status === 'paused') {
      drafts.push({
        ...base,
        key: `workflow_run:${runId}:${runId}`,
        state: stateOf(STATUS_MAPS.workflowRun.paused, 'paused'),
        since: iso(run.updatedAt),
        ask: {
          kind: 'run_paused',
          id: runId,
          summary: 'Paused — waiting for a decision',
          ...(run.error ? { detail: clip(run.error, DETAIL_MAX) } : {}),
          actions: ['open'],
        },
      });
    }

    // U-32: a live run nothing moves but paused stages (an app quit interrupted them, or someone
    // paused them) waits on a person to resume them: Needs you, not Running.
    if (drafts.length === 0 && (run.status === 'running' || run.status === 'waiting')) {
      const paused = instances.filter((s) => s.status === 'paused');
      const moving = instances.some((s) => !TERMINAL_STAGE_STATUSES.has(s.status) && s.status !== 'paused' && s.status !== 'pending');
      if (paused.length > 0 && !moving) {
        const names = clip(paused.map((s) => s.name).join(', '), LABEL_MAX);
        drafts.push({
          ...base,
          key: `workflow_run:${runId}:${runId}`,
          state: stateOf(STATUS_MAPS.workflowRun.paused, 'paused'),
          since: iso(run.updatedAt),
          ask: {
            kind: 'run_paused',
            id: runId,
            // `interrupted` (a gate lost to a restart) or `interrupted:<cause>` (a turn cut off by one).
            summary: paused.some((s) => s.statusReason?.startsWith('interrupted'))
              ? `${names} stopped when the app closed — resume to continue`
              : `${names} paused — resume to continue`,
            actions: ['open'],
          },
        });
      }
    }

    // D-92: a run an automation started rolls up into its execution's item (one
    // card, one count, like workers into their orchestrator); its asks still show.
    if (drafts.length === 0 && run.trigger?.kind === 'automation') return [];

    if (drafts.length === 0) {
      const live = instances.filter((s) => !TERMINAL_STAGE_STATUSES.has(s.status));
      const sleeping = live.length > 0 && live.every((s) => WAITING_STAGE_STATUSES.has(s.status));
      const active = instances.filter((s) => ACTIVE_STAGE_STATUSES.has(s.status));
      const label = active.length > 0
        ? clip(active.map((s) => s.name).join(', '), LABEL_MAX)
        : undefined;
      const progress = label || step !== undefined
        ? { ...(label ? { label } : {}), ...(step !== undefined ? { step, of } : {}) }
        : undefined;
      drafts.push({
        ...base,
        key: `workflow_run:${runId}`,
        state: sleeping
          ? stateOf(STATUS_MAPS.stageRun.waiting, 'waiting')
          : stateOf(STATUS_MAPS.workflowRun[run.status], 'running'),
        since: iso(run.startedAt ?? run.createdAt),
        ...(progress ? { progress } : {}),
      });
    }
    return drafts;
  }

  private async computeExecution(executionId: string): Promise<Draft[]> {
    const { executions, automations } = this.deps;
    let execution: AutomationExecution;
    try {
      execution = await executions.getExecutionById(executionId);
    } catch {
      return [];
    }
    if (!execution || !LIVE_EXECUTION_STATUSES.has(execution.status)) return [];
    const automation = await automations.getById(execution.automationId).catch(() => null);
    const project = await this.projectRef(automation?.projectId);
    // U-41: when every live run of the execution waits on a person (their asks show as their own
    // Needs you items), the execution is not working: it waits, it does not spin under Running.
    const liveRuns: string[] = [];
    for (const [runId, exec] of this.runExecutions) {
      if (exec !== executionId) continue;
      const run = await this.deps.runs.getById(runId).catch(() => null);
      if (run && LIVE_RUN_STATUSES.includes(run.status)) liveRuns.push(runId);
      else this.runExecutions.delete(runId);
    }
    const waitingOnPerson =
      liveRuns.length > 0 &&
      liveRuns.every((runId) => [...this.items.values()].some((i) => i.entity === 'workflow_run' && i.entityId === runId && i.ask)) &&
      execution.status === 'running';
    const total = execution.totalIterations;
    const finished = execution.completedIterations + execution.failedIterations;
    const step = total > 0 ? Math.min(finished + 1, total) : undefined;
    return [
      {
        key: `automation_execution:${executionId}`,
        entity: 'automation_execution',
        entityId: executionId,
        title: automation?.name?.trim() || 'Automation',
        href: `/automations/${execution.automationId}`,
        ...(project ? { project } : {}),
        state: waitingOnPerson
          ? stateOf(STATUS_MAPS.stageRun.waiting, 'waiting')
          : stateOf(STATUS_MAPS.automationExecution[execution.status], 'running'),
        since: iso(execution.startedAt ?? execution.createdAt),
        ...(step !== undefined ? { progress: { label: `Iteration ${step} of ${total}`, step, of: total } } : {}),
        // `POST /automations/:id/executions/:executionId/cancel` stops a live execution.
        stoppable: true,
        meta: {
          automation: {
            id: execution.automationId,
            triggerType: automation?.triggerType ?? 'manual',
            ...(automation?.triggerType === 'schedule' && automation.cronExpression
              ? { cronExpression: automation.cronExpression }
              : {}),
          },
        },
      },
    ];
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
