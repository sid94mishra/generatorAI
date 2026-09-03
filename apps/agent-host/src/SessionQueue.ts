/**
 * W12 — Bounded per-session frame queue.
 *
 * L2: Every queue is bounded, and its overflow behaviour is stated in code.
 * Overflow: drop the oldest entry and remember how many were dropped, so the
 * NEXT entry handed to the writer carries a `droppedBefore` count.
 *
 * △ The gap marker used to be a fabricated `{kind:'harness.gap'}` object cast
 * through `as unknown as AgentEvent`. That kind does not exist in
 * `AgentEvent.ts`, so any consumer switching exhaustively over event kinds
 * would fall through on it. A dropped-events notice is a property of this
 * transport, not something a provider emitted, so it now travels as metadata
 * on the IPC notification (`AgentEventNotification.droppedBefore`) and the
 * domain event union is left alone.
 */

import type { AgentEvent } from '@generatorai/shared';

/**
 * What the demux carries. Terminal notifications ride the SAME per-session
 * queue as events: sending `session_ended` on a side channel would let it
 * overtake the tokens still queued behind it, and the gateway would see a turn
 * end before its own last token.
 */
export type SessionFrame =
  | { kind: 'event'; event: AgentEvent }
  | { kind: 'ended'; reason: 'complete' | 'error' | 'cancelled'; error?: string };

export interface SessionQueueEntry {
  frame: SessionFrame;
  /**
   * Per-session monotonic sequence number. Assigned at push time and never
   * reused, so a consumer that sees seq jump knows frames were lost even if
   * the `droppedBefore` marker itself were somehow missed.
   */
  seq: number;
  /**
   * How many frames were dropped from the head of this queue between the
   * previously-shifted entry and this one. 0 in the normal case.
   */
  droppedBefore: number;
}

export class SessionQueue {
  /* W12 */ static readonly MAX_SIZE = 128;

  private readonly _entries: SessionQueueEntry[] = [];
  private _droppedCount = 0;
  /** Drops not yet reported to the writer — attached to the next shifted entry. */
  private _pendingGap = 0;
  private _nextSeq = 1;

  constructor(private readonly maxSize: number = SessionQueue.MAX_SIZE) {}

  /**
   * Enqueue a frame. When the queue is at capacity the OLDEST entry is
   * dropped, because in a live stream the newest tokens are the ones the user
   * is waiting on; a stale token from 128 frames ago has no consumer. Dropping
   * from the head also guarantees a terminal frame — always the newest at the
   * moment it is pushed — is never the one discarded.
   *
   * Length is exactly `maxSize` after any overflow push: the drop and the push
   * cancel out, so the queue cannot grow.
   */
  push(frame: SessionFrame): void {
    if (this._entries.length >= this.maxSize) {
      this._entries.shift();
      this._droppedCount++;
      this._pendingGap++;
    }
    this._entries.push({ frame, seq: this._nextSeq++, droppedBefore: 0 });
  }

  /**
   * Dequeue the next entry, stamping it with any drops that happened since the
   * previous shift. Returns undefined if empty.
   */
  shift(): SessionQueueEntry | undefined {
    const entry = this._entries.shift();
    if (!entry) return undefined;
    if (this._pendingGap > 0) {
      // `+=`, not `=`: a re-queued entry (see `unshift`) already carries the
      // drops it was stamped with the first time it was shifted, and losing
      // them would under-report the gap to the gateway.
      entry.droppedBefore += this._pendingGap;
      this._pendingGap = 0;
    }
    return entry;
  }

  /**
   * Put an already-shifted entry back at the head, keeping its seq and its
   * `droppedBefore` stamp.
   *
   * The writer calls this when a frame it took off the queue was NOT delivered
   * — a `process.send()` that threw, or one whose flush callback reported an
   * error. Without it the entry is simply gone: the frame never reached the
   * gateway and never will, and if it happened to be the turn's terminal frame
   * the turn hangs forever with nothing logged (BLOCKER B1).
   *
   * Only ever called immediately after a `shift()` on the same queue, so there
   * is room; the guard exists so a future caller cannot grow the queue past its
   * bound. When the queue really is full the newly-arrived tail is dropped
   * rather than this entry, because this one is older and the consumer is
   * already waiting on it.
   */
  unshift(entry: SessionQueueEntry): void {
    while (this._entries.length >= this.maxSize && this._entries.length > 0) {
      this._entries.pop();
      this._droppedCount++;
      this._pendingGap++;
    }
    this._entries.unshift(entry);
  }

  /** Drain all entries and return them, gap markers applied. */
  drain(): SessionQueueEntry[] {
    const out: SessionQueueEntry[] = [];
    for (;;) {
      const entry = this.shift();
      if (!entry) break;
      out.push(entry);
    }
    return out;
  }

  get size(): number {
    return this._entries.length;
  }

  get droppedCount(): number {
    return this._droppedCount;
  }

  isEmpty(): boolean {
    return this._entries.length === 0;
  }
}
