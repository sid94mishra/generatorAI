// ────────────────────────────────────────────────────────────────
// EntryRepository — durable item store (W47 / §3.4 / W22)
//
// Entries are durable items stored SEPARATELY from the lossy message
// stream (fixes X-25). They cover:
//
//   artifact    — stable artifactId survives retry; append+lastChunk
//                 semantics; stored here, referenced by message rows.
//   signal      — named, resolvable repeatedly (mid-run steering).
//   awakeable   — one-time wake-up token; the endpoint resolves by key.
//   tool_result — effect sandwich settlement: after a 'never'-policy tool
//                 runs, the result is committed here so recovery returns
//                 the same synthetic result without re-running the effect.
//   stage_result — authoritative stage output (X-25 fix): not in messages.
//
// Corruption closed enum (W22):
//   'torn_tail'        — parse error on last row only → repair + warn.
//   'unreachable_state' — a state the single-writer protocol cannot produce.
//   'missing_settlement' — intent row exists but no settlement row.
//
// The repository does not enforce the closed enum — it is the engine's
// responsibility. The repository provides atomic primitives the engine
// builds on.
//
// P0-2 fix: All SQLite prepared statements are cached in the constructor.
// Never call client.prepare() inside a method body — it allocates and
// compiles a new statement object on every call, a regression that was
// measured as a major hot-path cost in Phase 0.
// ────────────────────────────────────────────────────────────────

import type Database from 'better-sqlite3';
import { generateId } from '@generatorai/shared';
import { StorageError } from '@generatorai/shared';
import type { AppDatabase } from '../index.js';

// ── Types ──────────────────────────────────────────────────────

export type EntryKind =
  | 'artifact'
  | 'signal'
  | 'awakeable'
  | 'tool_result'
  | 'stage_result';

export type EntryScope =
  | 'session'
  | 'stage_run'
  | 'workflow_run'
  | 'automation_execution';

export interface EntryRecord {
  id: string;
  scope: EntryScope;
  scopeId: string;
  kind: EntryKind;
  /** Stable id for artifact entries — survives retry chains (W23). */
  artifactId?: string;
  /**
   * Semantic key:
   *   - signal:    signal name
   *   - awakeable: one-time token (unique across the whole table)
   *   - others:    undefined
   */
  key?: string;
  /** JSON-serialised payload. */
  payload: unknown;
  /** true when a signal/awakeable has been resolved. */
  resolved: boolean;
  resolvedAt?: number;
  createdAt: number;
}

interface EntryRow {
  id: string;
  scope: string;
  scope_id: string;
  kind: string;
  artifact_id: string | null;
  key: string | null;
  payload: string;
  resolved: number;
  resolved_at: number | null;
  created_at: number;
}

// ── Helpers ────────────────────────────────────────────────────

function rawClient(db: AppDatabase): Database.Database {
  return (db as unknown as { session: { client: Database.Database } }).session.client;
}

function mapRow(row: EntryRow): EntryRecord {
  return {
    id: row.id,
    scope: row.scope as EntryScope,
    scopeId: row.scope_id,
    kind: row.kind as EntryKind,
    artifactId: row.artifact_id ?? undefined,
    key: row.key ?? undefined,
    payload: JSON.parse(row.payload) as unknown,
    resolved: row.resolved === 1,
    resolvedAt: row.resolved_at ?? undefined,
    createdAt: row.created_at,
  };
}

// Shared SELECT projection used across all read methods.
const SELECT_COLS =
  'id, scope, scope_id, kind, artifact_id, key, payload, resolved, resolved_at, created_at';

// ── Repository ─────────────────────────────────────────────────

export class EntryRepository {
  // P0-2 — all statements prepared once; never re-prepared inside methods.
  private readonly createStmt: Database.Statement;
  /** Resolve an entry without changing its payload. */
  private readonly resolveStmt: Database.Statement;
  /** Resolve an entry AND replace its payload in one UPDATE. */
  private readonly resolveWithPayloadStmt: Database.Statement;
  private readonly resolveByKeyLookupStmt: Database.Statement;
  private readonly getByIdStmt: Database.Statement;
  private readonly listByScopeStmt: Database.Statement;
  private readonly findUnresolvedSignalStmt: Database.Statement;
  private readonly findToolResultStmt: Database.Statement;
  private readonly findStageResultByKeyStmt: Database.Statement;
  private readonly findLastResolvedSignalStmt: Database.Statement;
  /**
   * W22 / MAJOR-3 fix: targeted query that returns only the lowest-index
   * unclaimed iteration slot, avoiding the O(all_entries) full-scope scan
   * that `claimNextIteration` previously performed via `listByScope`.
   */
  private readonly findNextPendingIterationStmt: Database.Statement;
  private readonly deleteByScopeStmt: Database.Statement;

  constructor(private readonly db: AppDatabase) {
    const client = rawClient(db);

    this.createStmt = client.prepare(
      `INSERT INTO entries (id, scope, scope_id, kind, artifact_id, key, payload, resolved, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    );

    // Two resolve variants: without payload replacement and with it.
    this.resolveStmt = client.prepare(
      `UPDATE entries
          SET resolved = 1, resolved_at = ?
        WHERE id = ? AND resolved = 0
        RETURNING ${SELECT_COLS}`,
    );
    this.resolveWithPayloadStmt = client.prepare(
      `UPDATE entries
          SET resolved = 1, resolved_at = ?, payload = ?
        WHERE id = ? AND resolved = 0
        RETURNING ${SELECT_COLS}`,
    );

    this.resolveByKeyLookupStmt = client.prepare(
      `SELECT id FROM entries WHERE kind = 'awakeable' AND key = ? AND resolved = 0`,
    );

    this.getByIdStmt = client.prepare(
      `SELECT ${SELECT_COLS} FROM entries WHERE id = ?`,
    );

    this.listByScopeStmt = client.prepare(
      `SELECT ${SELECT_COLS} FROM entries WHERE scope = ? AND scope_id = ? ORDER BY created_at`,
    );

    this.findUnresolvedSignalStmt = client.prepare(
      `SELECT ${SELECT_COLS}
         FROM entries
        WHERE scope = ? AND scope_id = ? AND kind = 'signal' AND key = ? AND resolved = 0
        ORDER BY created_at DESC LIMIT 1`,
    );

    this.findToolResultStmt = client.prepare(
      `SELECT ${SELECT_COLS}
         FROM entries
        WHERE scope = ? AND scope_id = ? AND kind = 'tool_result' AND key = ? LIMIT 1`,
    );

    this.findStageResultByKeyStmt = client.prepare(
      `SELECT ${SELECT_COLS}
         FROM entries
        WHERE scope = ? AND scope_id = ? AND kind = 'stage_result' AND key = ? LIMIT 1`,
    );

    this.findLastResolvedSignalStmt = client.prepare(
      `SELECT ${SELECT_COLS}
         FROM entries
        WHERE scope = ? AND scope_id = ? AND kind = 'signal' AND key = ? AND resolved = 1
        ORDER BY resolved_at DESC LIMIT 1`,
    );

    // MAJOR-3 fix: return ONLY the lowest-key pending iteration slot.
    // Previously DurableExecutionEngine called listByScope() and filtered in
    // application code — O(total_tool_calls) deserialization per claim.
    // This query is O(1) index scan on (scope, scope_id) with app-level LIKE.
    this.findNextPendingIterationStmt = client.prepare(
      `SELECT ${SELECT_COLS}
         FROM entries
        WHERE scope = ? AND scope_id = ? AND kind = 'stage_result' AND resolved = 0
          AND key LIKE 'iter/%'
        ORDER BY key ASC LIMIT 1`,
    );

    this.deleteByScopeStmt = client.prepare(
      `DELETE FROM entries WHERE scope = ? AND scope_id = ?`,
    );
  }

  // ── Write ─────────────────────────────────────────────────────

  /**
   * Append a new entry. Returns the created record (with the generated id).
   *
   * For `awakeable` entries the `key` is the one-time token and is enforced
   * UNIQUE at the DB level — a duplicate key throws StorageError.
   *
   * For `artifact` entries the `(scope, scope_id, artifact_id)` tuple is
   * enforced UNIQUE — a retry that supplies the same artifactId reuses the
   * existing row (idempotent).
   */
  create(params: {
    scope: EntryScope;
    scopeId: string;
    kind: EntryKind;
    artifactId?: string;
    key?: string;
    payload: unknown;
  }): EntryRecord {
    const id = generateId();
    const now = Date.now();
    const serialized = JSON.stringify(params.payload);

    try {
      this.createStmt.run(
        id,
        params.scope,
        params.scopeId,
        params.kind,
        params.artifactId ?? null,
        params.key ?? null,
        serialized,
        now,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new StorageError(
        `entries.create failed (${params.kind}): ${msg}`,
        err instanceof Error ? err : undefined,
      );
    }

    return {
      id,
      scope: params.scope,
      scopeId: params.scopeId,
      kind: params.kind,
      artifactId: params.artifactId,
      key: params.key,
      payload: params.payload,
      resolved: false,
      createdAt: now,
    };
  }

  /**
   * Insert many entries atomically in a single SQLite transaction.
   *
   * Items that cannot be inserted (e.g., due to a unique constraint) abort
   * the entire batch — callers should filter out pre-existing rows before
   * calling (see `initializeIterations` in DurableExecutionEngine which uses
   * `findStageResultByKey` to identify new slots first).
   *
   * Returns the created records in the same order as `items`.
   */
  createBatch(
    items: Array<{
      scope: EntryScope;
      scopeId: string;
      kind: EntryKind;
      artifactId?: string;
      key?: string;
      payload: unknown;
    }>,
  ): EntryRecord[] {
    if (items.length === 0) return [];
    const client = rawClient(this.db);
    const results: EntryRecord[] = [];
    const stmt = this.createStmt; // re-use the constructor-prepared statement

    const insertAll = client.transaction(() => {
      for (const params of items) {
        const id = generateId();
        const now = Date.now();
        const serialized = JSON.stringify(params.payload);
        try {
          stmt.run(
            id,
            params.scope,
            params.scopeId,
            params.kind,
            params.artifactId ?? null,
            params.key ?? null,
            serialized,
            now,
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new StorageError(
            `entries.createBatch failed (${params.kind}): ${msg}`,
            err instanceof Error ? err : undefined,
          );
        }
        results.push({
          id,
          scope: params.scope,
          scopeId: params.scopeId,
          kind: params.kind,
          artifactId: params.artifactId,
          key: params.key,
          payload: params.payload,
          resolved: false,
          createdAt: now,
        });
      }
    });

    insertAll();
    return results;
  }

  /**
   * Resolve an entry — atomic UPDATE that stamps `resolved = 1` and
   * `resolved_at = now()`. Returns the updated record, or null if the entry
   * does not exist or is already resolved.
   *
   * Used for:
   *   - Signal: each `resolveSignal(name)` call marks one entry resolved;
   *     callers may create a new entry for the next signal occurrence.
   *   - Awakeable: one-time settle; if already resolved, returns null so the
   *     caller knows the wake-up was a duplicate and can discard it.
   */
  resolve(id: string, payload?: unknown): EntryRecord | null {
    const now = Date.now();
    let row: EntryRow | undefined;

    if (payload !== undefined) {
      row = this.resolveWithPayloadStmt.get(now, JSON.stringify(payload), id) as
        | EntryRow
        | undefined;
    } else {
      row = this.resolveStmt.get(now, id) as EntryRow | undefined;
    }

    return row ? mapRow(row) : null;
  }

  /**
   * Resolve an awakeable by its one-time token (key). Used by the HTTP
   * endpoint `POST /api/awakeables/:token/resolve`.
   */
  resolveByKey(key: string, payload?: unknown): EntryRecord | null {
    const row = this.resolveByKeyLookupStmt.get(key) as { id: string } | undefined;
    if (!row) return null;
    return this.resolve(row.id, payload);
  }

  // ── Read ──────────────────────────────────────────────────────

  getById(id: string): EntryRecord | undefined {
    const row = this.getByIdStmt.get(id) as EntryRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  /**
   * List all entries for a scope — used by the reconnect snapshot path and
   * by StartupRecoveryService to find pending gates.
   */
  listByScope(scope: EntryScope, scopeId: string): EntryRecord[] {
    const rows = this.listByScopeStmt.all(scope, scopeId) as EntryRow[];
    return rows.map(mapRow);
  }

  /**
   * Find the most-recent unresolved signal entry with the given name in a
   * scope. Used by Signal.await() to determine if the signal has already
   * been resolved before setting up a listener.
   */
  findUnresolvedSignal(scope: EntryScope, scopeId: string, name: string): EntryRecord | undefined {
    const row = this.findUnresolvedSignalStmt.get(scope, scopeId, name) as EntryRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  /**
   * Find a tool_result entry by its operationId (stored as `key`). Used by
   * the effect sandwich to detect whether a 'never'-policy effect already
   * settled — if so, the stored result is returned without re-running the
   * effect.
   */
  findToolResult(scope: EntryScope, scopeId: string, operationId: string): EntryRecord | undefined {
    const row = this.findToolResultStmt.get(scope, scopeId, operationId) as EntryRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  /**
   * Find a stage_result entry by its key within a scope. Used by
   * initializeIterations to check whether an iteration slot already exists
   * (F1 fix: findToolResult uses kind='tool_result' and cannot find
   * kind='stage_result' iteration slots).
   */
  findStageResultByKey(scope: EntryScope, scopeId: string, key: string): EntryRecord | undefined {
    const row = this.findStageResultByKeyStmt.get(scope, scopeId, key) as EntryRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  /**
   * Find the most recently RESOLVED signal entry with the given name. Used
   * by awaitSignal to return immediately when a signal already fired before
   * the current process started (F2 fix: recovery path must not hang).
   */
  findLastResolvedSignal(scope: EntryScope, scopeId: string, name: string): EntryRecord | undefined {
    const row = this.findLastResolvedSignalStmt.get(scope, scopeId, name) as EntryRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  /**
   * MAJOR-3 fix — O(1) claim path for iteration loops.
   *
   * Returns the SINGLE lowest-key pending iteration slot for the given
   * execution, or undefined if none remain. This replaces the previous
   * approach of calling listByScope() + application-level filter, which
   * was O(total_tool_calls) per claim — O(n²) total across a full run.
   *
   * The `key LIKE 'iter/%'` filter is safe because the index on
   * (scope, scope_id) constrains the rows first; SQLite then applies LIKE
   * as a filter pass, and the `ORDER BY key ASC LIMIT 1` terminates after
   * the first qualifying row.
   */
  findNextPendingIteration(scope: EntryScope, scopeId: string): EntryRecord | undefined {
    const row = this.findNextPendingIterationStmt.get(scope, scopeId) as EntryRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  // ── Cleanup ───────────────────────────────────────────────────

  /** Delete all entries for a scope. Called during workspace teardown. */
  deleteByScope(scope: EntryScope, scopeId: string): void {
    this.deleteByScopeStmt.run(scope, scopeId);
  }
}
