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
import type { ILogger } from '@generatorai/shared';

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
}

/** Hard ceiling on synchronous replay to prevent a client asking for 10k events at once. */
const MAX_SYNC_REPLAY = 1000;
/** Hard ceiling on filter prefix count — STR-06 says 10. */
const MAX_KIND_PREFIXES = 10;

/**
 * Raw SDK passthrough that no client renders.
 *
 * These were 98% of one orchestrator turn's 19k events and ~1M rows of
 * `stream_cursors`. Dropping them at the broker shrinks the window in which a
 * frame can be lost and stops them masking a stalled stream.
 * Set `GENERATORAI_STREAM_DEBUG_NOISE=1` to keep them for diagnostics.
 */
const NOISE_KINDS = new Set(['harness.session_info', 'harness.unknown']);
const KEEP_NOISE = process.env['GENERATORAI_STREAM_DEBUG_NOISE'] === '1';

export class StreamBroker {
  private subscribers = new Map<string, Set<StreamEventHandler>>();

  constructor(
    private readonly repo: DrizzleStreamCursorRepository,
    private readonly logger: ILogger,
  ) {}

  /**
   * Persist an event to the durable log and broadcast to current subscribers.
   *
   * The DB write happens BEFORE the in-memory fan-out (commit-then-broadcast
   * ordering). This guarantees read-your-writes: a REST replay fetched
   * immediately after the publish resolves will include the new event.
   */
  async publish(
    scope: StreamScope,
    scopeId: string,
    kind: string,
    data: unknown,
  ): Promise<StreamBrokerPublishResult> {
    if (!KEEP_NOISE && NOISE_KINDS.has(kind)) {
      return { seq: -1, id: -1, ts: Date.now() };
    }
    const row = await this.repo.append(scope, scopeId, kind, data);

    const key = this.keyFor(scope, scopeId);
    const handlers = this.subscribers.get(key);
    if (handlers && handlers.size > 0) {
      // Copy to avoid set-mutation-during-iteration if a handler unsubscribes.
      for (const handler of [...handlers]) {
        try {
          // Handlers are fire-and-forget from the broker's perspective.
          // STR-05 — the SSE route is responsible for backpressure; the
          // broker never blocks on a slow consumer.
          const ret = handler(row);
          if (ret && typeof (ret as Promise<void>).catch === 'function') {
            (ret as Promise<void>).catch((err) => {
              this.logger.warn?.(
                `[StreamBroker] handler rejected for ${key}: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            });
          }
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

    return { seq: row.seq, id: row.id, ts: row.ts };
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
      try {
        const replayed = await this.repo.replayAfter(scope, scopeId, opts.afterSeq, syncLimit);
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
