/**
 * W12 — Bounded per-session event queue.
 *
 * L2: Every queue is bounded, and its overflow behaviour is stated in code.
 * Overflow: drop the oldest entry and prepend a `gap` marker so consumers
 * know they missed events.
 */

import type { AgentEvent } from '@generatorai/shared';

/** Base shape for a gap marker — a fresh copy is created on each overflow. */
const GAP_MARKER_BASE = {
  kind: 'harness.gap' as const,
  data: { reason: 'queue_overflow' },
} as const;

/** Create a fresh gap marker event. Never share a singleton to avoid mutation. */
function makeGapMarker(): AgentEvent {
  return { ...GAP_MARKER_BASE, timestamp: new Date().toISOString() } as unknown as AgentEvent;
}

export interface SessionQueueEntry {
  event: AgentEvent;
  /** Whether this entry is a gap marker (the real event was dropped). */
  isGap: boolean;
}

export class SessionQueue {
  /* W12 */ static readonly MAX_SIZE = 128;

  private readonly _entries: SessionQueueEntry[] = [];
  private _droppedCount = 0;

  /**
   * Enqueue an event. When the queue is at capacity:
   *  - Drop the oldest entry (shift).
   *  - If the current head is not already a gap marker, also shift one more
   *    and prepend a fresh gap marker. This keeps length ≤ MAX_SIZE after push.
   *
   * Without the extra shift the pattern would be: shift (−1), unshift (+1),
   * push (+1) = net +1, growing the queue without bound on every overflow.
   */
  push(event: AgentEvent): void {
    if (this._entries.length >= SessionQueue.MAX_SIZE) {
      this._entries.shift(); // drop oldest → length = MAX_SIZE - 1
      this._droppedCount++;
      if (!this._entries[0]?.isGap) {
        // Make room for the gap marker without exceeding MAX_SIZE after push
        this._entries.shift(); // drop next-oldest → length = MAX_SIZE - 2
        this._entries.unshift({ event: makeGapMarker(), isGap: true }); // gap → MAX_SIZE - 1
      }
      // fall through: push → MAX_SIZE
    }
    this._entries.push({ event, isGap: false });
  }

  /** Dequeue and return the next entry, or undefined if empty. */
  shift(): SessionQueueEntry | undefined {
    return this._entries.shift();
  }

  /** Drain all entries and return them. */
  drain(): SessionQueueEntry[] {
    return this._entries.splice(0, this._entries.length);
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
