/**
 * W12 — Single-reader demux routing AgentEvents by sessionId.
 *
 * The agent host owns one provider runtime's output stream. This demux routes
 * frames from that single stream into per-session queues. Each session's
 * consumer drains its own queue independently.
 *
 * L2: Per-session queues are bounded (see SessionQueue.MAX_SIZE).
 */

import type { AgentEvent } from '@generatorai/shared';
import { SessionQueue } from './SessionQueue.js';

export type SessionEventHandler = (event: AgentEvent) => void;

export class SessionDemux {
  /* W12 */ private readonly queues = new Map<string, SessionQueue>();
  private readonly handlers = new Map<string, SessionEventHandler>();

  /**
   * Route an event to the session's registered handler (or buffer it in the
   * session queue if no handler is registered yet).
   */
  dispatch(sessionId: string, event: AgentEvent): void {
    const handler = this.handlers.get(sessionId);
    if (handler) {
      try {
        handler(event);
      } catch {
        // EVT-02: per-handler error isolation — a broken subscriber cannot
        // stall other sessions
      }
      return;
    }
    // No handler yet — buffer in the per-session queue
    this.getOrCreateQueue(sessionId).push(event);
  }

  /**
   * Register a handler for a session. Drains any buffered events immediately.
   * Returns a deregister function.
   */
  subscribe(sessionId: string, handler: SessionEventHandler): () => void {
    this.handlers.set(sessionId, handler);
    // Drain buffered events
    const queue = this.queues.get(sessionId);
    if (queue) {
      for (const entry of queue.drain()) {
        try {
          handler(entry.event);
        } catch {
          // isolated
        }
      }
      this.queues.delete(sessionId);
    }
    return () => {
      if (this.handlers.get(sessionId) === handler) {
        this.handlers.delete(sessionId);
      }
    };
  }

  /** Remove all state for a session. Called on session teardown. */
  remove(sessionId: string): void {
    this.handlers.delete(sessionId);
    this.queues.delete(sessionId);
  }

  private getOrCreateQueue(sessionId: string): SessionQueue {
    let q = this.queues.get(sessionId);
    if (!q) {
      q = new SessionQueue();
      this.queues.set(sessionId, q);
    }
    return q;
  }

  /** Stats for health endpoint (W18). */
  stats(): { sessions: number; bufferedSessions: number } {
    return {
      sessions: this.handlers.size,
      bufferedSessions: this.queues.size,
    };
  }
}
