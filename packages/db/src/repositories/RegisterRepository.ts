// ────────────────────────────────────────────────────────────────
// RegisterRepository — durable program-counter store (W47 / W22)
//
// Registers are the "durable program counter" for the W22
// DurableExecutionEngine. After every step, one register keyed by
// `op.state/{operationId}` is overwritten (CAS) with the complete
// current state so recovery reads it and switches without inferring
// position from what is missing.
//
// Design decisions:
//   - Synchronous SQLite primitives for the CAS path — async Drizzle ORM
//     cannot guarantee the read-then-write is atomic in one WAL transaction
//     on the same connection; SQLite's `UPDATE ... RETURNING` is. We use
//     better-sqlite3's synchronous API directly for CAS, and Drizzle for
//     plain reads and writes where atomicity is not required.
//   - Single writer per (scope, scope_id, key). The engine enforces this
//     above the repository; the `version` column is a monotone generation
//     counter, not an MVCC timestamp.
//   - Reads never throw — a missing register returns undefined so callers
//     can distinguish "not yet written" from "written as null".
// ────────────────────────────────────────────────────────────────

import type Database from 'better-sqlite3';
import { StorageError } from '@generatorai/shared';
import type { AppDatabase } from '../index.js';

// ── Types ──────────────────────────────────────────────────────

export interface RegisterEntry {
  scope: string;
  scopeId: string;
  key: string;
  /** Parsed value (the repository round-trips via JSON). */
  value: unknown;
  /** Monotone generation counter; starts at 0. */
  version: number;
  writtenAt: number;
}

/** Raw row as stored in SQLite. */
interface RegisterRow {
  scope: string;
  scope_id: string;
  key: string;
  value: string;
  version: number;
  written_at: number;
}

// ── Helpers ────────────────────────────────────────────────────

/** Extract the raw SQLite connection from the Drizzle wrapper. */
function rawClient(db: AppDatabase): Database.Database {
  return (db as unknown as { session: { client: Database.Database } }).session.client;
}

function mapRow(row: RegisterRow): RegisterEntry {
  return {
    scope: row.scope,
    scopeId: row.scope_id,
    key: row.key,
    value: JSON.parse(row.value) as unknown,
    version: row.version,
    writtenAt: row.written_at,
  };
}

// ── Repository ─────────────────────────────────────────────────

export class RegisterRepository {
  constructor(private readonly db: AppDatabase) {}

  // ── Read ──────────────────────────────────────────────────────

  /**
   * Get a single register entry, or `undefined` if it has never been written.
   */
  get(scope: string, scopeId: string, key: string): RegisterEntry | undefined {
    const client = rawClient(this.db);
    const row = client
      .prepare(
        `SELECT scope, scope_id, key, value, version, written_at
           FROM registers WHERE scope = ? AND scope_id = ? AND key = ?`,
      )
      .get(scope, scopeId, key) as RegisterRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  /**
   * List all registers for a scope (used during recovery to restore full
   * operation state without knowing individual keys up front).
   */
  listByScope(scope: string, scopeId: string): RegisterEntry[] {
    const client = rawClient(this.db);
    const rows = client
      .prepare(
        `SELECT scope, scope_id, key, value, version, written_at
           FROM registers WHERE scope = ? AND scope_id = ? ORDER BY key`,
      )
      .all(scope, scopeId) as RegisterRow[];
    return rows.map(mapRow);
  }

  // ── Write ─────────────────────────────────────────────────────

  /**
   * Unconditional upsert — increments `version` on conflict so the CAS
   * pattern can track generations even when the caller does a blind write.
   *
   * Use this for the initial write of a new register, or for cases where the
   * caller is the sole writer and does not need optimistic concurrency.
   */
  set(scope: string, scopeId: string, key: string, value: unknown): RegisterEntry {
    const client = rawClient(this.db);
    const now = Date.now();
    const serialized = JSON.stringify(value);

    const row = client
      .prepare(
        `INSERT INTO registers (scope, scope_id, key, value, version, written_at)
           VALUES (?, ?, ?, ?, 0, ?)
           ON CONFLICT (scope, scope_id, key) DO UPDATE SET
             value      = excluded.value,
             version    = version + 1,
             written_at = excluded.written_at
           RETURNING scope, scope_id, key, value, version, written_at`,
      )
      .get(scope, scopeId, key, serialized, now) as RegisterRow | undefined;

    if (!row) {
      throw new StorageError(`register.set: RETURNING produced no row for ${scope}/${scopeId}/${key}`);
    }
    return mapRow(row);
  }

  /**
   * Compare-and-swap (CAS) — atomically update the register only if the
   * current `version` matches `expectedVersion`.
   *
   * Returns the updated entry on success, `null` on version mismatch (the
   * caller should re-read and retry or treat this as a conflict).
   *
   * This is the synchronous, single-statement path — no separate read is
   * needed; SQLite's UPDATE is atomic in WAL mode.
   */
  cas(
    scope: string,
    scopeId: string,
    key: string,
    expectedVersion: number,
    newValue: unknown,
  ): RegisterEntry | null {
    const client = rawClient(this.db);
    const now = Date.now();
    const serialized = JSON.stringify(newValue);

    const row = client
      .prepare(
        `UPDATE registers
            SET value = ?, version = version + 1, written_at = ?
          WHERE scope = ? AND scope_id = ? AND key = ? AND version = ?
          RETURNING scope, scope_id, key, value, version, written_at`,
      )
      .get(serialized, now, scope, scopeId, key, expectedVersion) as RegisterRow | undefined;

    return row ? mapRow(row) : null;
  }

  /**
   * Delete all registers for a scope — called during workspace teardown so
   * orphaned state does not accumulate.
   */
  deleteByScope(scope: string, scopeId: string): void {
    const client = rawClient(this.db);
    client
      .prepare(`DELETE FROM registers WHERE scope = ? AND scope_id = ?`)
      .run(scope, scopeId);
  }
}
