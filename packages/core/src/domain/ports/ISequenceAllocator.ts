// ────────────────────────────────────────────────────────────────
// ISequenceAllocator — atomic per-session event sequence allocation
// ────────────────────────────────────────────────────────────────

/**
 * Allocates monotonic, unique `sequence_id` values for events within a
 * given session. Implementations must be safe under concurrent callers
 * (including across OS processes writing to the same DB).
 *
 * The previous in-memory counter inside `EventRepository` was not
 * cross-process safe: two processes could each read `max=N`, increment
 * locally, and try to insert `N+1` — violating the UNIQUE (session_id,
 * sequence_id) constraint. SQL `UPDATE … SET n = n+1 … RETURNING`
 * resolves the race without extra locking.
 */
export interface ISequenceAllocator {
  /**
   * Allocate and reserve the next sequence ID for `sessionId`.
   * Always returns a value distinct from all prior calls for the same
   * session across any process.
   */
  allocate(sessionId: string): Promise<number>;
}
