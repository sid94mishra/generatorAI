// ────────────────────────────────────────────────────────────────
// DrizzleSequenceAllocator — cross-process-safe sequence allocation
// via SQLite's `UPDATE ... RETURNING`.
// ────────────────────────────────────────────────────────────────

import { eq, sql } from 'drizzle-orm';
import type { ISequenceAllocator } from '@generatorai/core';
import { eventSequences } from '../schema.js';
import type { AppDatabase } from '../index.js';

/** Bound retries on INSERT race. 3 is far more than needed in practice
 *  (a single retry always wins once the row exists). */
const MAX_ALLOCATE_RETRIES = 3;

/** Detect a SQLite PRIMARY KEY / UNIQUE constraint error. The message
 *  varies slightly across better-sqlite3 versions but always contains these. */
function isUniqueConstraintError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('UNIQUE constraint failed') ||
    msg.includes('PRIMARY KEY constraint')
  );
}

export class DrizzleSequenceAllocator implements ISequenceAllocator {
  constructor(private db: AppDatabase) {}

  async allocate(sessionId: string): Promise<number> {
    return this.allocateWithRetries(sessionId, 0);
  }

  private async allocateWithRetries(
    sessionId: string,
    attempt: number,
  ): Promise<number> {
    // 1. Try to bump the counter atomically. `RETURNING` gives us the
    //    post-increment value; `next_sequence - 1` is the value we reserved
    //    (the counter always stores the NEXT id to hand out, starting at 1).
    const updated = await this.db
      .update(eventSequences)
      .set({ nextSequence: sql`${eventSequences.nextSequence} + 1` })
      .where(eq(eventSequences.sessionId, sessionId))
      .returning({ next: eventSequences.nextSequence });

    if (updated.length > 0 && updated[0]) {
      return updated[0].next - 1;
    }

    // 2. Row didn't exist — insert with next_sequence=2 (we reserve seq=1).
    //    Concurrent callers will race; the UNIQUE violation is handled by
    //    looping back to the UPDATE path, not by unbounded recursion.
    try {
      await this.db.insert(eventSequences).values({ sessionId, nextSequence: 2 });
      return 1;
    } catch (err) {
      if (!isUniqueConstraintError(err)) {
        // Not a race — surface the real error (I/O, disk full, etc.) instead
        // of hiding it behind an infinite retry loop.
        throw err;
      }
      if (attempt + 1 >= MAX_ALLOCATE_RETRIES) {
        throw new Error(
          `DrizzleSequenceAllocator: exceeded ${MAX_ALLOCATE_RETRIES} retries ` +
          `allocating sequence for session '${sessionId}' (unexpected contention).`,
        );
      }
      return this.allocateWithRetries(sessionId, attempt + 1);
    }
  }
}
