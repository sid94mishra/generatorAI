// ────────────────────────────────────────────────────────────────
// DrizzleIdempotencyKeyRepository — Track A idempotency-key storage
//   Used by automation trigger and webhook endpoints to dedup
//   requests within a short TTL window.
// ────────────────────────────────────────────────────────────────

import { and, eq, lt } from 'drizzle-orm';
import { StorageError } from '@generatorai/shared';
import { idempotencyKeys } from '../schema.js';
import type { AppDatabase } from '../index.js';

export interface IdempotencyKeyRecord {
  key: string;
  scope: string;
  executionId: string;
  createdAt: Date;
  expiresAt: Date;
}

export class DrizzleIdempotencyKeyRepository {
  constructor(private db: AppDatabase) {}

  /**
   * Attempt to persist a fresh (key, scope) mapping.
   *
   * On conflict returns the previously-stored `executionId` and does not
   * overwrite. Callers should treat a non-null return as a replay hit.
   *
   * Callers should first invoke {@link sweepExpired} (or call the periodic
   * sweeper) so stale entries don't block fresh writes.
   */
  async claim(record: IdempotencyKeyRecord): Promise<{ executionId: string; replay: boolean }> {
    try {
      // Best-effort: opportunistically remove the same (key, scope) if it
      // is already expired. `INSERT OR IGNORE` alone can't distinguish
      // expired from active, so we do the check-and-delete pass first.
      await this.db
        .delete(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.key, record.key),
            eq(idempotencyKeys.scope, record.scope),
            lt(idempotencyKeys.expiresAt, new Date()),
          ),
        );

      await this.db.insert(idempotencyKeys).values({
        key: record.key,
        scope: record.scope,
        executionId: record.executionId,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
      });
      return { executionId: record.executionId, replay: false };
    } catch (err) {
      // Uniqueness violation → replay hit. Fetch the stored executionId.
      const existing = await this.db
        .select()
        .from(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.key, record.key),
            eq(idempotencyKeys.scope, record.scope),
          ),
        )
        .limit(1);
      const row = existing[0];
      if (row) {
        return { executionId: row.executionId, replay: true };
      }
      // No row on read either — genuine storage failure.
      throw new StorageError(
        `Failed to claim idempotency key: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  /**
   * Rewrite the stored `executionId` for an existing (key, scope) row.
   * Used by the trigger routes to swap the placeholder id populated
   * during the initial claim for the real execution id once the caller
   * has produced one. No-op if the row is gone (expired between claim
   * and finalize).
   */
  async updateExecutionId(key: string, scope: string, executionId: string): Promise<void> {
    await this.db
      .update(idempotencyKeys)
      .set({ executionId })
      .where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.scope, scope)));
  }

  /** Remove all keys past their expiry across all scopes. */
  async sweepExpired(): Promise<number> {
    const rows = await this.db
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.expiresAt, new Date()))
      .returning({ key: idempotencyKeys.key });
    return rows.length;
  }
}
