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

// ── Repository ─────────────────────────────────────────────────

export class EntryRepository {
  constructor(private readonly db: AppDatabase) {}

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
    const client = rawClient(this.db);
    const id = generateId();
    const now = Date.now();
    const serialized = JSON.stringify(params.payload);

    try {
      client
        .prepare(
          `INSERT INTO entries (id, scope, scope_id, kind, artifact_id, key, payload, resolved, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        )
        .run(
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
      throw new StorageError(`entries.create failed (${params.kind}): ${msg}`, err instanceof Error ? err : undefined);
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
    const client = rawClient(this.db);
    const now = Date.now();
    const payloadStr = payload !== undefined ? JSON.stringify(payload) : null;

    const row = client
      .prepare(
        `UPDATE entries
            SET resolved = 1, resolved_at = ?${payloadStr !== null ? ', payload = ?' : ''}
          WHERE id = ? AND resolved = 0
          RETURNING id, scope, scope_id, kind, artifact_id, key, payload, resolved, resolved_at, created_at`,
      )
      .get(...(payloadStr !== null ? [now, payloadStr, id] : [now, id])) as EntryRow | undefined;

    return row ? mapRow(row) : null;
  }

  /**
   * Resolve an awakeable by its one-time token (key). Used by the HTTP
   * endpoint `POST /api/awakeables/:token/resolve`.
   */
  resolveByKey(key: string, payload?: unknown): EntryRecord | null {
    const client = rawClient(this.db);
    const row = client
      .prepare(
        `SELECT id FROM entries WHERE kind = 'awakeable' AND key = ? AND resolved = 0`,
      )
      .get(key) as { id: string } | undefined;

    if (!row) return null;
    return this.resolve(row.id, payload);
  }

  // ── Read ──────────────────────────────────────────────────────

  getById(id: string): EntryRecord | undefined {
    const client = rawClient(this.db);
    const row = client
      .prepare(
        `SELECT id, scope, scope_id, kind, artifact_id, key, payload, resolved, resolved_at, created_at
           FROM entries WHERE id = ?`,
      )
      .get(id) as EntryRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  /**
   * List all entries for a scope — used by the reconnect snapshot path and
   * by StartupRecoveryService to find pending gates.
   */
  listByScope(scope: EntryScope, scopeId: string): EntryRecord[] {
    const client = rawClient(this.db);
    const rows = client
      .prepare(
        `SELECT id, scope, scope_id, kind, artifact_id, key, payload, resolved, resolved_at, created_at
           FROM entries WHERE scope = ? AND scope_id = ? ORDER BY created_at`,
      )
      .all(scope, scopeId) as EntryRow[];
    return rows.map(mapRow);
  }

  /**
   * Find the most-recent unresolved signal entry with the given name in a
   * scope. Used by Signal.await() to determine if the signal has already
   * been resolved before setting up a listener.
   */
  findUnresolvedSignal(scope: EntryScope, scopeId: string, name: string): EntryRecord | undefined {
    const client = rawClient(this.db);
    const row = client
      .prepare(
        `SELECT id, scope, scope_id, kind, artifact_id, key, payload, resolved, resolved_at, created_at
           FROM entries
          WHERE scope = ? AND scope_id = ? AND kind = 'signal' AND key = ? AND resolved = 0
          ORDER BY created_at DESC LIMIT 1`,
      )
      .get(scope, scopeId, name) as EntryRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  /**
   * Find a tool_result entry by its operationId (stored as `key`). Used by
   * the effect sandwich to detect whether a 'never'-policy effect already
   * settled — if so, the stored result is returned without re-running the
   * effect.
   */
  findToolResult(scope: EntryScope, scopeId: string, operationId: string): EntryRecord | undefined {
    const client = rawClient(this.db);
    const row = client
      .prepare(
        `SELECT id, scope, scope_id, kind, artifact_id, key, payload, resolved, resolved_at, created_at
           FROM entries
          WHERE scope = ? AND scope_id = ? AND kind = 'tool_result' AND key = ? LIMIT 1`,
      )
      .get(scope, scopeId, operationId) as EntryRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  // ── Cleanup ───────────────────────────────────────────────────

  /** Delete all entries for a scope. Called during workspace teardown. */
  deleteByScope(scope: EntryScope, scopeId: string): void {
    const client = rawClient(this.db);
    client
      .prepare(`DELETE FROM entries WHERE scope = ? AND scope_id = ?`)
      .run(scope, scopeId);
  }
}
