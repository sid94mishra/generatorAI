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

/**
 * X-25 / W23 — one durable artifact, reassembled from its appended chunks.
 *
 * An artifact is a single `entries` row (`kind='artifact'`) whose `artifact_id`
 * is unique within the scope, so a retry that supplies the same `artifactId`
 * lands on the same row instead of forking a second copy — that stability is
 * the whole point of W23's "stable artifactId survives retry".
 *
 * `resolved` carries the sealed flag: an artifact whose last chunk has been
 * written is `resolved = 1` and refuses further appends. Re-using the existing
 * column rather than adding a payload boolean means "seal it" is the same
 * atomic conditional UPDATE the signal/awakeable paths already rely on, so two
 * writers racing to seal cannot both win.
 */
export interface ArtifactRecord {
  artifactId: string;
  scope: EntryScope;
  scopeId: string;
  /** Everything appended so far, concatenated in append order. */
  text: string;
  /** The most recently appended chunk. Undefined before the first append. */
  lastChunk?: string;
  chunkCount: number;
  /** True once `append({ last: true })` sealed it. */
  complete: boolean;
  /** Free-form descriptor supplied at creation (mime type, stage name, …). */
  meta?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/** Payload shape stored on an `artifact` entry row. */
interface ArtifactPayload {
  text: string;
  lastChunk: string | null;
  chunkCount: number;
  meta?: Record<string, unknown>;
  updatedAt: number;
}

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

/** Project an `artifact` row onto the caller-facing shape. */
function mapArtifact(row: EntryRow): ArtifactRecord {
  const payload = JSON.parse(row.payload) as ArtifactPayload;
  return {
    artifactId: row.artifact_id ?? '',
    scope: row.scope as EntryScope,
    scopeId: row.scope_id,
    text: payload.text,
    lastChunk: payload.lastChunk ?? undefined,
    chunkCount: payload.chunkCount,
    complete: row.resolved === 1,
    meta: payload.meta,
    createdAt: row.created_at,
    updatedAt: payload.updatedAt,
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
  /** P0-c — iteration slots already claimed, for lease expiry / reclaim. */
  private readonly listClaimedIterationsStmt: Database.Statement;
  /** P0-c — how many slots are still unclaimed (drives the resume decision). */
  private readonly countPendingIterationsStmt: Database.Statement;
  /** P0-c — completion write-back on an already-resolved (claimed) row. */
  private readonly updatePayloadStmt: Database.Statement;
  /** P0-c — un-claim a row whose lease expired so another process can take it. */
  private readonly unresolveStmt: Database.Statement;
  private readonly deleteByScopeStmt: Database.Statement;
  /** §3.4 retention — drop a finished scope's step journal, keep its artifacts. */
  private readonly deleteJournalByScopeStmt: Database.Statement;
  /** X-25 — create-if-absent for an artifact row, keyed by its stable id. */
  private readonly insertArtifactStmt: Database.Statement;
  /** X-25 — in-place chunk append; refuses a sealed artifact. */
  private readonly appendArtifactStmt: Database.Statement;
  private readonly reopenArtifactStmt: Database.Statement;
  private readonly deleteEntryByKeyStmt: Database.Statement;
  private readonly getArtifactStmt: Database.Statement;
  private readonly listArtifactsStmt: Database.Statement;

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

    // △ `ORDER BY rowid ASC` is load-bearing, not cosmetic. Migration 42 adds
    // the unique index that makes a duplicate settlement impossible going
    // forward, but a database created before it can still hold two rows for
    // one operationId (a `replay: safe` re-run racing the original writer).
    // Without an explicit order SQLite may return either, so the memoised
    // result for the SAME operationId could differ between two reads — the
    // one thing the effect sandwich exists to rule out. Oldest-wins is the
    // right tiebreak: it is the settlement that actually happened first.
    this.findToolResultStmt = client.prepare(
      `SELECT ${SELECT_COLS}
         FROM entries
        WHERE scope = ? AND scope_id = ? AND kind = 'tool_result' AND key = ?
        ORDER BY rowid ASC LIMIT 1`,
    );

    this.findStageResultByKeyStmt = client.prepare(
      `SELECT ${SELECT_COLS}
         FROM entries
        WHERE scope = ? AND scope_id = ? AND kind = 'stage_result' AND key = ? LIMIT 1`,
    );

    // △ `resolved_at DESC` alone ties whenever two resolves land in the same
    // millisecond — realistic for back-to-back `resolveSignal()` calls, and
    // reproduced by `DurableExecutionEnginePrimitives.test.ts` (two
    // synchronous resolves returned the FIRST payload instead of the last).
    // `rowid DESC` breaks the tie by insertion order — `entries` has a plain
    // TEXT primary key (`id`), so it keeps SQLite's normal hidden rowid
    // (the table is not `WITHOUT ROWID`), which is guaranteed monotonically
    // increasing with insertion order.
    this.findLastResolvedSignalStmt = client.prepare(
      `SELECT ${SELECT_COLS}
         FROM entries
        WHERE scope = ? AND scope_id = ? AND kind = 'signal' AND key = ? AND resolved = 1
        ORDER BY resolved_at DESC, rowid DESC LIMIT 1`,
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

    this.listClaimedIterationsStmt = client.prepare(
      `SELECT ${SELECT_COLS}
         FROM entries
        WHERE scope = ? AND scope_id = ? AND kind = 'stage_result' AND resolved = 1
          AND key LIKE 'iter/%'
        ORDER BY key ASC`,
    );

    this.countPendingIterationsStmt = client.prepare(
      `SELECT COUNT(*) AS n
         FROM entries
        WHERE scope = ? AND scope_id = ? AND kind = 'stage_result' AND resolved = 0
          AND key LIKE 'iter/%'`,
    );

    this.updatePayloadStmt = client.prepare(
      `UPDATE entries SET payload = ? WHERE id = ? RETURNING ${SELECT_COLS}`,
    );

    this.unresolveStmt = client.prepare(
      `UPDATE entries
          SET resolved = 0, resolved_at = NULL, payload = ?
        WHERE id = ? AND resolved = 1
        RETURNING ${SELECT_COLS}`,
    );

    this.deleteByScopeStmt = client.prepare(
      `DELETE FROM entries WHERE scope = ? AND scope_id = ?`,
    );

    // §3.4 retention — the journal is transient, the artifact is the result.
    // Reclaiming a finished scope's step journal must NOT take its artifacts
    // with it: those are the durable stage result X-25 moved out of messages,
    // and they are read after the scope is terminal.
    this.deleteJournalByScopeStmt = client.prepare(
      `DELETE FROM entries WHERE scope = ? AND scope_id = ? AND kind != 'artifact'`,
    );

    // ── X-25 artifact channel ────────────────────────────────────────
    //
    // `INSERT ... ON CONFLICT DO NOTHING` against the existing unique index
    // `idx_entries_artifact_id (scope, scope_id, artifact_id)`. A second
    // `appendArtifact` for the same artifactId — the normal case, since every
    // chunk after the first hits this — is a no-op, so create-then-append is
    // one idempotent pair rather than a read-modify-write with a race in the
    // middle.
    this.insertArtifactStmt = client.prepare(
      `INSERT INTO entries (id, scope, scope_id, kind, artifact_id, key, payload, resolved, created_at)
         VALUES (?, ?, ?, 'artifact', ?, ?, ?, 0, ?)
         ON CONFLICT (scope, scope_id, artifact_id) WHERE artifact_id IS NOT NULL DO NOTHING`,
    );

    // △ The append is done by SQLite, not by JavaScript. Reading the payload
    // out, concatenating in JS and writing it back would be a read-modify-
    // write across two statements — two concurrent appenders would each
    // overwrite the other's chunk and the artifact would silently lose data.
    // `json_set` over `json_extract` mutates the row in ONE statement, so the
    // append is atomic against every other writer on the connection.
    //
    // `WHERE resolved = 0` is the lastChunk contract: once sealed, an artifact
    // takes no further chunks and the caller gets null instead of a silent
    // no-op that looks like success.
    this.appendArtifactStmt = client.prepare(
      `UPDATE entries
          SET payload = json_set(
                payload,
                '$.text',       json_extract(payload, '$.text') || ?,
                '$.lastChunk',  ?,
                '$.chunkCount', json_extract(payload, '$.chunkCount') + 1,
                '$.updatedAt',  ?
              ),
              resolved    = ?,
              resolved_at = CASE WHEN ? = 1 THEN ? ELSE resolved_at END
        WHERE scope = ? AND scope_id = ? AND kind = 'artifact'
          AND artifact_id = ? AND resolved = 0
        RETURNING ${SELECT_COLS}`,
    );

    // An artifact is sealed when its attempt reached a terminal state. A stage
    // run that is EXECUTING AGAIN under the same id (a post-validation retry,
    // a crash relaunch) is by definition not terminal any more, so the seal
    // has to come off or every append in the new attempt returns null and the
    // artifact keeps handing successors the output that was just rejected.
    // `resolved_at` is cleared with it so the row does not claim a completion
    // time for a result that is being rewritten.
    this.reopenArtifactStmt = client.prepare(
      `UPDATE entries
          SET resolved = 0, resolved_at = NULL
        WHERE scope = ? AND scope_id = ? AND kind = 'artifact'
          AND artifact_id = ? AND resolved = 1
        RETURNING ${SELECT_COLS}`,
    );

    this.deleteEntryByKeyStmt = client.prepare(
      `DELETE FROM entries WHERE scope = ? AND scope_id = ? AND kind = ? AND key = ?`,
    );

    this.getArtifactStmt = client.prepare(
      `SELECT ${SELECT_COLS}
         FROM entries
        WHERE scope = ? AND scope_id = ? AND kind = 'artifact' AND artifact_id = ?`,
    );

    this.listArtifactsStmt = client.prepare(
      `SELECT ${SELECT_COLS}
         FROM entries
        WHERE scope = ? AND scope_id = ? AND kind = 'artifact'
        ORDER BY created_at, rowid`,
    );
  }

  /**
   * Run `fn` inside a single SQLite transaction on this repository's
   * connection.
   *
   * §3.4 requires the effect sandwich's settlement — the `tool_result` row
   * AND the register flip to `settled` — to land as ONE write. Those are two
   * different repositories, but both are backed by the SAME better-sqlite3
   * connection (they are constructed from the same `AppDatabase`), and
   * better-sqlite3 transactions are connection-scoped, so a `RegisterRepository`
   * write issued inside this callback is part of the same transaction. `fn`
   * must be synchronous — better-sqlite3 cannot span a transaction across an
   * await.
   */
  transaction<T>(fn: () => T): T {
    return rawClient(this.db).transaction(fn)();
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

  /**
   * P0-c — every iteration slot that has been CLAIMED (`resolved = 1`),
   * regardless of whether it later completed. The engine reads the payload's
   * lease fields to decide which of them belong to a process that died
   * mid-iteration and must be handed back. Recovery-path only; the hot claim
   * loop still uses `findNextPendingIteration`.
   */
  listClaimedIterations(scope: EntryScope, scopeId: string): EntryRecord[] {
    const rows = this.listClaimedIterationsStmt.all(scope, scopeId) as EntryRow[];
    return rows.map(mapRow);
  }

  /** P0-c — number of iteration slots nobody has claimed yet. */
  countPendingIterations(scope: EntryScope, scopeId: string): number {
    const row = this.countPendingIterationsStmt.get(scope, scopeId) as { n: number } | undefined;
    return row?.n ?? 0;
  }

  // ── Claim lifecycle (P0-c) ────────────────────────────────────

  /**
   * Replace an entry's payload in place, leaving `resolved` untouched.
   *
   * This is the COMPLETION write for a claimed iteration slot: `resolve()`
   * flips `resolved = 0 → 1` to claim it, and this records the outcome on the
   * row afterwards. Without it a claimed row is indistinguishable from a
   * finished one, which is exactly why a crash mid-iteration used to lose
   * that row permanently and silently.
   */
  updatePayload(id: string, payload: unknown): EntryRecord | null {
    const row = this.updatePayloadStmt.get(JSON.stringify(payload), id) as EntryRow | undefined;
    return row ? mapRow(row) : null;
  }

  /**
   * Hand a claimed entry back to the pending pool: `resolved = 1 → 0`,
   * clearing `resolved_at` and rewriting the payload. Conditional on
   * `resolved = 1` so two recovery passes cannot both "reclaim" the same row
   * and hand it to two workers; the loser gets null.
   */
  unresolve(id: string, payload: unknown): EntryRecord | null {
    const row = this.unresolveStmt.get(JSON.stringify(payload), id) as EntryRow | undefined;
    return row ? mapRow(row) : null;
  }

  // ── Artifacts (X-25 / W23) ────────────────────────────────────

  /**
   * Append one chunk to a durable artifact, creating it on the first call.
   *
   * This is the durable result channel W23 asked for and X-25 said was
   * missing: before it, `entries.kind='artifact'` had zero writers and zero
   * readers, and every stage result went through `messageRepo.create` — the
   * lossy chat stream, where a result is one row among the prompts, cannot be
   * appended to, and disappears with the session.
   *
   * Semantics:
   *   - `chunk` is concatenated onto the artifact's text in append order.
   *   - `last: true` seals the artifact; further appends return null.
   *   - `meta` is recorded on creation only; later values are ignored, so a
   *     retry cannot rewrite the descriptor of an artifact already in flight.
   *
   * Returns the artifact after the append, or null when it was already sealed.
   *
   * Cost note: the text is one column, so an artifact is bounded by SQLite's
   * value size and each append rewrites the row. It is sized for stage-shaped
   * results (a handful of appends of a few KB), NOT for a token stream —
   * §3.4's "token streams never enter the journal" still holds.
   */
  appendArtifact(params: {
    scope: EntryScope;
    scopeId: string;
    artifactId: string;
    chunk: string;
    last?: boolean;
    meta?: Record<string, unknown>;
  }): ArtifactRecord | null {
    const now = Date.now();
    const sealed = params.last === true ? 1 : 0;

    return this.transaction(() => {
      const initial: ArtifactPayload = {
        text: '',
        lastChunk: null,
        chunkCount: 0,
        ...(params.meta ? { meta: params.meta } : {}),
        updatedAt: now,
      };
      try {
        this.insertArtifactStmt.run(
          generateId(),
          params.scope,
          params.scopeId,
          params.artifactId,
          params.artifactId, // `key` mirrors the artifact id for scope+key lookups
          JSON.stringify(initial),
          now,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new StorageError(
          `entries.appendArtifact failed to open artifact ${params.artifactId}: ${msg}`,
          err instanceof Error ? err : undefined,
        );
      }

      const row = this.appendArtifactStmt.get(
        params.chunk,
        params.chunk,
        now,
        sealed,
        sealed,
        now,
        params.scope,
        params.scopeId,
        params.artifactId,
      ) as EntryRow | undefined;

      return row ? mapArtifact(row) : null;
    });
  }

  /**
   * Take the seal off an artifact so a fresh attempt can keep appending to it.
   *
   * Returns the reopened record, or null when there was nothing to reopen —
   * the artifact does not exist yet, or it is already open. Both are ordinary,
   * so callers treat null as "nothing to do", not as a failure.
   *
   * △ This is the counterpart to `last: true`. Sealing is scoped to ONE
   * attempt reaching a terminal state, but the artifact is scoped to the stage
   * RUN, and a run can execute more than once under the same id (a
   * post-completion validation retry, a crash relaunch). Without a way to
   * reopen, every append in the second attempt returned null — silently, since
   * no caller checked — and the durable channel kept serving the first
   * attempt's output to every successor that read it.
   */
  reopenArtifact(scope: EntryScope, scopeId: string, artifactId: string): ArtifactRecord | null {
    const row = this.reopenArtifactStmt.get(scope, scopeId, artifactId) as EntryRow | undefined;
    return row ? mapArtifact(row) : null;
  }

  /**
   * Delete one journal entry by its `(scope, scopeId, kind, key)` identity.
   *
   * Used to RETRACT a settled operation — see
   * `DurableExecutionEngine.discardOperation`. Returns the number of rows
   * removed (0 or 1 for the kinds that carry a unique key).
   */
  deleteByKey(scope: EntryScope, scopeId: string, kind: EntryKind, key: string): number {
    return this.deleteEntryByKeyStmt.run(scope, scopeId, kind, key).changes;
  }

  /** Read one artifact by its stable id, or undefined if it has none yet. */
  getArtifact(scope: EntryScope, scopeId: string, artifactId: string): ArtifactRecord | undefined {
    const row = this.getArtifactStmt.get(scope, scopeId, artifactId) as EntryRow | undefined;
    return row ? mapArtifact(row) : undefined;
  }

  /**
   * The most recently appended chunk of an artifact — W23's `lastChunk`.
   *
   * Lets a reconnecting client resume from the tail without re-reading the
   * whole artifact, and lets recovery see what the last durable write was.
   */
  lastChunk(scope: EntryScope, scopeId: string, artifactId: string): string | undefined {
    return this.getArtifact(scope, scopeId, artifactId)?.lastChunk;
  }

  /** Every artifact in a scope, in creation order. */
  listArtifacts(scope: EntryScope, scopeId: string): ArtifactRecord[] {
    const rows = this.listArtifactsStmt.all(scope, scopeId) as EntryRow[];
    return rows.map(mapArtifact);
  }

  // ── Cleanup ───────────────────────────────────────────────────

  /** Delete all entries for a scope. Called during workspace teardown. */
  deleteByScope(scope: EntryScope, scopeId: string): void {
    this.deleteByScopeStmt.run(scope, scopeId);
  }

  /**
   * §3.4 "retention that fires" — drop a TERMINAL scope's step journal
   * (`tool_result`, `signal`, `awakeable`, `stage_result`) while keeping its
   * artifacts.
   *
   * The journal grows with the number of turns and tool calls a stage made,
   * forever, for every stage that has ever run. The artifacts are the stage's
   * durable result and are read after it finishes, so they must survive.
   */
  deleteJournalByScope(scope: EntryScope, scopeId: string): void {
    this.deleteJournalByScopeStmt.run(scope, scopeId);
  }
}
