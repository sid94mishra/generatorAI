// ────────────────────────────────────────────────────────────────
// EventBus — in-process event emitter with persistence & replay
// ────────────────────────────────────────────────────────────────

import { EventEmitter } from 'node:events';
import type { AgentEvent, PersistedEvent, ILogger } from '@generatorai/shared';
import { DELTA_SESSION_INFO_TYPES, getMeter } from '@generatorai/shared';
import type { IEventRepository } from '../domain/ports/IRepositories.js';
import type { ISequenceAllocator } from '../domain/ports/ISequenceAllocator.js';

// ── OTel Metrics ──
const meter = getMeter('core.events');
const eventsEmitted = meter.createCounter('eventbus.events.emitted', {
  description: 'Total events emitted through EventBus',
});
const subscriberErrors = meter.createCounter('eventbus.subscriber.errors', {
  description: 'Total subscriber errors caught by EventBus',
});
const persistErrors = meter.createCounter('eventbus.persist.errors', {
  description: 'Total event-persist failures (DB insert failed or dead-lettered)',
});
const eventsSuppressed = meter.createCounter('eventbus.events.suppressed', {
  description: 'Events dropped before persistence because their kind is renderer noise',
});

/**
 * Raw SDK passthrough that no client renders.
 *
 * P1-4 / W01 — the filter used to live in `StreamBroker.publish`, i.e. AFTER
 * the event had already been sequenced, persisted and fanned out to every
 * in-process subscriber. Filtering here means a suppressed event costs one Set
 * lookup instead of a sequence allocation, an INSERT and 20+ handler dispatches.
 *
 * Set `GENERATORAI_STREAM_DEBUG_NOISE=1` to keep everything for diagnostics.
 */
export const NOISE_EVENT_KINDS: ReadonlySet<string> = new Set(['harness.unknown']);

/**
 * Suppression, which is not the same thing as classification.
 *
 * W04 classifies `tool_partial_result` and `tool_progress` as deltas, and once
 * W07 lands they will flow to the delta log: coalesced, bounded, droppable, and
 * costing the relational store nothing. Until then a delta is still an INSERT
 * into `stream_cursors` — the table that is 81% of the database file — so
 * un-suppressing them now would trade a real regression for a future benefit.
 *
 * They are safe to drop in the meantime because no surface reads them: verified
 * by call-site search across web, mobile, CLI and replay. The chunk-carrier list
 * itself lives in `DELTA_SESSION_INFO_TYPES` so there is one definition, not
 * two that drift.
 *
 * REMOVE THIS with W07. It is a stopgap, and the comment is the only thing
 * stopping it becoming permanent.
 */
export function isNoiseEventKind(kind: string, data?: unknown): boolean {
  if (process.env['GENERATORAI_STREAM_DEBUG_NOISE'] === '1') return false;
  if (NOISE_EVENT_KINDS.has(kind)) return true;
  if (kind !== 'harness.session_info') return false;
  const infoType = (data as { infoType?: unknown } | undefined)?.infoType;
  return typeof infoType === 'string' && DELTA_SESSION_INFO_TYPES.has(infoType);
}

/** Sequence number stamped on an event that was suppressed before persistence. */
export const SUPPRESSED_SEQUENCE_ID = -1;

/**
 * The durable log behind the event bus (`stream_cursors`), wired by the
 * composition root because that is where the repository lives.
 *
 * This is the single source of both durability and sequence numbers. Before
 * P1-4 there were two of each: `events` + `event_sequences` for `PersistedEvent`,
 * and `stream_cursors` + `stream_sequences` for the SSE transport. Replay read
 * one and the live path read the other, so a caller resuming from a live cursor
 * was comparing numbers from two independent counters.
 */
export interface ISessionEventStore {
  /**
   * Append one event and return its durable identity. MUST reject rather than
   * resolve if the row was not committed — the caller suppresses the broadcast
   * on rejection to preserve commit-then-broadcast (EVT-01).
   */
  append(sessionId: string, event: AgentEvent): Promise<{ seq: number; id: number }>;
  /** Replay committed events for a session, oldest first. Must NOT truncate. */
  replaySessionEvents(sessionId: string, afterSeq: number): Promise<PersistedEvent[]>;
  /** Remove every durable row for a session. Used when a session is deleted. */
  deleteSessionEvents(sessionId: string): Promise<void>;
}

/**
 * P1-4 — the v1 `events` table is a second durable log that nothing reads on
 * the live path, yet it was written first and synchronously per event, with
 * unindexed `(workflow_run_id, stage_run_id)` columns behind it.
 *
 * Forced on with `GENERATORAI_LEGACY_EVENT_LOG=1`. Otherwise the decision is
 * made per-emit: a bus with a durable store wired skips it, and a bus WITHOUT
 * one falls back to it, because then the legacy table is the only durable log
 * that exists. That matters for the embedded SDK, which builds core services
 * without a StreamBroker — turning the write off there unconditionally would
 * have left it broadcasting events that nothing persisted and replaying
 * nothing.
 */
function legacyEventLogForced(): boolean {
  return process.env['GENERATORAI_LEGACY_EVENT_LOG'] === '1';
}

export interface EventBusOptions {
  /**
   * Write every event to the legacy `events` table as well as broadcasting it.
   * When unset, defaults to `GENERATORAI_LEGACY_EVENT_LOG`, then to "only if no
   * durable store has been wired". Set explicitly by tests that exercise the
   * legacy log's own semantics.
   */
  legacyEventLog?: boolean;
}

export class EventBus {
  private emitter = new EventEmitter();
  private sequenceCounters = new Map<string, number>();
  private globalHandlers = new Set<(event: PersistedEvent) => void>();
  /**
   * EVT-02 — maps user-supplied handler → (wrapped handler, name) so the
   * wrapper can catch subscriber exceptions, emit a `subscriber.error`
   * global event, and still let unsubscribe find the wrapper.
   */
  private wrappedHandlers = new WeakMap<
    (event: PersistedEvent) => void,
    { wrapped: (event: PersistedEvent) => void; name: string; channel: string }
  >();
  /**
   * Per-session emit queues. Each session's events are serialized to
   * guarantee that DB persistence + SSE broadcast happen in strict
   * sequenceId order. Without this, concurrent async emit() calls
   * (e.g. from rapid Copilot SDK callbacks that don't await the handler)
   * could finish DB inserts out of order, causing the SSE stream to
   * broadcast events with non-monotonic sequenceIds. The browser's
   * high-water-mark dedup would then drop late-arriving lower-sequence
   * events, losing tokens after tool calls.
   */
  private emitQueues = new Map<string, Promise<unknown>>();
  /** Tracks accumulated persistence failures per session for ops visibility. */
  private persistFailures = new Map<string, Array<{ kind: string; error: string; at: number }>>();

  /**
   * Phase 2, 2.2 — max listeners is now configurable via `EVENT_BUS_MAX_LISTENERS`
   * env var (default 10 000, up from the hardcoded 1 000). SSE clients are the
   * main source of listeners; at scale we don't want an arbitrary limit
   * silently dropping every 1001st subscriber.
   */
  private readonly maxListeners: number;

  /** Explicit override; when undefined the decision is made per emit. */
  private readonly legacyEventLogOverride: boolean | undefined;

  private replaySource: ISessionEventStore | undefined;

  constructor(
    private eventRepo?: IEventRepository,
    private logger?: ILogger,
    private sequenceAllocator?: ISequenceAllocator,
    options?: EventBusOptions,
  ) {
    const envLimit = process.env['EVENT_BUS_MAX_LISTENERS'];
    this.maxListeners = envLimit ? Math.max(1, Number(envLimit)) : 10_000;
    this.emitter.setMaxListeners(this.maxListeners);
    this.legacyEventLogOverride = options?.legacyEventLog ?? (legacyEventLogForced() ? true : undefined);
  }

  /** The legacy `events` repo to write to for this emit, or undefined to skip. */
  private legacyRepo(): IEventRepository | undefined {
    const enabled = this.legacyEventLogOverride ?? this.replaySource === undefined;
    return enabled ? this.eventRepo : undefined;
  }

  /**
   * Wire the durable stream log. Called by the composition root once
   * `StreamCursorRepository` exists.
   *
   * Once set, it becomes the source of BOTH durability and sequence numbers,
   * so replay and the live stream speak the same sequence space. Without it
   * (embedded SDK, unit tests) the bus falls back to the legacy `events` table
   * and the `event_sequences` allocator.
   */
  setEventStore(store: ISessionEventStore): void {
    this.replaySource = store;
  }

  /** Expose the active listener limit for ops / health checks. */
  getMaxListeners(): number {
    return this.maxListeners;
  }

  /** Per-channel active listener count. Useful for /health alerting. */
  getListenerStats(): { maxListeners: number; channels: Record<string, number> } {
    const channels: Record<string, number> = {};
    for (const name of this.emitter.eventNames()) {
      channels[String(name)] = this.emitter.listenerCount(name);
    }
    channels['__global__'] = this.globalHandlers.size;
    return { maxListeners: this.maxListeners, channels };
  }

  /** Emit an event for a session. Persists to DB and broadcasts to subscribers. */
  async emit(sessionId: string, event: AgentEvent): Promise<PersistedEvent> {
    // W01 — suppress renderer noise BEFORE the queue, the sequence allocation
    // and the fan-out. A suppressed event must still return a well-formed
    // PersistedEvent so callers that read `.sequenceId` don't branch on it.
    if (isNoiseEventKind(event.kind, event.data)) {
      eventsSuppressed.add(1, { kind: event.kind });
      return {
        id: 0,
        sessionId,
        sequenceId: SUPPRESSED_SEQUENCE_ID,
        kind: event.kind,
        data: event.data,
        timestamp: Date.now(),
      };
    }
    // Chain onto the per-session queue so emits execute one-at-a-time.
    // Note: we explicitly do NOT swallow prior failures here — if a prior
    // emit's DB insert failed, we recorded it via persistFailures, but the
    // queue still moves forward so subsequent events aren't blocked. The
    // caller of this next emit decides how to handle its own errors.
    const prev = this.emitQueues.get(sessionId) ?? Promise.resolve();
    const next = prev
      .catch(() => { /* previous failure already recorded in persistFailures */ })
      .then(() => this._doEmit(sessionId, event));
    this.emitQueues.set(sessionId, next);
    // Drop the queue entry once this chain settles and nothing newer has been
    // chained — prevents unbounded growth of `emitQueues` for the many
    // short-lived chat/run sessions that never call `deleteSessionEvents`.
    void next.catch(() => undefined).then(() => {
      if (this.emitQueues.get(sessionId) === next) this.emitQueues.delete(sessionId);
    });
    return next;
  }

  /**
   * Await all in-flight per-session emit chains. Call during graceful shutdown
   * (after producers have stopped) so queued DB inserts complete before the
   * process exits — otherwise a session's final events can be lost. Idempotent.
   */
  async flush(): Promise<void> {
    const pending = Array.from(this.emitQueues.values());
    await Promise.allSettled(pending);
  }

  /** Internal: actually persist + broadcast a single event (called under queue). */
  private async _doEmit(sessionId: string, event: AgentEvent): Promise<PersistedEvent> {
    eventsEmitted.add(1, { kind: event.kind, session_id: sessionId });

    const persisted: PersistedEvent = {
      id: 0,
      sessionId,
      sequenceId: 0,
      kind: event.kind,
      data: event.data,
      timestamp: Date.now(),
    };

    // ── 1. Commit ────────────────────────────────────────────────────────
    // EVT-01: commit THEN broadcast. A live subscriber must never observe an
    // event that replay cannot return, or a client that reconnects sees a hole
    // it has no way to detect.
    //
    // The durable store, when wired, is BOTH the commit point and the source of
    // the sequence number. That is what keeps replay and the live stream in one
    // sequence space: `getSessionEvents` reads the same counter that `emit`
    // stamped. The `event_sequences` allocator remains the fallback for the
    // embedded SDK and unit tests, which have no store.
    let persistedOk = false;

    if (this.replaySource) {
      try {
        const row = await this.replaySource.append(sessionId, event);
        persisted.sequenceId = row.seq;
        persisted.id = row.id;
        persistedOk = true;
      } catch (err) {
        persistErrors.add(1, { session_id: sessionId, kind: event.kind });
        const msg = err instanceof Error ? err.message : String(err);
        this.logger?.error(
          '[EventBus] durable append failed — dropping broadcast (EVT-01)',
          { sessionId, kind: event.kind, error: msg },
        );
        this.recordPersistFailure(sessionId, event.kind, msg);
        return persisted;
      }
    } else {
      // Allocate sequence ID. Prefer SQL-allocated (cross-process safe) when
      // available; fall back to in-memory counter for tests / no-DB buses.
      persisted.sequenceId = this.sequenceAllocator
        ? await this.sequenceAllocator.allocate(sessionId)
        : (this.sequenceCounters.get(sessionId) ?? 0) + 1;
      persistedOk = true;
    }

    this.sequenceCounters.set(
      sessionId,
      Math.max(this.sequenceCounters.get(sessionId) ?? 0, persisted.sequenceId),
    );

    // The legacy `events` table. When a durable store is wired this is an
    // explicit opt-in mirror and its failure MUST NOT suppress the broadcast:
    // the event is already committed with an allocated sequence number, so
    // withholding it gives live subscribers a hole that replay will happily
    // fill — which is the exact failure EVT-01 exists to prevent, inverted.
    // Without a store this table IS the commit point, so a failure there does
    // suppress.
    const repo = this.legacyRepo();
    if (repo) {
      const legacyIsCommitPoint = !this.replaySource;
      let legacyOk = false;
      try {
        persisted.id = await repo.insert(persisted);
        legacyOk = true;
      } catch (err1) {
        const err1Msg = err1 instanceof Error ? err1.message : String(err1);
        this.logger?.warn('[EventBus] Event persist failed, retrying once', {
          sessionId,
          kind: event.kind,
          error: err1Msg,
        });
        try {
          persisted.id = await repo.insert(persisted);
          legacyOk = true;
        } catch (err2) {
          persistErrors.add(1, { session_id: sessionId, kind: event.kind });
          const err2Msg = err2 instanceof Error ? err2.message : String(err2);
          this.logger?.error(
            legacyIsCommitPoint
              ? '[EventBus] Event persist failed after retry — dropping broadcast (EVT-01)'
              : '[EventBus] legacy mirror write failed after retry — broadcasting anyway (already committed)',
            {
              sessionId,
              sequenceId: persisted.sequenceId,
              kind: event.kind,
              error: err2Msg,
            },
          );
          this.recordPersistFailure(sessionId, event.kind, err2Msg);
        }
      }
      if (legacyIsCommitPoint) persistedOk = legacyOk;
    }

    // ── 2. Broadcast ─────────────────────────────────────────────────────
    // Per-handler wrappers (see subscribe()) catch exceptions and surface them
    // as `subscriber.error` events (EVT-02) instead of letting the first broken
    // listener silence the rest.
    if (persistedOk) {
      for (const channel of [`session:${sessionId}`, 'session:*']) {
        this.emitter.emit(channel, persisted);
      }
    }

    return persisted;
  }

  private recordPersistFailure(sessionId: string, kind: string, error: string): void {
    const failures = this.persistFailures.get(sessionId) ?? [];
    failures.push({ kind, error, at: Date.now() });
    if (failures.length > 200) failures.splice(0, failures.length - 200);
    this.persistFailures.set(sessionId, failures);
  }

  /**
   * Introspection for ops / health checks. Returns recent persistence
   * failures for a session (empty if all events persisted successfully).
   */
  getPersistFailures(sessionId: string): Array<{ kind: string; error: string; at: number }> {
    return this.persistFailures.get(sessionId) ?? [];
  }

  /** Reset the recorded persistence failures for a session. */
  clearPersistFailures(sessionId: string): void {
    this.persistFailures.delete(sessionId);
  }

  /**
   * Emit a global event not tied to any session (e.g., client lifecycle).
   * EVT-01: commits before broadcasting; on persist failure the event is
   * dropped from the live broadcast so SSE ↔ REST stay consistent.
   */
  async emitGlobal(event: AgentEvent): Promise<void> {
    if (isNoiseEventKind(event.kind, event.data)) {
      eventsSuppressed.add(1, { kind: event.kind });
      return;
    }
    const repo = this.legacyRepo();
    if (repo) {
      let persisted: PersistedEvent;
      let persisted_ok = false;
      if (this.sequenceAllocator) {
        // Cross-process-safe path: allocate the sequence via SQL, then insert
        // the event row. If the insert fails the allocator has still advanced
        // — this is intentional (gap-tolerant), so concurrent allocations
        // don't collide.
        const seq = await this.sequenceAllocator.allocate('__global__');
        try {
          const id = await repo.insert({
            sessionId: '__global__',
            sequenceId: seq,
            kind: event.kind,
            data: event.data,
            timestamp: Date.now(),
          });
          persisted = {
            id,
            sessionId: '__global__',
            sequenceId: seq,
            kind: event.kind,
            data: event.data,
            timestamp: Date.now(),
          };
          persisted_ok = true;
        } catch (err) {
          persistErrors.add(1, { session_id: '__global__', kind: event.kind });
          const msg = err instanceof Error ? err.message : String(err);
          this.logger?.error('[EventBus] Global event persist failed — dropping broadcast (EVT-01)', {
            sequenceId: seq,
            kind: event.kind,
            error: msg,
          });
          // EVT-01: drop the broadcast on persist failure to preserve the
          // commit-then-broadcast invariant. REST replay will show the gap.
          return;
        }
      } else {
        // Legacy path: EventRepository's own in-memory counter. Only safe
        // when a single process writes to the DB; tests + any deployment
        // that has not wired the allocator.
        persisted = await repo.persistGlobal({
          kind: event.kind,
          data: event.data,
          timestamp: Date.now(),
        });
        persisted_ok = true;
      }
      // Advance the in-memory counter ONLY when the insert actually succeeded.
      // Advancing on failure would cause a concurrent `emit('__global__', …)`
      // to compute its next sequence ID as `counter + 1` and collide with a
      // sequence that another process has not yet seen applied to the DB.
      // When persist fails, the allocator has still reserved `seq`; letting
      // the counter lag leaves a gap that REST replay surfaces cleanly.
      if (persisted_ok) {
        this.sequenceCounters.set(
          '__global__',
          Math.max(this.sequenceCounters.get('__global__') ?? 0, persisted.sequenceId),
        );
      }
      // EVT-02: wrap per-handler invocation so one broken global subscriber
      // can't block the others. Exceptions surface as `subscriber.error`.
      this.dispatchGlobalWithErrorCapture(persisted);
    } else {
      // No legacy log (the default). Sequence numbers come from the durable
      // store's own counter, exactly as `_doEmit` does, so global replay and
      // the global live stream share one sequence space. Reaching for the
      // `event_sequences` allocator here would burn a number that no row
      // records, on the path whose whole purpose is to stop writing rows.
      let sequenceId = this.sequenceCounters.get('__global__') ?? 0;
      let id = 0;
      if (this.replaySource) {
        try {
          const row = await this.replaySource.append('__global__', event);
          sequenceId = row.seq;
          id = row.id;
        } catch (err) {
          persistErrors.add(1, { session_id: '__global__', kind: event.kind });
          this.logger?.error(
            '[EventBus] durable append failed for global event — dropping broadcast (EVT-01)',
            { kind: event.kind, error: err instanceof Error ? err.message : String(err) },
          );
          return;
        }
      } else {
        sequenceId += 1;
      }
      const faux: PersistedEvent = {
        id,
        sessionId: '__global__',
        sequenceId,
        kind: event.kind,
        data: event.data,
        timestamp: Date.now(),
      };
      if (sequenceId > 0) {
        this.sequenceCounters.set(
          '__global__',
          Math.max(this.sequenceCounters.get('__global__') ?? 0, sequenceId),
        );
      }
      this.dispatchGlobalWithErrorCapture(faux);
    }
  }

  /**
   * EVT-02 — invoke every registered global handler under its own try/catch
   * and emit a `subscriber.error` meta-event for any thrown exception. The
   * meta-event is published asynchronously so we never re-enter the current
   * emit stack frame (which could deadlock the per-session emit queue).
   *
   * `subscriber.error` events are never re-emitted recursively — if the
   * subscriber.error event's own handlers throw, we log but do NOT emit
   * another subscriber.error to avoid an emit storm.
   */
  private dispatchGlobalWithErrorCapture(persisted: PersistedEvent): void {
    for (const handler of this.globalHandlers) {
      try {
        handler(persisted);
      } catch (err) {
        subscriberErrors.add(1, { session_id: persisted.sessionId, channel: 'global' });
        const errMsg = err instanceof Error ? err.message : String(err);
        this.logger?.error('[EventBus] Global subscriber error', {
          error: errMsg,
          kind: persisted.kind,
          sequenceId: persisted.sequenceId,
        });
        if (persisted.kind !== 'subscriber.error') {
          this.reportSubscriberError('global', 'anonymous-global', persisted, errMsg);
        }
      }
    }
  }

  /**
   * EVT-02 — asynchronously emit a `subscriber.error` meta-event so ops
   * dashboards and the metrics counter both see broken subscribers. We
   * detach with queueMicrotask to avoid re-entering the current emit.
   */
  private reportSubscriberError(
    channel: string,
    subscriberName: string,
    source: PersistedEvent,
    error: string,
  ): void {
    queueMicrotask(() => {
      void this.emitGlobal({
        kind: 'subscriber.error',
        data: {
          subscriberName,
          channel,
          sourceKind: source.kind,
          sourceSequenceId: source.sequenceId,
          sourceSessionId: source.sessionId,
          error,
        },
      }).catch(() => {
        /* swallow — logged upstream, and we refuse to recurse */
      });
    });
  }

  /**
   * Subscribe to events for a specific session. Returns unsubscribe function.
   * EVT-02 — accepts an optional `name` used in `subscriber.error` meta-events
   * so ops can identify the broken subscriber. Handlers are wrapped in a
   * per-handler try/catch so one broken subscriber never stops delivery to
   * peers on the same channel.
   */
  subscribe(
    sessionId: string,
    handler: (event: PersistedEvent) => void,
    name = 'anonymous',
  ): () => void {
    const channel = `session:${sessionId}`;
    const wrapped = this.wrapHandler(handler, channel, name);
    this.emitter.on(channel, wrapped);
    return () => {
      this.emitter.off(channel, wrapped);
      this.wrappedHandlers.delete(handler);
    };
  }

  /** Subscribe to all events across all sessions. EVT-02 — see `subscribe`. */
  subscribeAll(
    handler: (event: PersistedEvent) => void,
    name = 'anonymous-all',
  ): () => void {
    const channel = 'session:*';
    const wrapped = this.wrapHandler(handler, channel, name);
    this.emitter.on(channel, wrapped);
    return () => {
      this.emitter.off(channel, wrapped);
      this.wrappedHandlers.delete(handler);
    };
  }

  /**
   * EVT-02 — returns a wrapped handler that catches thrown exceptions and
   * surfaces them as `subscriber.error` meta-events. Keeps a WeakMap entry
   * so unsubscribe() can find the wrapper from the original handler.
   */
  private wrapHandler(
    handler: (event: PersistedEvent) => void,
    channel: string,
    name: string,
  ): (event: PersistedEvent) => void {
    const wrapped = (event: PersistedEvent): void => {
      try {
        handler(event);
      } catch (err) {
        subscriberErrors.add(1, { session_id: event.sessionId, channel });
        const errMsg = err instanceof Error ? err.message : String(err);
        this.logger?.error('[EventBus] Subscriber error', {
          error: errMsg,
          channel,
          sessionId: event.sessionId,
          subscriber: name,
        });
        if (event.kind !== 'subscriber.error') {
          this.reportSubscriberError(channel, name, event, errMsg);
        }
      }
    };
    this.wrappedHandlers.set(handler, { wrapped, name, channel });
    return wrapped;
  }

  /** Subscribe to global events (client lifecycle, etc.). */
  subscribeGlobal(handler: (event: PersistedEvent) => void): () => void {
    this.globalHandlers.add(handler);
    return () => {
      this.globalHandlers.delete(handler);
    };
  }

  /**
   * v2: Subscribe to events for a specific workflow run.
   * Filters all session events by workflowRunId in the event data.
   */
  subscribeToWorkflowRun(
    runId: string,
    handler: (event: PersistedEvent) => void,
  ): () => void {
    // EVT-03 — narrow data without a blanket `as Record<string, unknown>`.
    // We read `workflowRunId` defensively: many AgentEvent variants carry it,
    // but not all. A single typed indexed read is safer than casting the
    // whole payload.
    const filteredHandler = (event: PersistedEvent) => {
      const dataRunId =
        event.data && typeof event.data === 'object' && 'workflowRunId' in event.data
          ? (event.data as { workflowRunId?: unknown }).workflowRunId
          : undefined;
      const matchesData = dataRunId === runId;
      const matchesField = event.workflowRunId === runId;
      if (matchesData || matchesField) {
        handler(event);
      }
    };
    return this.subscribeAll(filteredHandler, `workflow-run:${runId}`);
  }

  /**
   * v2: Subscribe to events for a specific chat.
   * Filters events by session ID (1 Chat → 1 Session).
   */
  subscribeToChat(
    sessionId: string,
    handler: (event: PersistedEvent) => void,
  ): () => void {
    return this.subscribe(sessionId, handler);
  }

  /** Restore sequence counters from DB on startup. */
  async restoreCounters(): Promise<void> {
    // With a durable store wired, every sequence comes from that store's own
    // counter on each append, so there is nothing to restore and nothing that
    // can drift. This path exists for the embedded SDK and tests, where the
    // in-memory counter IS the source of truth and must be seeded from disk or
    // a restart reissues sequence numbers that are already in use.
    if (this.replaySource) return;
    if (!this.eventRepo) return;
    const maxSeqs = await this.eventRepo.getMaxSequencePerSession();
    for (const { sessionId, maxSeq } of maxSeqs) {
      this.sequenceCounters.set(sessionId, maxSeq);
    }
  }

  /** Delete persisted events for a session (cleanup on session deletion). */
  async deleteSessionEvents(sessionId: string): Promise<void> {
    // The durable store holds every prompt, tool argument and tool result for
    // the session. Deleting a chat that leaves them behind for the retention
    // TTL is a data-deletion bug, not a cleanup shortcut.
    await this.replaySource?.deleteSessionEvents(sessionId);
    await this.eventRepo?.deleteBySession(sessionId);
    this.sequenceCounters.delete(sessionId);
    this.emitQueues.delete(sessionId);
  }

  /**
   * Get persisted events for a session, optionally after a sequence number.
   *
   * P1-4 — reads the durable stream log, which is what the live path writes and
   * what stamped the sequence numbers. Falls back to the legacy `events` table
   * only when no store has been wired (tests, embedded SDK without a broker).
   *
   * Deliberately NOT paginated: both legacy paths were unbounded, and this is a
   * public SDK surface. A silent cap here would truncate a run's history with
   * no marker, which Law L2 forbids. The store paginates internally.
   */
  async getSessionEvents(
    sessionId: string,
    afterSequence?: number,
  ): Promise<PersistedEvent[]> {
    if (this.replaySource) {
      return this.replaySource.replaySessionEvents(sessionId, afterSequence ?? 0);
    }
    if (!this.eventRepo) return [];
    if (afterSequence !== undefined) {
      return this.eventRepo.getAfterSequence(sessionId, afterSequence);
    }
    return this.eventRepo.getBySessionId(sessionId);
  }
}
