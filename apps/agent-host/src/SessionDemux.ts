/**
 * W12 — Single-reader demux routing AgentEvents by sessionId.
 *
 * Every provider event produced anywhere in the host converges on ONE resource:
 * the single IPC channel back to the gateway. `process.send()` serialises and
 * writes synchronously, so if session A's 4 MB tool result is written straight
 * through, session B's next token waits behind all 4 MB of it. That is the
 * head-of-line blocking W12 exists to remove.
 *
 * The demux breaks the coupling: `dispatch()` only ENQUEUES, into a bounded
 * per-session queue. A single writer then drains the queues round-robin, one
 * entry per session per round, and stops the moment the channel signals
 * backpressure. A session that produces huge frames therefore occupies one
 * slot per round, not the whole channel.
 *
 * L2: Per-session queues are bounded (see SessionQueue.MAX_SIZE). Overflow
 * drops the oldest event and reports the loss on the next delivered entry.
 */

import { SessionQueue, type SessionFrame, type SessionQueueEntry } from './SessionQueue.js';

/**
 * Writer callback. Returns `true` to keep draining, `false` to stop this pass
 * because the transport is backpressured (`process.send()` returned false).
 * The caller resumes by invoking `drainTo` again once the channel flushes.
 */
export type SessionEventSink = (sessionId: string, entry: SessionQueueEntry) => boolean;

export class SessionDemux {
  /* W12 */ private readonly queues = new Map<string, SessionQueue>();
  /**
   * Round-robin cursor. `Map` preserves insertion order, so remembering the
   * last session we served and resuming AFTER it gives every session a turn
   * before any session gets a second one — the fairness property W12's
   * acceptance criterion measures.
   */
  private cursor = 0;

  constructor(private readonly maxQueueSize: number = SessionQueue.MAX_SIZE) {}

  /** Enqueue a frame for a session. Never writes to the transport itself. */
  dispatch(sessionId: string, frame: SessionFrame): void {
    this.getOrCreateQueue(sessionId).push(frame);
  }

  /**
   * Drain queues round-robin into `sink`, at most one entry per session per
   * round. Stops when every queue is empty or the sink returns false.
   *
   * Returns true if everything drained, false if the sink asked us to stop
   * (i.e. there is still work pending).
   */
  drainTo(sink: SessionEventSink): boolean {
    for (;;) {
      const sessionIds = [...this.queues.keys()];
      if (sessionIds.length === 0) return true;

      // Snapshot the cursor for the whole round: advancing it inside the loop
      // AND reading it as the round's base would skip sessions.
      const roundStart = this.cursor;
      let wroteThisRound = false;
      for (let i = 0; i < sessionIds.length; i++) {
        const idx = (roundStart + i) % sessionIds.length;
        const sessionId = sessionIds[idx]!;
        const queue = this.queues.get(sessionId);
        const entry = queue?.shift();
        if (!entry) continue;

        wroteThisRound = true;
        // Advance the cursor BEFORE the write so a sink that throws or
        // backpressures cannot make us re-serve the same session first.
        this.cursor = (idx + 1) % sessionIds.length;

        if (!sink(sessionId, entry)) return false;
      }

      if (!wroteThisRound) return true;
    }
  }

  /**
   * Hand an entry back after a FAILED write. It goes to the head of its
   * session's queue with its seq and gap stamp intact, so the next pass
   * re-delivers it in order.
   *
   * `drainTo` removes an entry before handing it to the sink, so a sink that
   * could not deliver has to give it back or the frame is lost outright — the
   * silent-hang half of BLOCKER B1 when that frame is a `session_ended`.
   * Backpressure (`process.send` returning false) is NOT a failure: the channel
   * accepted the frame, so it must not be requeued.
   *
   * Returns false when the session was torn down while the write was in
   * flight; its queue is gone on purpose and re-creating it here would leak one
   * per dead session.
   */
  requeue(sessionId: string, entry: SessionQueueEntry): boolean {
    const queue = this.queues.get(sessionId);
    if (!queue) return false;
    queue.unshift(entry);
    return true;
  }

  /** True when at least one session has a queued event awaiting the writer. */
  hasPending(): boolean {
    for (const q of this.queues.values()) {
      if (!q.isEmpty()) return true;
    }
    return false;
  }

  /** Remove all state for a session. Called on session teardown. */
  remove(sessionId: string): void {
    this.queues.delete(sessionId);
  }

  private getOrCreateQueue(sessionId: string): SessionQueue {
    let q = this.queues.get(sessionId);
    if (!q) {
      q = new SessionQueue(this.maxQueueSize);
      this.queues.set(sessionId, q);
    }
    return q;
  }

  /** Stats for the host's `get_stats` response and health reporting (W18). */
  stats(): { sessions: number; queuedFrames: number; droppedFrames: number } {
    let queuedFrames = 0;
    let droppedFrames = 0;
    for (const q of this.queues.values()) {
      queuedFrames += q.size;
      droppedFrames += q.droppedCount;
    }
    return { sessions: this.queues.size, queuedFrames, droppedFrames };
  }
}
