// ────────────────────────────────────────────────────────────────
// SseConnection — W05 + W06, the per-client write path.
//
// Replaces `writeFrame`'s half-wired backpressure with one stated policy.
//
// WHAT WAS WRONG (P0-7). `res.write()`'s return value was checked and then
// discarded: the code incremented a counter, returned `true`, and the producer
// carried on. A `drain` listener existed and fired, and `onDrain` dutifully
// emptied a waiter list that `writeFrame` never pushed to. So the drain half
// worked and the WAIT half was never written. Meanwhile a real shed policy did
// exist further down — past 256 queued frames the client was disconnected — so
// the actual behaviour was *drop the consumer* while the comment promised
// *pause the producer*. One of the two had to change, deliberately.
//
// WHAT IT IS NOW. The event's class decides, which is what W04 exists for:
//
//   DELTA  dropped while the socket is congested, and the loss is announced.
//          A token the client never sees is recoverable — the completed message
//          supersedes it — so dropping is strictly better than stalling every
//          other scope behind a slow reader.
//
//   ITEM   queued, never dropped. Losing a `tool_call` or a `stage_run.*` is a
//          hole a client cannot detect or repair. The queue is bounded, and a
//          consumer that cannot drain even the item lane is disconnected with a
//          reason — that is a real failure, not a slow network.
//
// Loss is always VISIBLE. A dropped run emits one `gap` frame carrying how many
// events went missing, so the client can re-snapshot instead of silently
// rendering a hole. Nothing here drops anything without saying so.
//
// Deltas that are NOT dropped still do not each get their own syscall — see
// `coalescer.ts` for the adaptive window that batches them into one write.
// ────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';

import type { Response } from 'express';

import type { StreamEventRow } from '@generatorai/core';
import { classifyEvent } from '@generatorai/shared';

import { FrameCoalescer } from './coalescer.js';

/**
 * Parse a resume cursor.
 *
 * W08 — the identity a cursor is checked against is the DATABASE's stream space
 * (`repo.streamSpaceId()`), not the process's. `stream_sequences` persists and
 * is never reset, so numbers survive every restart and a cursor minted before
 * one is still valid. An earlier version keyed this on a per-boot id and so
 * discarded every cursor after a restart — silently skipping replay for exactly
 * the outage the mechanism exists to cover. What a mismatch now means is that
 * the numbers genuinely changed underneath the client: a restored backup, a
 * wiped dev database, a different machine behind the same URL.
 *
 * A bare integer is accepted from either source. Because the sequence space is
 * durable, an unqualified cursor is still a correct position in it — it simply
 * carries no evidence about WHICH database produced it. That is the
 * pre-existing behaviour, it is what `?afterSeq=` means for the CLI and `curl`,
 * and it is what every client minted before the space id existed sends once.
 */
export function parseCursor(
  raw: string | undefined,
  spaceId: string,
): {
  afterSeq: number | undefined;
  /** The value named a stream space that is not this database's. */
  foreign: boolean;
  invalid: boolean;
} {
  const none = { afterSeq: undefined, foreign: false, invalid: false };
  if (raw === undefined || raw.length === 0) return none;

  // `String(parsed) !== trimmed` rejects `1.5`, `0x10` and `12abc`, which
  // `parseInt` would otherwise silently truncate into a plausible number.
  const readSeq = (text: string): number | undefined => {
    const trimmed = text.trim();
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || String(parsed) !== trimmed) return undefined;
    return parsed;
  };

  const sep = raw.lastIndexOf(':');
  if (sep === -1) {
    const parsed = readSeq(raw);
    if (parsed === undefined) return { ...none, invalid: true };
    return { afterSeq: parsed, foreign: false, invalid: false };
  }

  const parsed = readSeq(raw.slice(sep + 1));
  if (parsed === undefined) return { ...none, invalid: true };
  if (raw.slice(0, sep) !== spaceId) {
    // Not an error — a restored backup or a fresh dev database is normal.
    return { afterSeq: undefined, foreign: true, invalid: false };
  }
  return { afterSeq: parsed, foreign: false, invalid: false };
}

/**
 * Item frames a congested connection may hold before it is judged unable to
 * keep up (L2 — every queue is bounded, and its overflow behaviour is stated).
 *
 * Items are rare next to deltas, so reaching this means the socket has made no
 * progress for a long time, not that the agent was briefly fast.
 */
const MAX_QUEUED_ITEMS = 256;

/**
 * Bytes of queued item payload before the same judgement is made.
 *
 * A count alone is not a bound: 256 frames of tool output is a different amount
 * of memory from 256 tokens, and it is the memory that kills the process.
 */
const MAX_QUEUED_BYTES = 8 * 1024 * 1024;

export interface SseConnectionStats {
  /** Deltas dropped because the socket was congested. */
  droppedDeltas: number;
  /** Item frames currently waiting for drain. */
  queuedItems: number;
  /** Whether the connection was closed for failing to keep up. */
  shed: boolean;
}

/**
 * Encode-once cache (P1-10).
 *
 * Every subscriber on a scope receives the SAME row object, and each used to
 * run its own `JSON.stringify` of an identical payload — O(K) serialisations
 * for K subscribers. Keyed weakly on the row so it disappears with the event
 * and never becomes a leak of its own.
 */
const frameCache = new WeakMap<StreamEventRow, string>();

export function encodeEventFrame(row: StreamEventRow): string {
  let frame = frameCache.get(row);
  if (frame === undefined) {
    frame = JSON.stringify({ kind: row.kind, payload: row.payload ?? null });
    frameCache.set(row, frame);
  }
  return frame;
}

export class SseConnection {
  private congested = false;
  private closed = false;
  private shedReason: string | undefined;

  /** Items waiting for the socket to drain, oldest first. */
  private queue: Array<{ id: number; frame: string }> = [];
  private queuedBytes = 0;

  private droppedDeltas = 0;
  /** Sequence range covered by the current run of drops, for the gap frame. */
  private gapFrom: number | undefined;
  private gapTo = 0;

  /**
   * W06 — resolved when the item queue fully drains (or the connection dies).
   *
   * This is the half of backpressure that was never written: the queue bounds
   * MEMORY, but nothing previously told the producer to slow down. `deliver()`
   * returns a pending promise for a queued item; `StreamBroker.fanOut` awaits
   * it, and because the per-session emit queue is itself sequential, that
   * wait reaches all the way back to the harness's own read loop.
   */
  private drainWaiters: Array<() => void> = [];

  /** W05 — batches deltas into one `res.write()`. Items bypass the wait. */
  private readonly coalescer = new FrameCoalescer((payload) => this.writeRaw(payload));

  constructor(
    private readonly res: Response,
    private readonly spaceId: string,
    private readonly onShed: (reason: string) => void,
  ) {
    this.res.on('drain', () => this.onDrain());
  }

  get stats(): SseConnectionStats {
    return {
      droppedDeltas: this.droppedDeltas,
      queuedItems: this.queue.length,
      shed: this.shedReason !== undefined,
    };
  }

  /** True once the connection has been shed or the response ended. */
  get isClosed(): boolean {
    return this.closed || this.res.writableEnded;
  }

  /**
   * Deliver one event.
   *
   * Never throws. Deltas are dropped rather than waited on — the whole point
   * of the delta/item split is that a token is disposable. An ITEM that had to
   * be queued instead returns a promise that resolves on drain, which is the
   * producer-side half of W06: the caller (`StreamBroker.fanOut`) awaits it,
   * so a congested client slows the one session it belongs to rather than
   * merely growing an in-memory queue for it.
   */
  deliver(row: StreamEventRow): void | Promise<void> {
    if (this.isClosed) return undefined;

    const frame = encodeEventFrame(row);
    const isDelta = classifyEvent(row.kind, row.payload) === 'delta';

    // The queue check is as important as the congestion check. `res.write()`
    // returns true again as soon as the buffer drops below its high-water mark,
    // but Node only emits 'drain' when it reaches ZERO — so between those two
    // points a write succeeds while items are still queued. Branching on
    // `congested` alone let a later item overtake earlier ones, and the client
    // dedups on seq, so the overtaken ones were then discarded on arrival.
    if (this.congested || this.queue.length > 0) {
      if (isDelta) {
        this.recordDrop(row.seq);
        return undefined;
      }
      this.enqueueItem(row.seq, frame);
      // `enqueueItem` may have just shed the connection (queue/byte ceiling).
      // A waiter registered after that would never be released — nothing is
      // left to wait for, and it must not be the reason a hung promise stalls
      // the session that was trying to disconnect.
      if (this.isClosed) return undefined;
      return new Promise<void>((resolve) => {
        this.drainWaiters.push(resolve);
      });
    }

    const text = this.frameText(row.seq, frame);
    if (isDelta) this.coalescer.defer(text);
    else this.coalescer.flushWith(text);
    return undefined;
  }

  /**
   * Write a raw SSE comment (heartbeat).
   *
   * Sent even while congested, deliberately. A heartbeat exists to stop an idle
   * proxy killing the connection, and congestion is exactly when that matters
   * most; skipping it would let a slow client be disconnected by the very
   * mechanism meant to keep it alive. It is ~30 bytes and never queued.
   */
  writeComment(text: string): void {
    if (this.isClosed) return;
    // Anything buffered goes first, so a heartbeat can never appear ahead of
    // events that were produced before it.
    this.coalescer.flush();
    if (this.isClosed) return;
    try {
      // The return value is ignored on purpose: a comment must not be able to
      // clear `congested`, which only 'drain' may do.
      this.res.write(`: ${text}\n\n`);
    } catch {
      this.close();
    }
  }

  /** Emit a named control frame. Used for `hello` and `gap`. */
  writeControl(event: string, data: unknown): void {
    if (this.isClosed) return;
    // A control frame describes the frames around it, so it must not overtake
    // buffered ones. `gap` is emitted from the drain path where the buffer is
    // always empty; `hello` precedes every delivery. This keeps both true if a
    // third control frame is ever added.
    this.coalescer.flush();
    if (this.isClosed) return;
    try {
      // Same rule as `writeComment`: only the 'drain' handler clears
      // `congested`. Letting a small successful write clear it mid-drain was
      // how items came to overtake the queue.
      this.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      this.close();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.coalescer.cancel();
    this.queue = [];
    this.queuedBytes = 0;
    // A producer waiting on this connection to drain must be released now —
    // there is no future drain event coming to do it, and a dangling waiter
    // is a hung promise on whatever awaited `deliver()` (W06).
    this.releaseDrainWaiters();
  }

  /** Wake every producer waiting for queue capacity. See `deliver()` (W06). */
  private releaseDrainWaiters(): void {
    if (this.drainWaiters.length === 0) return;
    const waiters = this.drainWaiters;
    this.drainWaiters = [];
    for (const resolve of waiters) resolve();
  }

  /**
   * `id:` carries the database's stream space as well as the position, so a
   * cursor is only honoured against the numbers it was actually minted from.
   * The browser returns it via `Last-Event-ID` with no client code.
   */
  private frameText(id: number, frame: string): string {
    return `id: ${this.spaceId}:${id}\ndata: ${frame}\n\n`;
  }

  private writeRaw(payload: string): void {
    try {
      this.congested = !this.res.write(payload);
    } catch {
      this.close();
    }
  }

  private recordDrop(seq: number): void {
    this.droppedDeltas += 1;
    if (this.gapFrom === undefined) this.gapFrom = seq;
    this.gapTo = seq;
  }

  private enqueueItem(id: number, frame: string): void {
    this.queue.push({ id, frame });
    // `Buffer.byteLength`, not `.length`: the latter counts UTF-16 units, which
    // under-counts non-ASCII payloads by up to 3x. It is the bytes that
    // exhaust memory, so it is the bytes that must be bounded.
    this.queuedBytes += Buffer.byteLength(frame, 'utf8');

    if (this.queue.length > MAX_QUEUED_ITEMS) {
      this.shed(`item queue exceeded ${MAX_QUEUED_ITEMS} frames`);
      return;
    }
    if (this.queuedBytes > MAX_QUEUED_BYTES) {
      this.shed(`item queue exceeded ${MAX_QUEUED_BYTES} bytes`);
    }
  }

  /**
   * The socket drained. Announce anything lost, then release queued items until
   * it fills again.
   *
   * The gap frame goes FIRST: a client that learns about the hole after the
   * events following it has already rendered them into the hole.
   */
  private onDrain(): void {
    this.congested = false;
    if (this.isClosed) return;

    if (this.gapFrom !== undefined) {
      this.writeControl('gap', {
        fromSeq: this.gapFrom,
        toSeq: this.gapTo,
        dropped: this.droppedDeltas,
        reason: 'slow_consumer',
      });
      this.gapFrom = undefined;
    }

    // Deliberately one write per frame rather than one per drain: writing the
    // whole backlog at once would move up to `MAX_QUEUED_BYTES` straight into
    // Node's own buffer, where nothing bounds it. Writing singly puts at most
    // one frame past the socket's capacity, and syscall count is not what is
    // scarce on a connection that is already congested.
    while (this.queue.length > 0 && !this.congested && !this.isClosed) {
      const next = this.queue.shift();
      if (!next) break;
      this.queuedBytes -= Buffer.byteLength(next.frame, 'utf8');
      this.writeRaw(this.frameText(next.id, next.frame));
    }
    // Only a queue that reached zero freed real capacity. If the loop instead
    // stopped because a write re-congested the socket, every waiter is still
    // legitimately waiting.
    if (this.queue.length === 0) this.releaseDrainWaiters();
  }

  private shed(reason: string): void {
    if (this.shedReason !== undefined) return;
    this.shedReason = reason;
    this.coalescer.cancel();
    // Written directly rather than through `writeControl`: this is the last
    // frame this connection will ever send, so there is nothing left for a
    // congestion decision to protect, and a client that just dies looks like a
    // network fault and gets retried forever.
    try {
      this.res.write(
        `event: slow_consumer_dropped\ndata: ${JSON.stringify({
          reason,
          droppedDeltas: this.droppedDeltas,
        })}\n\n`,
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
