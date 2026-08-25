// ────────────────────────────────────────────────────────────────
// MuxSseConnection — W09-a (§5.9)
//
// One socket carrying many scopes. The single-scope `SseConnection` cannot be
// reused for this: its queue, its congestion decision and its gap marker are
// all connection-wide, so on a multiplexed socket a stalled preview scope
// would stall chat tokens — the exact head-of-line problem §5.9.2 ③ names as
// the reason five connections existed in the first place.
//
// The difference that matters is that **every bound here is per scope**. A
// scope that cannot keep up loses its own frames and is told so in a
// scope-local `gap`; its siblings are untouched. Only a socket that cannot
// drain *at all* costs the connection, which is why `slow_consumer_dropped`
// is bounded by total bytes rather than by any one scope's backlog.
//
// Coalescing, by contrast, is deliberately connection-wide: batching frames
// from several scopes into one write is the whole point of one socket.
// ────────────────────────────────────────────────────────────────

import type { Response } from 'express';
import type { StreamEventRow } from '@generatorai/core';
import { classifyEvent } from '@generatorai/shared';

import { FrameCoalescer } from './coalescer.js';

/**
 * Item frames one scope may hold before its oldest are dropped.
 *
 * Lower than the single-scope cap of 256 on purpose: 32 scopes each holding
 * 256 frames is a backlog no client is going to catch up with, and the point
 * of dropping is to let the scope rejoin the live edge, not to buffer history
 * that `replay()` can return far more cheaply.
 */
const MAX_QUEUED_ITEMS_PER_SCOPE = 64;

/**
 * Total queued bytes before the connection itself is judged unable to drain.
 *
 * This is the only connection-wide bound, and it is the last resort §5.9.4
 * describes: a slow scope gets a `gap` first.
 */
const MAX_QUEUED_BYTES = 8 * 1024 * 1024;

export interface MuxScopeStats {
  readonly droppedDeltas: number;
  readonly droppedItems: number;
  readonly queuedItems: number;
}

export interface MuxConnectionStats {
  readonly queuedBytes: number;
  readonly shed: boolean;
  readonly scopes: ReadonlyMap<string, MuxScopeStats>;
}

interface ScopeState {
  queue: Array<{ seq: number; frame: string }>;
  queuedBytes: number;
  droppedDeltas: number;
  droppedItems: number;
  gapFrom: number | undefined;
  gapTo: number;
  /** W06 — producers waiting for THIS scope's queue to drain. See `deliver()`. */
  drainWaiters: Array<() => void>;
}

/**
 * Encode-once cache (P1-10), keyed by row **and** scope key.
 *
 * One row fans out to several scopes and each needs its own `s`, so a single
 * cached string would be wrong. Subscribers sharing a scope key still share
 * one `JSON.stringify`, which is what the defect was actually about. Weak on
 * the row so the whole entry disappears with the event.
 */
const frameCache = new WeakMap<StreamEventRow, Map<string, string>>();

export function encodeMuxFrame(scopeKey: string, row: StreamEventRow): string {
  let byScope = frameCache.get(row);
  if (byScope === undefined) {
    byScope = new Map();
    frameCache.set(row, byScope);
  }
  let frame = byScope.get(scopeKey);
  if (frame === undefined) {
    // Short field names because they repeat on every token (§5.9.4).
    // `e` is the global `stream_cursors` row id — stable across every scope
    // the event fans out to, and therefore the client's dedup key (N-10).
    frame = JSON.stringify({
      s: scopeKey,
      q: row.seq,
      e: row.id,
      k: row.kind,
      p: row.payload ?? null,
    });
    byScope.set(scopeKey, frame);
  }
  return frame;
}

export class MuxSseConnection {
  private congested = false;
  private closed = false;
  private shedReason: string | undefined;

  private readonly scopes = new Map<string, ScopeState>();
  private totalQueuedBytes = 0;

  /** Opaque per-connection frame counter. See `frameText`. */
  private frameId = 0;

  /** Round-robin state so draining never starves a scope behind a busy one. */
  private drainOrder: string[] = [];
  private drainIndex = 0;

  /**
   * W05 — one coalescer for the whole connection, not one per scope.
   *
   * Frames already carry `s`, so batching several scopes into one write is
   * exactly what multiplexing is for. Per-scope coalescers would each hold
   * their own timer and produce N writes per window, which is the cost this
   * exists to remove.
   */
  private readonly coalescer = new FrameCoalescer((payload) => this.writeRaw(payload));

  constructor(
    private readonly res: Response,
    private readonly onShed: (reason: string) => void,
  ) {
    this.res.on('drain', () => this.onDrain());
  }

  get isClosed(): boolean {
    return this.closed || this.res.writableEnded;
  }

  get stats(): MuxConnectionStats {
    const scopes = new Map<string, MuxScopeStats>();
    for (const [key, st] of this.scopes) {
      scopes.set(key, {
        droppedDeltas: st.droppedDeltas,
        droppedItems: st.droppedItems,
        queuedItems: st.queue.length,
      });
    }
    return { queuedBytes: this.totalQueuedBytes, shed: this.shedReason !== undefined, scopes };
  }

  /**
   * Deliver one event on one scope.
   *
   * The `queue.length > 0` test is per scope, not per connection: a scope with
   * nothing pending writes straight through even while a sibling is backed up.
   * Within a scope it preserves order, which is the only ordering the client
   * relies on — its cursor map is per scope too.
   *
   * `cls` overrides W04's classification for scopes whose kinds are not agent
   * events (see `ephemeralScopes.ts`); without it every preview frame would
   * classify as an unrecognised `item` and be queued rather than dropped.
   */
  deliver(scopeKey: string, row: StreamEventRow, cls?: 'delta' | 'item'): void | Promise<void> {
    if (this.isClosed) return undefined;
    const st = this.stateFor(scopeKey);
    const frame = encodeMuxFrame(scopeKey, row);
    const isDelta = (cls ?? classifyEvent(row.kind, row.payload)) === 'delta';

    if (this.congested || st.queue.length > 0) {
      if (isDelta) {
        st.droppedDeltas += 1;
        this.noteGap(st, row.seq);
        return undefined;
      }
      this.enqueueItem(scopeKey, st, row.seq, frame);
      // W06 — the queue is per scope, but the byte ceiling that can shed is
      // connection-wide. A waiter registered after that shed would never be
      // released — the state it would resolve on no longer exists.
      if (this.isClosed) return undefined;
      return new Promise<void>((resolve) => {
        st.drainWaiters.push(resolve);
      });
    }

    const text = this.frameText(frame);
    if (isDelta) this.coalescer.defer(text);
    else this.coalescer.flushWith(text);
    return undefined;
  }

  /** Heartbeat. Sent even while congested — see `SseConnection.writeComment`. */
  writeComment(text: string): void {
    if (this.isClosed) return;
    this.coalescer.flush();
    if (this.isClosed) return;
    try {
      this.res.write(`: ${text}\n\n`);
    } catch {
      this.close();
    }
  }

  /** `hello`, `subs` and `gap`. Never queued and never clears `congested`. */
  writeControl(event: string, data: unknown): void {
    if (this.isClosed) return;
    // Buffered frames go first so a control frame never describes a state the
    // client has not been shown yet.
    this.coalescer.flush();
    if (this.isClosed) return;
    try {
      this.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      this.close();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.coalescer.cancel();
    // A producer waiting on any scope to drain must be released now — there
    // is no future drain event coming to do it (W06).
    for (const st of this.scopes.values()) this.releaseScopeWaiters(st);
    this.scopes.clear();
    this.drainOrder = [];
    this.drainIndex = 0;
    this.totalQueuedBytes = 0;
  }

  /** Drop a scope's buffered state when its subscription is removed. */
  forgetScope(scopeKey: string): void {
    const st = this.scopes.get(scopeKey);
    if (!st) return;
    // Same reasoning as `close()`, scoped to just this one scope: nothing is
    // ever going to drain it again once its state is gone.
    this.releaseScopeWaiters(st);
    this.totalQueuedBytes -= st.queuedBytes;
    this.scopes.delete(scopeKey);
    this.drainOrder = this.drainOrder.filter((k) => k !== scopeKey);
    this.drainIndex = 0;
  }

  /** Wake every producer waiting for this scope's queue to drain (W06). */
  private releaseScopeWaiters(st: ScopeState): void {
    if (st.drainWaiters.length === 0) return;
    const waiters = st.drainWaiters;
    st.drainWaiters = [];
    for (const resolve of waiters) resolve();
  }

  private stateFor(scopeKey: string): ScopeState {
    let st = this.scopes.get(scopeKey);
    if (!st) {
      st = {
        queue: [],
        queuedBytes: 0,
        droppedDeltas: 0,
        droppedItems: 0,
        gapFrom: undefined,
        gapTo: 0,
        drainWaiters: [],
      };
      this.scopes.set(scopeKey, st);
    }
    return st;
  }

  /** A gap spans the whole run of losses, so it widens in both directions. */
  private noteGap(st: ScopeState, seq: number): void {
    if (st.gapFrom === undefined || seq < st.gapFrom) st.gapFrom = seq;
    if (seq > st.gapTo) st.gapTo = seq;
  }

  private enqueueItem(scopeKey: string, st: ScopeState, seq: number, frame: string): void {
    const bytes = Buffer.byteLength(frame, 'utf8');
    st.queue.push({ seq, frame });
    st.queuedBytes += bytes;
    this.totalQueuedBytes += bytes;
    if (!this.drainOrder.includes(scopeKey)) this.drainOrder.push(scopeKey);

    // Oldest-first, so what survives is the live edge. The client refills the
    // hole from `replay()`, which is cheaper than holding it here.
    while (st.queue.length > MAX_QUEUED_ITEMS_PER_SCOPE) {
      const dropped = st.queue.shift();
      if (!dropped) break;
      const droppedBytes = Buffer.byteLength(dropped.frame, 'utf8');
      st.queuedBytes -= droppedBytes;
      this.totalQueuedBytes -= droppedBytes;
      st.droppedItems += 1;
      this.noteGap(st, dropped.seq);
    }

    if (this.totalQueuedBytes > MAX_QUEUED_BYTES) {
      this.shed(`connection queue exceeded ${MAX_QUEUED_BYTES} bytes across all scopes`);
    }
  }

  /**
   * The socket drained. Announce every scope's losses, then release queued
   * items round-robin until it fills again.
   *
   * Gaps go first: a client that learns about a hole after the events
   * following it has already rendered them into the hole.
   */
  private onDrain(): void {
    this.congested = false;
    if (this.isClosed) return;

    for (const [scopeKey, st] of this.scopes) {
      if (st.gapFrom === undefined) continue;
      this.writeControl('gap', {
        s: scopeKey,
        fromSeq: st.gapFrom,
        toSeq: st.gapTo,
        droppedDeltas: st.droppedDeltas,
        droppedItems: st.droppedItems,
        reason: 'slow_consumer',
      });
      st.gapFrom = undefined;
    }

    this.flushQueues();
  }

  private flushQueues(): void {
    while (!this.congested && !this.isClosed && this.drainOrder.length > 0) {
      let wrote = false;
      for (let n = 0; n < this.drainOrder.length; n += 1) {
        const key = this.drainOrder[(this.drainIndex + n) % this.drainOrder.length];
        if (key === undefined) continue;
        const st = this.scopes.get(key);
        if (!st || st.queue.length === 0) continue;
        const next = st.queue.shift();
        if (!next) continue;
        const bytes = Buffer.byteLength(next.frame, 'utf8');
        st.queuedBytes -= bytes;
        this.totalQueuedBytes -= bytes;
        this.drainIndex = (this.drainIndex + n + 1) % this.drainOrder.length;
        this.writeRaw(this.frameText(next.frame));
        // Only a queue that reached zero freed real capacity for THIS scope —
        // release its waiters as soon as that happens, not just at the end of
        // the outer loop, which may run many more iterations for siblings.
        if (st.queue.length === 0) this.releaseScopeWaiters(st);
        wrote = true;
        break;
      }
      if (!wrote) break;
    }
  }

  /**
   * `id:` is an opaque per-connection counter. Proxies and stray reconnects
   * want one; it is deliberately NOT the resume key, which is `q` per scope.
   */
  private frameText(frame: string): string {
    this.frameId += 1;
    return `id: ${this.frameId}\ndata: ${frame}\n\n`;
  }

  private writeRaw(payload: string): void {
    try {
      this.congested = !this.res.write(payload);
    } catch {
      this.close();
    }
  }

  private shed(reason: string): void {
    if (this.shedReason !== undefined) return;
    this.shedReason = reason;
    this.coalescer.cancel();
    // Last frame this connection will ever send, written directly: a client
    // that just dies looks like a network fault and is retried forever.
    try {
      this.res.write(
        `event: slow_consumer_dropped\ndata: ${JSON.stringify({ reason })}\n\n`,
      );
    } catch {
      /* best effort — the socket is already in trouble */
    }
    this.close();
    try {
      this.res.end();
    } catch {
      /* best effort */
    }
    this.onShed(reason);
  }
}
