/**
 * W12 — Agent Host server process.
 *
 * Runs as a child process of the gateway. Receives requests over the IPC
 * channel (process.on('message')), executes them against the provider
 * harness, and sends responses back (process.send()).
 *
 * L5: Native handles (provider runtimes) never live in the control-plane
 * process. This file IS the control-plane boundary.
 *
 * The event path is the interesting part. Every session's events converge on
 * ONE IPC channel, so writing them straight through as they arrive means a
 * 4 MB tool result in session A is written before session B's next token — the
 * head-of-line blocking W12 exists to remove. Instead:
 *
 *   harness event → demux.dispatch (bounded per-session queue) → pump
 *   pump → round-robin, one frame per session per round → process.send()
 *   process.send() returns false (channel full) → stop, resume on flush
 *
 * so a session producing huge frames occupies one slot per round rather than
 * the whole channel, and the queue bound — not the OS socket buffer — is what
 * absorbs a runaway producer.
 */

import type {
  AgentHostRequest,
  AgentHostResponse,
  AgentEventNotification,
  SessionEndedNotification,
  ILogger,
} from '@generatorai/shared';
import { isAgentHostRequest } from '@generatorai/shared';
import type { IAgentHarness } from '@generatorai/core';
import {
  RuntimeSupervisor,
  MAX_CONCURRENT_SPAWN,
  MAX_CONCURRENT_EXECUTIONS,
  type RuntimeEntry,
  type RuntimeSupervisorOptions,
} from './RuntimeSupervisor.js';
import { SessionDemux } from './SessionDemux.js';
import { BoundedSemaphore } from './BoundedSemaphore.js';

/**
 * A turn permit is released when the turn reaches a terminal event. If a
 * provider never emits one (a wedged CLI), the permit would be held forever
 * and every later turn would queue behind it — the host would look alive and
 * accept nothing. This is the backstop: release, log, and let the turn keep
 * running unmetered rather than wedge the whole host on it.
 */
const TURN_PERMIT_MAX_HOLD_MS = 10 * 60 * 1000;

/** Backoff bounds for re-arming the pump after a failed (not backpressured) write. */
const PUMP_RETRY_MIN_MS = 25;
const PUMP_RETRY_MAX_MS = 1_000;

/** Per-session bookkeeping. One record instead of five parallel maps. */
interface SessionRecord {
  runtimeId: string;
  /** B2-fix: the harness-level conversationId; distinct from the IPC sessionId. */
  conversationId: string;
  /** Params as received over IPC — needed to re-create the session on recycle. */
  params: Record<string, unknown>;
  /** Cancels the spawn-time event subscription. */
  unsubscribeEvents: () => void;
  /** Cancels the active waitForTurnEnd listener, if any. */
  unsubscribeTurnEnd?: () => void;
  /** Releases the execution permit for the in-flight turn, if any. Idempotent. */
  releaseTurnPermit?: () => void;
}

export interface AgentHostServerOptions {
  logger: ILogger;
  /** Builds a replacement harness during a runtime recycle (see W12). */
  createHarness?: () => Promise<IAgentHarness>;
  maxConcurrentExecutions?: number;
  maxConcurrentColdStarts?: number;
  /** Overrides forwarded to the RuntimeSupervisor (recycling budgets, probes). */
  supervisorOptions?: Omit<RuntimeSupervisorOptions, 'logger' | 'createHarness' | 'drainSessions'>;
  /**
   * Transport seam. Defaults to `process.send`. Returning `false` means the
   * channel buffer is full; `callback` fires once the frame has flushed.
   * Injectable so the pump's backpressure and fairness behaviour is testable
   * without forking a real child process.
   */
  send?: (msg: AgentHostResponse, callback: (err: Error | null) => void) => boolean;
}

export class AgentHostServer {
  /* W12 */
  private readonly supervisor: RuntimeSupervisor;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly bootTime = Date.now();
  private readonly logger: ILogger;

  /**
   * One demux for the whole host, not one per runtime: the contended resource
   * is the single IPC channel, so that is what has to be shared fairly.
   */
  private readonly demux = new SessionDemux();

  /** W12 — two semaphores, per spec: wide for turns, narrow for cold starts. */
  private readonly executionSemaphore: BoundedSemaphore;
  private readonly coldStartSemaphore: BoundedSemaphore;

  private readonly sendFrame: (msg: AgentHostResponse, callback: (err: Error | null) => void) => boolean;
  private pumpScheduled = false;
  /** True while the IPC channel is backpressured; the pump idles until it flushes. */
  private ipcBlocked = false;
  /** Pending retry after a failed write — the only thing that can restart a parked pump. */
  private pumpRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private pumpRetryDelayMs = PUMP_RETRY_MIN_MS;
  /** Consecutive failed writes, used only to bound the log noise on a dead channel. */
  private writeFailureStreak = 0;
  private shuttingDown = false;
  private readonly createHarness: (() => Promise<IAgentHarness>) | undefined;
  /** Shared so a burst of spawns after a failed boot builds ONE runtime. */
  private pendingRuntimeBuild: Promise<RuntimeEntry | undefined> | undefined;

  constructor(loggerOrOptions: ILogger | AgentHostServerOptions) {
    const opts: AgentHostServerOptions =
      'logger' in loggerOrOptions
        ? (loggerOrOptions as AgentHostServerOptions)
        : { logger: loggerOrOptions as ILogger };

    this.logger = opts.logger;
    this.createHarness = opts.createHarness;
    this.executionSemaphore = new BoundedSemaphore(opts.maxConcurrentExecutions ?? MAX_CONCURRENT_EXECUTIONS);
    this.coldStartSemaphore = new BoundedSemaphore(opts.maxConcurrentColdStarts ?? MAX_CONCURRENT_SPAWN);

    this.sendFrame =
      opts.send ??
      ((msg, callback) => {
        if (typeof process.send !== 'function') {
          callback(new Error('process.send unavailable'));
          return false;
        }
        return process.send(msg, undefined, undefined, callback);
      });

    this.supervisor = new RuntimeSupervisor({
      ...opts.supervisorOptions,
      logger: this.logger,
      ...(opts.createHarness ? { createHarness: opts.createHarness } : {}),
      drainSessions: (from, to) => this.drainSessions(from, to),
      deferRecycle: (entry) => this.recycleBlockedBy(entry),
    });
  }

  /** Register a provider harness (called during host boot). */
  registerHarness(harness: IAgentHarness): void {
    this.supervisor.register(harness);
  }

  /** Start listening on the IPC channel. */
  start(): void {
    if (typeof process.send !== 'function') {
      throw new Error('[AgentHostServer] Not running as a forked child process — process.send unavailable');
    }

    process.on('message', (raw: unknown) => this.onMessage(raw));

    // The recycle timer only exists once the host is actually serving; a host
    // that never started has nothing to recycle.
    this.supervisor.startRecycleTimer();

    this.sendControl({ type: 'pong', reqId: '__ready__' });
    this.logger.info('[AgentHostServer] Agent host ready');
  }

  /** Exposed so tests can drive the IPC path without a real child process. */
  onMessage(raw: unknown): void {
    if (!isAgentHostRequest(raw)) {
      this.logger.warn('[AgentHostServer] Received unrecognised IPC message type');
      return;
    }
    this.handleRequest(raw).catch((err: unknown) => {
      this.logger.error(`[AgentHostServer] Unhandled error in handleRequest: ${String(err)}`);
    });
  }

  // ── Egress: control messages vs. streamed frames ──────────────────────────

  /**
   * Control messages (acks, errors, stats, pong) bypass the demux: they are
   * small, they are correlated by reqId rather than ordered against a session's
   * stream, and a caller blocked on `send()` must not wait behind a session's
   * queued tokens.
   */
  private sendControl(msg: AgentHostResponse): void {
    this.write(msg);
  }

  /**
   * The single IPC writer.
   *
   * Three outcomes, and conflating any two of them loses frames:
   *  - `'sent'`         the channel took it and flushed it.
   *  - `'backpressure'` the channel took it but its buffer is full. The frame
   *                     IS on its way; the pump idles until the flush callback
   *                     wakes it. Re-sending here would duplicate it.
   *  - `'failed'`       the channel did NOT take it (a `process.send` that
   *                     threw, or one whose callback reported an error). The
   *                     frame has to be given back to the queue and retried, or
   *                     it is gone for good.
   *
   * `onFailure` fires exactly once per write, on the failure outcome only —
   * including when the failure is reported asynchronously on the callback,
   * long after this returns.
   */
  private write(msg: AgentHostResponse, onFailure?: () => void): 'sent' | 'backpressure' | 'failed' {
    let settled = false;
    let flushed = false;
    let failed = false;
    const fail = (): void => {
      if (failed) return;
      failed = true;
      onFailure?.();
      this.armPumpRetry();
    };

    try {
      flushed = this.sendFrame(msg, (err) => {
        settled = true;
        if (err) {
          this.noteWriteFailure(`IPC write error: ${String(err)}`);
          fail();
        } else {
          this.pumpRetryDelayMs = PUMP_RETRY_MIN_MS;
          this.writeFailureStreak = 0;
        }
        if (this.ipcBlocked) {
          this.ipcBlocked = false;
          this.schedulePump();
        }
      });
    } catch (err: unknown) {
      // A closed channel (parent gone) throws rather than returning false. The
      // frame never left this process.
      this.noteWriteFailure(`IPC write threw: ${String(err)}`);
      fail();
      return 'failed';
    }

    if (failed) return 'failed';
    if (flushed) return 'sent';
    // Only treat this as backpressure if the callback has NOT already fired;
    // otherwise we would latch `ipcBlocked` with nothing left to clear it.
    if (!settled) this.ipcBlocked = true;
    return 'backpressure';
  }

  /**
   * Log a write failure without turning a dead channel into a log flood: the
   * first failure of a streak is reported, then every 50th until one succeeds.
   */
  private noteWriteFailure(message: string): void {
    this.writeFailureStreak++;
    if (this.writeFailureStreak === 1 || this.writeFailureStreak % 50 === 0) {
      this.logger.warn(`[AgentHostServer] ${message} (consecutive failures: ${this.writeFailureStreak})`);
    }
  }

  /**
   * Re-arm the pump after a FAILED write.
   *
   * Backpressure has the flush callback to wake it; a failure has nothing —
   * which is precisely how one throwing `process.send()` used to park the pump
   * forever with a `session_ended` still queued behind it (BLOCKER B1). The
   * backoff keeps a permanently dead channel from spinning; the host exits on
   * its own within one heartbeat when the parent is really gone.
   */
  private armPumpRetry(): void {
    if (this.shuttingDown || this.pumpRetryTimer) return;
    const delay = this.pumpRetryDelayMs;
    this.pumpRetryDelayMs = Math.min(this.pumpRetryDelayMs * 2, PUMP_RETRY_MAX_MS);
    this.pumpRetryTimer = setTimeout(() => {
      this.pumpRetryTimer = undefined;
      this.schedulePump();
    }, delay);
    if (typeof this.pumpRetryTimer.unref === 'function') this.pumpRetryTimer.unref();
  }

  private schedulePump(): void {
    if (this.pumpScheduled || this.ipcBlocked || this.shuttingDown) return;
    this.pumpScheduled = true;
    // setImmediate, not a synchronous call: a provider emitting a burst of
    // events inside one tick should batch into a single fair pass rather than
    // re-entering the round-robin per event.
    setImmediate(() => {
      this.pumpScheduled = false;
      this.pump();
    });
  }

  private pump(): void {
    this.demux.drainTo((sessionId, entry) => {
      const msg: AgentHostResponse =
        entry.frame.kind === 'event'
          ? ({
              type: 'agent_event',
              sessionId,
              event: entry.frame.event,
              seq: entry.seq,
              ...(entry.droppedBefore > 0 ? { droppedBefore: entry.droppedBefore } : {}),
            } satisfies AgentEventNotification)
          : ({
              type: 'session_ended',
              sessionId,
              reason: entry.frame.reason,
              ...(entry.frame.error !== undefined ? { error: entry.frame.error } : {}),
            } satisfies SessionEndedNotification);

      const result = this.write(msg, () => {
        // Not delivered. Put it back at the head so it is retried in order
        // rather than silently dropped.
        this.demux.requeue(sessionId, entry);
      });
      return result === 'sent';
    });
  }

  // ── Requests ──────────────────────────────────────────────────────────────

  private async handleRequest(req: AgentHostRequest): Promise<void> {
    switch (req.type) {
      case 'ping':
        this.sendControl({ type: 'pong', reqId: req.reqId });
        return;

      case 'get_stats': {
        const s = this.supervisor.stats();
        this.sendControl({
          type: 'stats',
          reqId: req.reqId,
          activeSessions: this.sessions.size,
          rssBytes: s.rssBytes,
          uptimeMs: Date.now() - this.bootTime,
          providerCount: s.runtimeCount,
        });
        return;
      }

      case 'spawn_session':
        return this.handleSpawn(req.reqId, req.sessionId, req.params);

      case 'send_turn': {
        const { reqId, sessionId, prompt, attachments } = req;
        const session = this.sessions.get(sessionId);
        const runtime = session ? this.supervisor.get(session.runtimeId) : undefined;
        if (!session || !runtime) {
          this.sendControl({ type: 'error', reqId, ok: false, message: `No runtime for session ${sessionId}`, code: 'SESSION_NOT_FOUND' });
          return;
        }
        try {
          // W12 — bound concurrent in-flight turns. The permit is acquired
          // BEFORE the prompt is sent and released when the turn reaches a
          // terminal event, because `sendPrompt` is fire-and-forget on every
          // provider: holding the permit only across the await would bound
          // nothing at all.
          await this.acquireTurnPermit(session);
          await runtime.harness.sendPrompt(session.conversationId, prompt, attachments as never);
          this.sendControl({ type: 'ack', reqId, ok: true });
          // M5-fix: cancel any prior waitForTurnEnd before registering a new one.
          this.waitForTurnEnd(sessionId, session, runtime.harness);
        } catch (err: unknown) {
          session.releaseTurnPermit?.();
          this.sendControl({ type: 'error', reqId, ok: false, message: String(err), code: 'SEND_FAILED' });
        }
        return;
      }

      case 'abort_session': {
        const { reqId, sessionId } = req;
        const session = this.sessions.get(sessionId);
        const runtime = session ? this.supervisor.get(session.runtimeId) : undefined;
        if (!session || !runtime) {
          this.sendControl({ type: 'error', reqId, ok: false, message: `No runtime for session ${sessionId}`, code: 'SESSION_NOT_FOUND' });
          return;
        }
        try {
          await runtime.harness.abortConversation(session.conversationId);
          this.sendControl({ type: 'ack', reqId, ok: true });
        } catch (err: unknown) {
          this.sendControl({ type: 'error', reqId, ok: false, message: String(err), code: 'ABORT_FAILED' });
        }
        return;
      }

      case 'delete_session': {
        const { reqId, sessionId } = req;
        const session = this.sessions.get(sessionId);
        const runtime = session ? this.supervisor.get(session.runtimeId) : undefined;
        if (session && runtime) {
          try {
            await runtime.harness.deleteConversation(session.conversationId);
            runtime.sessionCount = Math.max(0, runtime.sessionCount - 1);
          } catch (err: unknown) {
            this.logger.warn(`[AgentHostServer] deleteConversation error for ${sessionId}: ${String(err)}`);
          }
        }
        // △ Teardown used to live inside `if (runtime && conversationId)`, so a
        // session whose runtime had already gone away leaked its harness
        // subscription and its turn permit forever. Teardown is unconditional
        // now — it is the thing that MUST happen on delete.
        this.teardownSession(sessionId);
        this.sendControl({ type: 'ack', reqId, ok: true });
        return;
      }

      default: {
        const unknown = req as { type: string; reqId?: string };
        this.logger.warn(`[AgentHostServer] Unknown request type: ${unknown.type}`);
        if (unknown.reqId) {
          this.sendControl({ type: 'error', reqId: unknown.reqId, ok: false, message: `Unknown type: ${unknown.type}` });
        }
      }
    }
  }

  private async handleSpawn(reqId: string, sessionId: string, params: Record<string, unknown>): Promise<void> {
    const runtime = (await this.ensureRuntime()) ?? undefined;
    if (!runtime) {
      this.sendControl({ type: 'error', reqId, ok: false, message: 'No provider runtime available', code: 'NO_RUNTIME' });
      return;
    }

    // △ A repeated spawn for the same sessionId used to stash the new
    // unsubscribe handle over the old one on a dynamic `_unsub_<id>` property,
    // leaking the previous subscription. Tear the old session down first.
    if (this.sessions.has(sessionId)) {
      this.logger.warn(`[AgentHostServer] Re-spawning existing session ${sessionId} — tearing down the previous one`);
      this.teardownSession(sessionId);
    }

    try {
      // W12 — cold starts are the expensive, thundering-herd-prone operation
      // (a provider CLI launch), so they get their own, narrower semaphore.
      const conversationId = await this.coldStartSemaphore.run(() =>
        runtime.harness.createConversation(params as unknown as Parameters<IAgentHarness['createConversation']>[0]),
      );

      this.attachSession(sessionId, runtime, conversationId, params);
      this.sendControl({ type: 'ack', reqId, ok: true });
    } catch (err: unknown) {
      this.sendControl({ type: 'error', reqId, ok: false, message: String(err), code: 'SPAWN_FAILED' });
    }
  }

  /**
   * Return a usable runtime, building one on demand if boot never produced one.
   *
   * `index.ts` treats a failed boot as non-fatal and says the host "will retry
   * on demand" — this is what makes that true. Without it a provider that was
   * unreachable for the few seconds around boot leaves the host permanently
   * answering NO_RUNTIME with nothing to retry it.
   *
   * The in-flight promise is shared so a burst of spawns builds ONE runtime.
   */
  private async ensureRuntime(): Promise<RuntimeEntry | undefined> {
    const existing = this.supervisor.pickRuntime();
    if (existing) return existing;
    if (!this.createHarness) return undefined;

    this.pendingRuntimeBuild ??= this.coldStartSemaphore
      .run(async () => {
        // Re-check under the permit: a queued caller may have been satisfied
        // by the build that held the permit before us.
        const raced = this.supervisor.pickRuntime();
        if (raced) return raced;
        const id = this.supervisor.register(await this.createHarness!());
        return this.supervisor.get(id);
      })
      .catch((err: unknown) => {
        this.logger.error(`[AgentHostServer] On-demand runtime build failed: ${String(err)}`);
        return undefined;
      })
      .finally(() => {
        this.pendingRuntimeBuild = undefined;
      });

    return this.pendingRuntimeBuild;
  }

  /**
   * Subscribe to a live conversation and commit the session record.
   *
   * B3-fix: all state is committed AFTER every can-throw operation succeeds.
   * The subscription is registered before the record so no event emitted
   * between `createConversation` and here is lost.
   */
  private attachSession(
    sessionId: string,
    runtime: RuntimeEntry,
    conversationId: string,
    params: Record<string, unknown>,
  ): SessionRecord {
    const unsubscribeEvents = runtime.harness.onConversationEvent(conversationId, (event) => {
      this.demux.dispatch(sessionId, { kind: 'event', event });
      this.schedulePump();
    });

    const record: SessionRecord = {
      runtimeId: runtime.id,
      conversationId,
      params,
      unsubscribeEvents,
    };
    this.sessions.set(sessionId, record);
    runtime.sessionCount++;
    return record;
  }

  /**
   * Acquire an execution permit for a turn and install the release path.
   * Release is idempotent and armed with a hard hold cap so a provider that
   * never emits a terminal event cannot permanently consume a permit.
   */
  private async acquireTurnPermit(session: SessionRecord): Promise<void> {
    // A second send_turn on the same session while one is in flight reuses the
    // permit already held rather than taking a second one — one session, one
    // concurrent turn is the provider contract everywhere.
    if (session.releaseTurnPermit) return;

    await this.executionSemaphore.acquire();

    let released = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const release = (): void => {
      if (released) return;
      released = true;
      if (timer) clearTimeout(timer);
      if (session.releaseTurnPermit === release) delete session.releaseTurnPermit;
      this.executionSemaphore.release();
    };

    timer = setTimeout(() => {
      this.logger.warn(
        `[AgentHostServer] Turn permit held for ${TURN_PERMIT_MAX_HOLD_MS}ms with no terminal event — ` +
          'releasing so other sessions are not starved by a wedged provider',
      );
      release();
    }, TURN_PERMIT_MAX_HOLD_MS);
    if (typeof timer.unref === 'function') timer.unref();

    session.releaseTurnPermit = release;
  }

  /**
   * Wait for terminal events from the harness on the session's conversation,
   * then enqueue `session_ended` and release the turn permit.
   *
   * M5-fix: cancels any prior listener for this session before registering a
   * new one, so at most one terminal notification is sent per session.
   */
  private waitForTurnEnd(sessionId: string, session: SessionRecord, harness: IAgentHarness): void {
    session.unsubscribeTurnEnd?.();
    delete session.unsubscribeTurnEnd;

    const unsubscribe = harness.onConversationEvent(session.conversationId, (event) => {
      const kind = (event as { kind?: string }).kind ?? '';
      let ended: { reason: 'complete' | 'error' | 'cancelled'; error?: string } | null = null;

      // △ This used to key on 'chat.message_complete', a kind nothing emits
      // (see packages/shared/src/types/AgentEvent.ts — the real one is
      // 'harness.message_complete'), so the only branch that ever fired was
      // 'harness.idle'. `harness.message_complete` is NOT terminal on its own:
      // an agentic turn emits several, interleaved with tool calls. Only
      // 'harness.idle' ends a turn.
      if (kind === 'harness.idle') {
        ended = { reason: 'complete' };
      } else if (kind === 'harness.cancelled') {
        ended = { reason: 'cancelled' };
      } else if (kind === 'harness.error') {
        ended = { reason: 'error', error: (event as { data?: { message?: string } }).data?.message ?? 'Unknown error' };
      }

      if (ended) {
        unsubscribe();
        if (session.unsubscribeTurnEnd === unsubscribe) delete session.unsubscribeTurnEnd;
        session.releaseTurnPermit?.();
        // Enqueued, not written directly: the terminal frame must land after
        // the tokens still queued ahead of it.
        this.demux.dispatch(sessionId, { kind: 'ended', ...ended });
        this.schedulePump();
      }
    });

    session.unsubscribeTurnEnd = unsubscribe;
  }

  private teardownSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    session.unsubscribeTurnEnd?.();
    session.unsubscribeEvents();
    session.releaseTurnPermit?.();
    this.demux.remove(sessionId);
  }

  // ── Recycling support ─────────────────────────────────────────────────────

  /**
   * W12 drain-and-swap. Re-creates every session owned by `from` on `to` using
   * the params the gateway originally sent, then repoints the session records.
   *
   * The gateway is not involved: its sessionId is unchanged, so from its side a
   * recycle is invisible. A session that cannot be re-created is torn down and
   * reported to the gateway as `session_ended{reason:'error'}` — losing one
   * session loudly beats leaving it pointed at a stopped harness, which is the
   * silent `SESSION_NOT_FOUND`-forever failure this whole task exists to fix.
   */
  private async drainSessions(from: RuntimeEntry, to: RuntimeEntry): Promise<void> {
    const moving = [...this.sessions.entries()].filter(([, s]) => s.runtimeId === from.id);
    for (const [sessionId, session] of moving) {
      try {
        // B3 — carry the PROVIDER's own session id across, not just our params.
        // The replacement adapter has never heard of this conversation, so
        // without the resume token it starts the model from nothing and the
        // chat silently loses its whole history mid-conversation. When the
        // provider has no such id we say so rather than pretending continuity.
        const resumeProviderSessionId = from.harness.getProviderSessionId?.(session.conversationId);
        if (!resumeProviderSessionId) {
          this.logger.warn(
            `[AgentHostServer] Recycling with no resume token for session ${sessionId} — ` +
              'the replacement runtime starts this conversation without provider-side history',
          );
        }
        const conversationId = await to.harness.createConversation({
          ...session.params,
          conversationId: session.conversationId,
          ...(resumeProviderSessionId ? { resumeProviderSessionId } : {}),
        } as unknown as Parameters<IAgentHarness['createConversation']>[0]);
        // Drop the old subscriptions before re-attaching so the old harness
        // cannot keep pushing frames for a session it no longer owns.
        session.unsubscribeTurnEnd?.();
        session.unsubscribeEvents();
        session.releaseTurnPermit?.();
        from.sessionCount = Math.max(0, from.sessionCount - 1);
        this.attachSession(sessionId, to, conversationId, session.params);
      } catch (err: unknown) {
        this.logger.error(`[AgentHostServer] Failed to migrate session ${sessionId} during recycle: ${String(err)}`);
        this.teardownSession(sessionId);
        from.sessionCount = Math.max(0, from.sessionCount - 1);
        this.demux.dispatch(sessionId, { kind: 'ended', reason: 'error', error: 'Provider runtime was recycled and the session could not be migrated' });
        this.schedulePump();
      }
    }
  }

  /**
   * B3 — why this runtime must not be recycled right now, or undefined.
   *
   * A turn in flight is running INSIDE the old harness. Drain-and-swap can move
   * the session record, but it cannot move a running turn: the moment the old
   * harness stops, that turn's events stop arriving and no terminal frame is
   * ever produced — the gateway waits forever on a turn nobody is running. So
   * the runtime waits instead. The wait is bounded: every turn permit carries a
   * hard hold cap (TURN_PERMIT_MAX_HOLD_MS) after which it releases itself, so
   * even a wedged provider cannot postpone a recycle indefinitely.
   */
  private recycleBlockedBy(entry: RuntimeEntry): string | undefined {
    let busy = 0;
    for (const session of this.sessions.values()) {
      if (session.runtimeId === entry.id && session.releaseTurnPermit) busy++;
    }
    return busy > 0 ? `${busy} session(s) have a turn in flight` : undefined;
  }

  // ── Introspection (tests, health) ─────────────────────────────────────────

  /** Live session ids. */
  activeSessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  demuxStats(): { sessions: number; queuedFrames: number; droppedFrames: number } {
    return this.demux.stats();
  }

  concurrencyStats(): { executionQueueDepth: number; coldStartQueueDepth: number } {
    return {
      executionQueueDepth: this.executionSemaphore.queueDepth,
      coldStartQueueDepth: this.coldStartSemaphore.queueDepth,
    };
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.pumpRetryTimer) {
      clearTimeout(this.pumpRetryTimer);
      this.pumpRetryTimer = undefined;
    }
    for (const sessionId of [...this.sessions.keys()]) {
      this.teardownSession(sessionId);
    }
    await this.supervisor.shutdown();
    this.logger.info('[AgentHostServer] Shutdown complete');
  }
}
