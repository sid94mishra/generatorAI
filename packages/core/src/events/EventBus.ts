// ────────────────────────────────────────────────────────────────
// EventBus — in-process event emitter with persistence & replay
// ────────────────────────────────────────────────────────────────

import { EventEmitter } from 'node:events';
import type { AgentEvent, PersistedEvent, ILogger } from '@generatorai/shared';
import { getMeter } from '@generatorai/shared';
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

  constructor(
    private eventRepo?: IEventRepository,
    private logger?: ILogger,
    private sequenceAllocator?: ISequenceAllocator,
  ) {
    const envLimit = process.env['EVENT_BUS_MAX_LISTENERS'];
    this.maxListeners = envLimit ? Math.max(1, Number(envLimit)) : 10_000;
    this.emitter.setMaxListeners(this.maxListeners);
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

    // Allocate sequence ID. Prefer SQL-allocated (cross-process safe) when
    // available; fall back to in-memory counter for tests / EventBus-without-DB.
    let seq: number;
    if (this.sequenceAllocator) {
      seq = await this.sequenceAllocator.allocate(sessionId);
    } else {
      seq = (this.sequenceCounters.get(sessionId) ?? 0) + 1;
    }
    // Keep the in-memory counter tracking the allocator so the `__global__`
    // fast path and tests still see monotonic values.
    this.sequenceCounters.set(sessionId, Math.max(this.sequenceCounters.get(sessionId) ?? 0, seq));

    const persisted: PersistedEvent = {
      id: 0,
      sessionId,
      sequenceId: seq,
      kind: event.kind,
      data: event.data,
      timestamp: Date.now(),
    };

    // 1. Persist to SQLite — retry once on transient failure.
    //    EVT-01: commit THEN broadcast. If persistence ultimately fails we
    //    record it AND skip the broadcast so SSE clients never observe an
    //    event that REST replay can't return. The persistFailures log lets
    //    ops see the gap; live clients will reconcile on reconnect via
    //    REST replay seeded from the last-known sequence.
    let persistedOk = !this.eventRepo; // no repo → treat as "nothing to persist"
    if (this.eventRepo) {
      try {
        persisted.id = await this.eventRepo.insert(persisted);
        persistedOk = true;
      } catch (err1) {
        const err1Msg = err1 instanceof Error ? err1.message : String(err1);
        this.logger?.warn('[EventBus] Event persist failed, retrying once', {
          sessionId,
          kind: event.kind,
          error: err1Msg,
        });
        try {
          persisted.id = await this.eventRepo.insert(persisted);
          persistedOk = true;
        } catch (err2) {
          persistErrors.add(1, { session_id: sessionId, kind: event.kind });
          const err2Msg = err2 instanceof Error ? err2.message : String(err2);
          this.logger?.error('[EventBus] Event persist failed after retry — dropping broadcast (EVT-01)', {
            sessionId,
            sequenceId: seq,
            kind: event.kind,
            error: err2Msg,
          });
          const failures = this.persistFailures.get(sessionId) ?? [];
          failures.push({ kind: event.kind, error: err2Msg, at: Date.now() });
          if (failures.length > 200) failures.splice(0, failures.length - 200);
          this.persistFailures.set(sessionId, failures);
        }
      }
    }

    // 2. Broadcast to session subscribers — only when the event is safely
    //    committed (EVT-01). Per-handler wrappers (see subscribe()) catch
    //    exceptions and surface them as `subscriber.error` events (EVT-02)
    //    instead of letting the first broken listener silence the rest.
    if (persistedOk) {
      for (const channel of [`session:${sessionId}`, 'session:*']) {
        this.emitter.emit(channel, persisted);
      }
    }

    return persisted;
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
    if (this.eventRepo) {
      let persisted: PersistedEvent;
      let persisted_ok = false;
      if (this.sequenceAllocator) {
        // Cross-process-safe path: allocate the sequence via SQL, then insert
        // the event row. If the insert fails the allocator has still advanced
        // — this is intentional (gap-tolerant), so concurrent allocations
        // don't collide.
        const seq = await this.sequenceAllocator.allocate('__global__');
        try {
          const id = await this.eventRepo.insert({
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
        persisted = await this.eventRepo.persistGlobal({
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
      const faux: PersistedEvent = {
        id: 0,
        sessionId: '__global__',
        sequenceId: 0,
        kind: event.kind,
        data: event.data,
        timestamp: Date.now(),
      };
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
    if (!this.eventRepo) return;
    const maxSeqs = await this.eventRepo.getMaxSequencePerSession();
    for (const { sessionId, maxSeq } of maxSeqs) {
      this.sequenceCounters.set(sessionId, maxSeq);
    }
  }

  /** Delete persisted events for a session (cleanup on session deletion). */
  async deleteSessionEvents(sessionId: string): Promise<void> {
    if (!this.eventRepo) return;
    await this.eventRepo.deleteBySession(sessionId);
    this.sequenceCounters.delete(sessionId);
    this.emitQueues.delete(sessionId);
  }

  /** Get persisted events for a session, optionally after a sequence number. */
  async getSessionEvents(sessionId: string, afterSequence?: number): Promise<PersistedEvent[]> {
    if (!this.eventRepo) return [];
    if (afterSequence !== undefined) {
      return this.eventRepo.getAfterSequence(sessionId, afterSequence);
    }
    return this.eventRepo.getBySessionId(sessionId);
  }
}
