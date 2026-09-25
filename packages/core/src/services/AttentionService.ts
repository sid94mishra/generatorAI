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
//   Running    streaming chats, runs in running/starting/cancelling, and
//              automation executions in pending/running.
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
// parallel), so stage asks are read through `IStageRunRepository.getByRunId`
// rather than a new `HitlService.listAllPending()`: a stage can only await
// input inside a non-terminal run, and those runs are listed anyway. Empty
// run history (the overhaul's v55 drop) simply yields no run items.
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
  type Automation,
  type AutomationExecution,
  type Chat,
  type ILogger,
  type PersistedEvent,
  type Project,
  type StageRun,
  type StatusMapping,
  type WorkflowDefinition,
  type WorkflowRun,
  type WorkflowRunStatus,
} from '@generatorai/shared';

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
  chats: { getById(id: string): Promise<Chat> };
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
  definitions: { getById(id: string): Promise<WorkflowDefinition> };
  automations: {
    getAll(): Promise<Automation[]>;
    getById(id: string): Promise<Automation>;
  };
  executions: {
    getExecutionById(id: string): Promise<AutomationExecution>;
    getExecutionsByAutomationId(automationId: string): Promise<AutomationExecution[]>;
  };
  consent?: { listAllPending(): AttentionConsentEntry[] };
  logger?: Pick<ILogger, 'info' | 'warn'>;
  /** Clock, for tests. */
  now?: () => number;
  /** First `seq` value, for tests. Defaults to `Date.now() * 1000`. */
  seqBase?: number;
}

// ── Pure helpers ──────────────────────────────────────────────────

/** Runs in these statuses are live (Running or, when paused, Needs you). */
const LIVE_RUN_STATUSES: readonly WorkflowRunStatus[] = ['running', 'starting', 'cancelling', 'paused'];
const STOPPABLE_RUN_STATUSES: ReadonlySet<WorkflowRunStatus> = new Set(['running', 'starting', 'paused']);
const LIVE_EXECUTION_STATUSES: ReadonlySet<AutomationExecution['status']> = new Set(['pending', 'running']);
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
function stripRunEpoch(name: string): string {
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
  const name = str(tool);
  if (!name) return undefined;
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
): Pick<AttentionAsk, 'summary' | 'detail' | 'actions'> {
  const payload = record(interaction.payload) ?? {};
  switch (interaction.kind) {
    case 'tool_permission': {
      const tool = str(payload['toolName']) ?? 'a tool';
      const detail = str(payload['inputSummary']) ?? str(payload['description']);
      return {
        summary: clip(`Allow ${tool}?`, SUMMARY_MAX),
        ...(detail ? { detail: clip(detail, DETAIL_MAX) } : {}),
        actions: ['allow_once', 'deny', 'open'],
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

/**
 * Strip the fields that can carry commands and file names (`ask.detail`,
 * `progress.label`) unless the principal may read the entity itself:
 * `read:chats` for chat items, `read:workflows` for run and automation items.
 * `scopes === null` means unauthenticated local mode, which reads everything.
 */
export function redactAttentionItem(item: AttentionItem, scopes: readonly string[] | null): AttentionItem {
  if (scopes === null) return item;
  const needed = item.entity === 'chat' ? 'read:chats' : 'read:workflows';
  if (scopes.includes(needed)) return item;
  if (item.ask?.detail === undefined && item.progress === undefined) return item;
  const { progress, ask, ...rest } = item;
  const out: AttentionItem = { ...rest };
  if (ask) {
    const keep = { ...ask };
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
  'harness.idle',
  'harness.error',
  'harness.turn_start',
  'session.active',
  'computer.consent_required',
  'computer.consent_resolved',
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
  /** consent requestId → timer that re-reads its chat when the prompt expires unanswered. */
  private readonly consentTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly unsubscribers: Array<() => void> = [];
  private readonly now: () => number;
  private stopped = false;

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
  }

  stop(): void {
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
      if (entry.chatId) chatIds.add(entry.chatId);
      this.armConsentExpiry(entry.requestId, entry.chatId, entry.expiresAt);
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
      for (const automation of await automations.getAll()) {
        for (const execution of await executions.getExecutionsByAutomationId(automation.id)) {
          if (LIVE_EXECUTION_STATUSES.has(execution.status)) {
            refs.push({ entity: 'automation_execution', id: execution.id });
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
        if (requestId && expiresAt !== undefined) this.armConsentExpiry(requestId, chatId, expiresAt);
      }
      if (
        kind.startsWith('chat.permission.') ||
        kind.startsWith('chat.question.') ||
        CHAT_TRIGGER_KINDS.has(kind)
      ) {
        this.schedule({ entity: 'chat', id: chatId });
      }
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
    const current = this.items.get(`chat:${chatId}`);
    if (!current || current.ask || current.progress?.label === label) return;
    this.apply(ref, [{ ...current, progress: { ...current.progress, label } }]);
  }

  private armConsentExpiry(requestId: string, chatId: string | undefined, expiresAt: number): void {
    if (!chatId || this.consentTimers.has(requestId)) return;
    const delay = Math.max(0, expiresAt - this.now()) + 250;
    const timer = setTimeout(() => {
      this.consentTimers.delete(requestId);
      this.schedule({ entity: 'chat', id: chatId });
    }, delay);
    timer.unref?.();
    this.consentTimers.set(requestId, timer);
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
      const snapshot = this.getSnapshot();
      this.queueEmit({ kind: 'attention.counts', data: { seq: this.seq, counts: snapshot.counts } });
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
    let chat: Chat;
    try {
      chat = await chats.getById(chatId);
    } catch {
      return [];
    }
    if (!chat || chat.status === 'archived') return [];

    const [pending, project, parent] = await Promise.all([
      interactions ? interactions.listPendingByChat(chatId) : Promise.resolve([] as AgentInteraction[]),
      this.projectRef(chat.projectId),
      this.parentRef(chat.parentChatId),
    ]);
    const consents = (consent?.listAllPending() ?? []).filter((entry) => entry.chatId === chatId);
    const streamingSince = streaming.getStreamingSince().get(chatId);

    const base = {
      entity: 'chat' as const,
      entityId: chatId,
      title: chat.name?.trim() || 'Untitled chat',
      ...(project ? { project } : {}),
      ...(parent ? { parent } : {}),
      stoppable: streamingSince !== undefined,
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

    if (drafts.length === 0 && streamingSince) {
      const label = this.chatLabels.get(chatId);
      drafts.push({
        ...base,
        key: `chat:${chatId}`,
        href: chatHref(),
        state: stateOf(STATUS_MAPS.stream.streaming, 'running'),
        since: streamingSince.toISOString(),
        ...(label ? { progress: { label } } : {}),
      });
    }
    return drafts;
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

  private async computeRun(runId: string): Promise<Draft[]> {
    const { runs, stageRuns, definitions } = this.deps;
    let run: WorkflowRun;
    try {
      run = await runs.getById(runId);
    } catch {
      return [];
    }
    if (!run || !LIVE_RUN_STATUSES.includes(run.status)) return [];

    const [stages, definition] = await Promise.all([
      stageRuns.getByRunId(runId).catch(() => [] as StageRun[]),
      definitions.getById(run.workflowDefinitionId).catch(() => null),
    ]);
    const project = await this.projectRef(definition?.projectId);
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
    for (const stage of stages) {
      if (stage.status !== 'awaiting_input') continue;
      const data = record(stage.interruptData) ?? {};
      const gate = str(data['kind']);
      const isApproval = gate === 'stage_completion_review' || gate === 'tool_permission' || data['approval'] === true;
      const reason = str(data['reason']) ?? str(data['prompt']) ?? str(record(data['request'])?.['description']);
      const position = of > 0 ? `Stage ${stages.indexOf(stage) + 1} of ${of}` : undefined;
      const detail = [position, reason].filter((part): part is string => !!part).join(' · ');
      const actions: AttentionAction[] = isApproval ? ['approve', 'reject', 'open'] : ['answer', 'open'];
      drafts.push({
        ...base,
        key: `workflow_run:${runId}:${stage.id}`,
        state: stateOf(STATUS_MAPS.stageRun.awaiting_input, 'needs_you'),
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

    if (drafts.length === 0) {
      const live = stages.filter((s) => !TERMINAL_STAGE_STATUSES.has(s.status));
      const sleeping = live.length > 0 && live.every((s) => s.status === 'sleeping');
      const active = stages.filter((s) => s.status === 'running');
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
          ? stateOf(STATUS_MAPS.stageRun.sleeping, 'waiting')
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
        state: stateOf(STATUS_MAPS.automationExecution[execution.status], 'running'),
        since: iso(execution.startedAt ?? execution.createdAt),
        ...(step !== undefined ? { progress: { label: `Iteration ${step} of ${total}`, step, of: total } } : {}),
        stoppable: false,
      },
    ];
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
