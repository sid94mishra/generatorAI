// ────────────────────────────────────────────────────────────────
// StreamBroker — STR-01 / Phase 4 foundation
//
// Single entry point for publishing and consuming agent events. Replaces
// the 4 per-route ring buffers + `DurableStreamManager` once the web
// client is migrated (STR-04 / CLN-12). Today it coexists with the
// legacy transports as an additive service.
//
// Four scopes, independent monotonic sequence spaces:
//   - session | run | chat | global
//
// Durability: every publish is persisted to `stream_cursors` so late
// reconnects replay from DB regardless of process restarts (replaces
// the in-memory ring buffers of old).
//
// Real-time: in-memory `Map<key, Set<handler>>` fans out to current
// subscribers. Subscribers that fall behind (slow consumers) are
// detected via bounded write queues in the SSE route (STR-05).
// ────────────────────────────────────────────────────────────────

import type {
  DrizzleStreamCursorRepository,
  StreamEventRow,
  StreamScope,
} from '@generatorai/db';
import { classifyEvent, type ILogger } from '@generatorai/shared';
import { isNoiseEventKind } from '../events/EventBus.js';
import type { DeltaLog } from './DeltaLog.js';
import { StreamWriteBatcher, type StreamWriteBatcherOptions } from './StreamWriteBatcher.js';

export type { StreamEventRow, StreamScope } from '@generatorai/db';

export type StreamEventHandler = (event: StreamEventRow) => void | Promise<void>;

export interface StreamBrokerPublishResult {
  readonly seq: number;
  readonly id: number;
  readonly ts: number;
}

export interface StreamBrokerSubscribeOptions {
  /**
   * If provided, the broker replays persisted events with seq > afterSeq
   * BEFORE attaching the real-time handler. STR-06 — the sync replay is
   * capped at `syncReplayLimit` (default 100); callers that want more
   * should paginate via `replay()` on the REST side.
   */
  readonly afterSeq?: number;
  /**
   * Upper bound for synchronous replay rows. Defaults to 100.
   * Clamped server-side; caller cannot exceed 1000.
   */
  readonly syncReplayLimit?: number;
  /**
   * STR-06 — optional kind-prefix allowlist. Only events whose `kind`
   * starts with one of the prefixes is delivered. Maximum 10 prefixes
   * (enforced by the route, but we clamp again here as defense-in-depth).
   */
  readonly kindPrefixes?: readonly string[];
  /**
   * Called once, before any event is delivered, with the truth about resume.
   *
   * W08 — a client whose cursor fell outside retention must be TOLD, because
   * the alternative is a silent, permanent hole. Replaying "everything after
   * seq 40" when the oldest surviving row is 100 delivers rows the client can
   * render but leaves 41-99 missing forever, with nothing to detect it by.
   */
  readonly onResume?: (status: StreamResumeStatus) => void;
}

export interface StreamResumeStatus {
  /**
   * False when the cursor could not be honoured and the client must
   * re-snapshot. True when every event after the cursor was delivered.
   */
  resumed: boolean;
  /** Cursor the client asked to resume from. */
  afterSeq: number;
  /** Oldest seq still stored for this scope, 0 when the scope is empty. */
  oldestSeq: number;
  /** Highest seq delivered during replay. */
  deliveredUpTo: number;
  /** Set when `resumed` is false. A closed set so a caller cannot forget one. */
  reason?: 'cursor_expired' | 'replay_truncated';
}

/** Hard ceiling on synchronous replay to prevent a client asking for 10k events at once. */
const MAX_SYNC_REPLAY = 1000;
/** Hard ceiling on filter prefix count — STR-06 says 10. */
const MAX_KIND_PREFIXES = 10;

/**
 * Defence in depth for direct `publish()` callers. The primary filter now runs
 * in `EventBus.emit`, before sequence allocation and fan-out — see
 * `isNoiseEventKind`.
 */

export interface StreamBrokerOptions extends StreamWriteBatcherOptions {
  /**
   * W07 — when wired, every DELTA-classified publish is ALSO appended here.
   *
   * This is a dual-write, not a cutover: deltas still go through `writer` into
   * `stream_cursors` exactly as before, so replay-after-reconnect is
   * unchanged. Moving deltas to read FROM the delta log instead — and
   * stopping the SQL write for them — is a durable-shape change gated behind
   * W47's compatibility window, not a decision this constructor makes alone.
   */
  deltaLog?: DeltaLog;
}

export class StreamBroker {
  private subscribers = new Map<string, Set<StreamEventHandler>>();
  private readonly writer: StreamWriteBatcher;
  private readonly deltaLog: DeltaLog | undefined;

  constructor(
    private readonly repo: DrizzleStreamCursorRepository,
    private readonly logger: ILogger,
    options: StreamBrokerOptions = {},
  ) {
    this.writer = new StreamWriteBatcher(repo, logger, options);
    this.deltaLog = options.deltaLog;
  }

  /** Flush anything still queued — the SQL writer AND the delta log, if wired. Call from the shutdown path. */
  async flushWrites(): Promise<void> {
    await Promise.all([this.writer.flush(), this.deltaLog?.flush() ?? Promise.resolve()]);
  }

  /**
   * Identity of this database's sequence space, for resume validation (W08).
   *
   * Belongs to the DATABASE, not the process: `stream_sequences` persists and
   * is never reset, so a cursor minted before a restart is still valid.
   */
  async streamSpaceId(): Promise<string> {
    return this.repo.streamSpaceId();
  }

  /** Events queued but not yet committed. Surfaced on the health endpoint. */
  get writeDepth(): number {
    return this.writer.depth;
  }

  /**
   * Persist an event to the durable log and broadcast to current subscribers.
   *
   * The DB write happens BEFORE the in-memory fan-out (commit-then-broadcast
   * ordering). This guarantees read-your-writes: a REST replay fetched
   * immediately after the publish resolves will include the new event.
   *
   * W07 — the write goes through a batcher now, so several events can share one
   * WAL commit. The ordering above is unchanged: `write()` resolves only after
   * the batch containing this event has committed.
   */
  async publish(
    scope: StreamScope,
    scopeId: string,
    kind: string,
    data: unknown,
  ): Promise<StreamBrokerPublishResult> {
    if (isNoiseEventKind(kind, data)) {
      return { seq: -1, id: -1, ts: Date.now() };
    }
    const row = await this.writer.write(scope, scopeId, kind, data);
    // W07 — dual-write, present only when the composition root opted in
    // (`GENERATORAI_DELTA_LOG=true`). NOTE: nothing reads the delta log yet —
    // replay is served from `stream_cursors` above — so with the flag on every
    // delta costs a SQL row AND a file append. The design this was meant to
    // implement (deltas only in the log, merged into replay by `seq`) is
    // still open; see ARCH_PERF_AUDIT_2026-09-05.md F2 / A11. Fire-and-forget
    // from the caller's perspective: the delta log buffers and flushes on its
    // own schedule (see `DeltaLog.append`) and must never be awaited on the
    // token path.
    if (this.deltaLog && classifyEvent(kind, data) === 'delta') {
      this.deltaLog.append(scope, scopeId, { seq: row.seq, kind, payload: data, ts: row.ts });
    }
    await this.fanOut(row);
    return { seq: row.seq, id: row.id, ts: row.ts };
  }

  /**
   * Broadcast a committed row to current subscribers.
   *
   * Only ever called after the durable write resolves — that ordering IS the
   * commit-then-broadcast invariant (EVT-01).
   *
   * W06 — this used to be fire-and-forget ("the broker never blocks on a slow
   * consumer"), which is exactly why nothing ever slowed a producer: the
   * per-connection queue bounded MEMORY, but `publish()` returned regardless
   * of whether any subscriber actually accepted the frame. Handlers are now
   * awaited sequentially, matching the plan's "awaited sequential dispatch."
   * A connection only returns a pending promise from `deliver()` when an ITEM
   * had to be queued (deltas are dropped, never waited on), so this only ever
   * slows the caller when there is real, bounded backpressure to apply — and
   * because `publish()` is awaited by `EventBus`'s per-session emit queue,
   * that wait reaches back to the harness's own read loop for that session.
   *
   * One scope can have more than one live subscriber (two tabs on the same
   * chat, or during a reconnect overlap); a slow one delays its siblings on
   * the same scope. That is the accepted trade of a shared physical
   * connection, not a defect — see `MuxSseConnection`'s per-scope queues for
   * why an unrelated scope on the SAME connection is not affected.
   */
  private async fanOut(row: StreamEventRow): Promise<void> {
    const key = this.keyFor(row.scope, row.scopeId);
    const handlers = this.subscribers.get(key);
    if (!handlers || handlers.size === 0) return;

    // Copy to avoid set-mutation-during-iteration if a handler unsubscribes.
    for (const handler of [...handlers]) {
      try {
        await handler(row);
      } catch (err) {
        // STR-05 / RM §2.2 — don't swallow, don't abort the fan-out.
        this.logger.warn?.(
          `[StreamBroker] handler threw for ${key}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  /**
   * Subscribe to live events for a (scope, scopeId) pair. Returns an
   * unsubscribe function. If `afterSeq` is set, persisted events with
   * seq > afterSeq are replayed (capped) BEFORE real-time delivery —
   * which is exactly the Last-Event-ID resume flow.
   *
   * Correctness:
   *   We attach the fan-out handler FIRST (buffering real-time events into
   *   a queue) so a publish that commits DURING the replay fetch is not
   *   lost. After replay completes we flush the queue, using the
   *   `deliveredUpTo` watermark to skip rows the replay already delivered,
   *   then swap the wrapped handler to pure passthrough. Without this
   *   two-phase dance, a race between `replayAfter()` and `publish()` could
   *   swallow events that landed after the SELECT but before the Set.add.
   */
  async subscribe(
    scope: StreamScope,
    scopeId: string,
    handler: StreamEventHandler,
    opts: StreamBrokerSubscribeOptions = {},
  ): Promise<() => void> {
    const syncLimit = Math.max(
      1,
      Math.min(opts.syncReplayLimit ?? 100, MAX_SYNC_REPLAY),
    );
    const prefixes = this.normalisePrefixes(opts.kindPrefixes);
    const key = this.keyFor(scope, scopeId);

    // Phase 1 — buffering. Real-time events land in `buffer` until we
    // finish replay; then we flush + swap modes.
    let mode: 'buffering' | 'live' = 'buffering';
    const buffer: StreamEventRow[] = [];
    let deliveredUpTo = opts.afterSeq ?? 0;

    const wrapped: StreamEventHandler = (row) => {
      if (mode === 'buffering') {
        buffer.push(row);
        return;
      }
      if (row.seq <= deliveredUpTo) return;
      if (!this.matchesPrefix(row.kind, prefixes)) return;
      deliveredUpTo = row.seq;
      return handler(row);
    };

    let set = this.subscribers.get(key);
    if (!set) {
      set = new Set();
      this.subscribers.set(key, set);
    }
    set.add(wrapped);

    // Phase 2 — replay persisted events. Any publish arriving during this
    // await lands in `buffer` via `wrapped` (mode='buffering').
    if (opts.afterSeq !== undefined) {
      const requested = opts.afterSeq;
      try {
        // Read the floor AFTER replaying, not before — △ fixed during Phase 1
        // review. Two separate `await`s are two separate opportunities for a
        // retention sweep to run in between them, and reading `oldest` first
        // makes that race land the UNSAFE way: retention deletes rows between
        // the two reads, `oldest` is now stale-LOW, `oldest > requested + 1`
        // under-fires, and a genuinely incomplete replay is reported
        // `resumed: true` — the exact silent hole this mechanism exists to
        // prevent. Reading `replayAfter` first and `oldestSeq` second means
        // the floor can only ever be stale-HIGH relative to the replay it is
        // validating, which fails the other way: an unnecessary
        // `cursor_expired` on a replay that actually succeeded. That costs a
        // redundant re-snapshot — cheap, visible, and never a silent lie.
        const replayed = await this.repo.replayAfter(scope, scopeId, requested, syncLimit);
        const oldest = await this.repo.oldestSeq(scope, scopeId);

        // The verdict is reached, and reported, BEFORE a single event is
        // delivered. Both inputs are already known, and a client told about a
        // hole only after the events following it has already rendered them
        // into the hole.
        //
        // Two distinct ways to fail, and the client's response differs: an
        // expired cursor needs a full re-snapshot, a truncated replay needs
        // another page. Collapsing them into one boolean would make the cheap
        // case as expensive as the expensive one.
        if (opts.onResume) {
          let reason: StreamResumeStatus['reason'];
          if (oldest > 0 && requested > 0 && oldest > requested + 1) {
            reason = 'cursor_expired';
          } else if (replayed.length >= syncLimit) {
            reason = 'replay_truncated';
          }
          opts.onResume({
            resumed: reason === undefined,
            afterSeq: requested,
            oldestSeq: oldest,
            deliveredUpTo: replayed.at(-1)?.seq ?? requested,
            ...(reason === undefined ? {} : { reason }),
          });
        }

        for (const row of replayed) {
          if (!this.matchesPrefix(row.kind, prefixes)) continue;
          try {
            await handler(row);
          } catch (err) {
            this.logger.warn?.(
              `[StreamBroker] replay handler threw: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
          if (row.seq > deliveredUpTo) deliveredUpTo = row.seq;
        }
      } catch (err) {
        // If replay itself fails, detach and surface — caller is left in a
        // consistent state (no partial delivery + phantom subscription).
        set.delete(wrapped);
        if (set.size === 0) this.subscribers.delete(key);
        throw err;
      }
    } else {
      // No cursor: nothing to resume, and saying so is still the honest answer
      // — the client knows it is starting from a snapshot rather than guessing.
      opts.onResume?.({
        resumed: false,
        afterSeq: 0,
        oldestSeq: 0,
        deliveredUpTo: 0,
        reason: 'cursor_expired',
      });
    }

    // Phase 3 — drain the buffer (dedup by watermark), then flip to live.
    // Copy so additional events that arrive while we're draining (which
    // this loop itself cannot receive synchronously — JS single-threaded)
    // can enqueue safely in the next microtask.
    const toFlush = buffer.splice(0);
    for (const row of toFlush) {
      if (row.seq <= deliveredUpTo) continue;
      if (!this.matchesPrefix(row.kind, prefixes)) continue;
      deliveredUpTo = row.seq;
      try {
        await handler(row);
      } catch (err) {
        this.logger.warn?.(
          `[StreamBroker] flush handler threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    mode = 'live';

    return () => {
      const current = this.subscribers.get(key);
      if (!current) return;
      current.delete(wrapped);
      if (current.size === 0) this.subscribers.delete(key);
    };
  }

  /**
   * REST-style replay. Never touches in-memory subscriptions. STR-06 caps
   * sync return size; callers paginate by passing `afterSeq = lastSeq`.
   */
  async replay(
    scope: StreamScope,
    scopeId: string,
    afterSeq: number,
    limit: number = 100,
  ): Promise<StreamEventRow[]> {
    const clamped = Math.max(1, Math.min(limit, MAX_SYNC_REPLAY));
    return this.repo.replayAfter(scope, scopeId, afterSeq, clamped);
  }

  /** Current live-subscriber count for (scope, scopeId). */
  subscriberCount(scope: StreamScope, scopeId: string): number {
    return this.subscribers.get(this.keyFor(scope, scopeId))?.size ?? 0;
  }

  /** Prune persisted rows older than `olderThanMs` from now. */
  async prune(olderThanMs: number): Promise<number> {
    const cutoff = Date.now() - olderThanMs;
    return this.repo.prune(cutoff);
  }

  // ── Internals ──

  private keyFor(scope: StreamScope, scopeId: string): string {
    return `${scope}:${scopeId}`;
  }

  private normalisePrefixes(input: readonly string[] | undefined): readonly string[] | null {
    if (!input || input.length === 0) return null;
    const cleaned = input
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .slice(0, MAX_KIND_PREFIXES);
    return cleaned.length > 0 ? cleaned : null;
  }

  private matchesPrefix(kind: string, prefixes: readonly string[] | null): boolean {
    if (prefixes === null) return true;
    for (const p of prefixes) {
      if (kind === p || kind.startsWith(p)) return true;
    }
    return false;
  }
}
