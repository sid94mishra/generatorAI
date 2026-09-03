// ────────────────────────────────────────────────────────────────
// DrizzleStreamCursorRepository — persistent log for StreamBroker.
//
// STR-02 — writes go through `allocate + insert` inside a single
// transaction so per-(scope, scope_id) sequences are gap-free under
// concurrent publishers. Reads return newest-first or above-cursor
// depending on caller.
// ────────────────────────────────────────────────────────────────

import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { streamCursors, streamSequences } from '../schema.js';
import type { AppDatabase } from '../index.js';

export type StreamScope = 'session' | 'run' | 'chat' | 'global' | 'automation' | 'workspace';

export interface StreamEventRow {
  id: number;
  scope: StreamScope;
  scopeId: string;
  seq: number;
  kind: string;
  payload: unknown;
  ts: number;
}

/**
 * Thrown when a stream append is attempted inside an open transaction.
 *
 * Its own type because the fix is structural, not a retry: the publish has to
 * move out of the transaction, to after it commits.
 */
export class StreamAppendInTransactionError extends Error {
  constructor(
    readonly scope: StreamScope,
    readonly scopeId: string,
    readonly kind: string,
  ) {
    super(
      `StreamCursorRepository.append(${scope}:${scopeId}, ${kind}) was called inside an ` +
        'open transaction. The append would become a SAVEPOINT that the enclosing ' +
        'transaction can roll back AFTER the event was broadcast, which breaks ' +
        'commit-then-broadcast (EVT-01). Publish after the transaction commits.',
    );
    this.name = 'StreamAppendInTransactionError';
  }
}

/** Primary-key the `(scope, scope_id)` composite as a single string for Maps. */
function scopeKey(scope: StreamScope, scopeId: string): string {
  return `${scope}:${scopeId}`;
}

/** Compiled statements + transaction wrapper for one `append` call site. */
interface AppendPlan {
  run: (args: {
    scope: string;
    scopeId: string;
    kind: string;
    payloadJson: string;
    ts: number;
  }) => { id: number; seq: number };
  /**
   * Same statements, one transaction, N events.
   *
   * The measured reason this exists: executing the two statements costs ~7 µs,
   * and the surrounding WAL commit costs ~210 µs. At one transaction per token
   * that is 97% overhead. Amortising the commit across a batch is the single
   * largest win available on the write path, and it is why L1 says tokens are
   * never written synchronously.
   */
  runBatch: (
    args: ReadonlyArray<{
      scope: string;
      scopeId: string;
      kind: string;
      payloadJson: string;
      ts: number;
    }>,
  ) => Array<{ id: number; seq: number }>;
}

export class DrizzleStreamCursorRepository {
  /**
   * P0-2 — `prepare()` was called twice per event, inside the transaction.
   * Compiling the same two statements per streamed token measured 350 µs;
   * compiling once and reusing the handles measured 30 µs. better-sqlite3
   * statements are bound to their connection, so the plan is built lazily
   * from the live handle and kept for the lifetime of the repository.
   */
  private appendPlan: AppendPlan | undefined;
  /** Connection the cached plan was compiled against, for the assertion below. */
  private planConnection: Database.Database | undefined;
  /** Memoised `streamSpaceId()` — it is read on every stream connection. */
  private cachedSpaceId: string | undefined;

  constructor(private db: AppDatabase) {}

  private rawSqlite(): Database.Database {
    // Reach the raw sqlite handle through drizzle's session.client so we can
    // run the allocate+insert in one synchronous transaction (better-sqlite3
    // transactions are synchronous — that's the whole point of the API).
    return (this.db as unknown as { session: { client: Database.Database } }).session.client;
  }

  private getAppendPlan(): AppendPlan {
    const sqlite = this.rawSqlite();
    // A cached statement belongs to the connection that compiled it. Nothing
    // today reopens the connection under a live repository, but that is an
    // invariant rather than a guarantee, and if it is ever broken the failure
    // is a use-after-close on the streaming hot path. Asserted, not assumed.
    if (this.appendPlan && this.planConnection === sqlite) return this.appendPlan;
    if (this.appendPlan) {
      throw new Error(
        'StreamCursorRepository: the database connection was replaced under a live ' +
          'repository. Cached statements are bound to their connection; construct a ' +
          'new repository instead of reusing this one.',
      );
    }

    // 1. Upsert sequence counter — SQLite's `ON CONFLICT DO UPDATE` with
    //    `RETURNING` gives us the new value atomically.
    const allocSeq = sqlite.prepare(
      `INSERT INTO stream_sequences (scope, scope_id, last_seq)
       VALUES (?, ?, 1)
       ON CONFLICT(scope, scope_id) DO UPDATE SET last_seq = last_seq + 1
       RETURNING last_seq`,
    );
    // 2. Insert the row. UNIQUE(scope, scope_id, seq) guards against a
    //    torn write — though if the allocation path runs inside the same
    //    tx, collisions are impossible.
    const insertRow = sqlite.prepare(
      `INSERT INTO stream_cursors (scope, scope_id, seq, kind, payload, ts)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING id`,
    );

    type AppendArgs = {
      scope: string;
      scopeId: string;
      kind: string;
      payloadJson: string;
      ts: number;
    };

    const writeOne = (args: AppendArgs): { id: number; seq: number } => {
      const seqRow = allocSeq.get(args.scope, args.scopeId) as { last_seq: number } | undefined;
      if (!seqRow) {
        throw new Error(
          `StreamCursorRepository: failed to allocate seq for ${args.scope}:${args.scopeId}`,
        );
      }
      const seq = seqRow.last_seq;

      const result = insertRow.get(
        args.scope,
        args.scopeId,
        seq,
        args.kind,
        args.payloadJson,
        args.ts,
      ) as { id: number } | undefined;
      if (!result) {
        throw new Error('StreamCursorRepository: INSERT did not return id');
      }
      return { id: result.id, seq };
    };

    const run = sqlite.transaction(writeOne);
    // Sequence allocation stays per-event inside the batch: two events on the
    // same scope must still get consecutive numbers, and the counter is what
    // guarantees that. Only the COMMIT is shared.
    const runBatch = sqlite.transaction((args: ReadonlyArray<AppendArgs>) =>
      args.map(writeOne),
    );

    this.appendPlan = { run, runBatch };
    this.planConnection = sqlite;
    return this.appendPlan;
  }

  /**
   * Atomically allocate the next seq for (scope, scope_id) and insert the
   * payload row. Uses better-sqlite3's transactional wrapper to hold the
   * allocation + insert in one write, so a reader mid-allocation never sees
   * a gap.
   */
  async append(
    scope: StreamScope,
    scopeId: string,
    kind: string,
    payload: unknown,
  ): Promise<StreamEventRow> {
    const sqlite = this.rawSqlite();
    // P0-3 — better-sqlite3's `.transaction()` silently becomes a SAVEPOINT
    // when a transaction is already open. That is correct for ordinary nested
    // work and fatal here: the caller broadcasts as soon as this resolves, and
    // a savepoint the outer transaction later rolls back means a live
    // subscriber has seen an event replay cannot return. The hole is invisible
    // — no error, no gap marker, and the client has no way to detect it.
    //
    // There is no way to commit a row ahead of an enclosing transaction on one
    // connection, so this cannot be repaired here; it can only be refused. If a
    // caller needs both, it must publish AFTER its transaction commits.
    if (sqlite.inTransaction) {
      throw new StreamAppendInTransactionError(scope, scopeId, kind);
    }

    const now = Date.now();
    const payloadJson = JSON.stringify(payload ?? null);
    const { id, seq } = this.getAppendPlan().run({
      scope,
      scopeId,
      kind,
      payloadJson,
      ts: now,
    });

    return {
      id,
      scope,
      scopeId,
      seq,
      kind,
      // Returned BY REFERENCE. The previous code round-tripped it through
      // JSON.parse(JSON.stringify(...)) purely as a side effect of building the
      // insert parameter, which cost a second full serialisation per streamed
      // token for an identical value.
      //
      // The contract this relies on: an event payload must already be
      // JSON-plain at the publish boundary. It is about to be persisted as
      // JSON, so anything that does not survive `JSON.stringify` was already
      // being silently lost on the replay path. Subscribers must treat
      // `payload` as read-only — it is the producer's object, not a copy.
      payload: payload ?? null,
      ts: now,
    };
  }

  /**
   * Append many events in ONE transaction.
   *
   * Measured: the two statements cost ~7 µs and the surrounding WAL commit
   * ~210 µs, so a per-event transaction is 97% overhead. Batching is the
   * largest single win on the write path.
   *
   * All-or-nothing, deliberately. A partial batch would mean some events were
   * broadcast and others silently were not, with no way for a subscriber to
   * tell which — the same invisible hole `StreamAppendInTransactionError`
   * exists to prevent. The caller rejects the whole batch and every one of its
   * waiters learns about it.
   *
   * Results are returned in input order.
   */
  async appendBatch(
    events: ReadonlyArray<{
      scope: StreamScope;
      scopeId: string;
      kind: string;
      payload: unknown;
    }>,
  ): Promise<StreamEventRow[]> {
    if (events.length === 0) return [];

    const sqlite = this.rawSqlite();
    if (sqlite.inTransaction) {
      const first = events[0]!;
      throw new StreamAppendInTransactionError(first.scope, first.scopeId, first.kind);
    }

    const now = Date.now();
    const args = events.map((e) => ({
      scope: e.scope,
      scopeId: e.scopeId,
      kind: e.kind,
      payloadJson: JSON.stringify(e.payload ?? null),
      ts: now,
    }));

    const written = this.getAppendPlan().runBatch(args);

    return events.map((e, i) => ({
      id: written[i]!.id,
      scope: e.scope,
      scopeId: e.scopeId,
      seq: written[i]!.seq,
      kind: e.kind,
      payload: e.payload ?? null,
      ts: now,
    }));
  }

  /**
   * Replay rows for (scope, scope_id) strictly greater than `afterSeq`,
   * oldest first. STR-06 — caps the synchronous return at `limit` (default 100).
   */
  async replayAfter(
    scope: StreamScope,
    scopeId: string,
    afterSeq: number,
    limit: number = 100,
  ): Promise<StreamEventRow[]> {
    const rows = await this.db
      .select({
        id: streamCursors.id,
        scope: streamCursors.scope,
        scopeId: streamCursors.scopeId,
        seq: streamCursors.seq,
        kind: streamCursors.kind,
        payload: streamCursors.payload,
        ts: streamCursors.ts,
      })
      .from(streamCursors)
      .where(
        and(
          eq(streamCursors.scope, scope),
          eq(streamCursors.scopeId, scopeId),
          gt(streamCursors.seq, afterSeq),
        ),
      )
      .orderBy(asc(streamCursors.seq))
      .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      scope: r.scope as StreamScope,
      scopeId: r.scopeId,
      seq: r.seq,
      kind: r.kind,
      payload: r.payload,
      ts: r.ts,
    }));
  }

  /**
   * Oldest surviving seq for a scope, or 0 when nothing is stored.
   *
   * W08 — this is how resume tells the truth. A client returning with
   * `afterSeq = 40` when retention has swept everything below 100 cannot be
   * resumed: replaying "everything after 40" hands it rows 100+ and leaves a
   * permanent, undetectable hole where 41-99 used to be. Knowing the floor is
   * what turns that into an honest `resumed: false` and a re-snapshot.
   */
  async oldestSeq(scope: StreamScope, scopeId: string): Promise<number> {
    const rows = await this.db
      .select({ seq: streamCursors.seq })
      .from(streamCursors)
      .where(and(eq(streamCursors.scope, scope), eq(streamCursors.scopeId, scopeId)))
      .orderBy(asc(streamCursors.seq))
      .limit(1);
    return rows[0]?.seq ?? 0;
  }

  /** Delete rows older than `olderThanTs` — for retention sweeps. */
  async prune(olderThanTs: number): Promise<number> {
    const result = await this.db
      .delete(streamCursors)
      .where(sql`${streamCursors.ts} < ${olderThanTs}`);
    return Number((result as unknown as { changes?: number }).changes ?? 0);
  }

  /**
   * Stable identity for THIS database's sequence space, minted once and stored.
   *
   * W08 — the identity a resume cursor has to be checked against is the
   * database's, NOT the process's. `stream_sequences` is a persisted table and
   * `deleteScope` deliberately never resets it, so sequence numbers survive
   * every restart and a cursor from a previous boot is perfectly valid. An
   * earlier attempt used a per-process id and consequently rejected every
   * cursor after a restart, silently skipping replay for exactly the outage it
   * existed to protect.
   *
   * What it does still catch is the case where the numbers genuinely change
   * underneath a client: a restored backup, a wiped dev database, a different
   * machine behind the same URL.
   */
  async streamSpaceId(): Promise<string> {
    if (this.cachedSpaceId) return this.cachedSpaceId;
    const sqlite = this.rawSqlite();

    const existing = sqlite
      .prepare("SELECT value FROM stream_meta WHERE key = 'stream_space_id'")
      .get() as { value: string } | undefined;
    if (existing?.value) {
      this.cachedSpaceId = existing.value;
      return existing.value;
    }

    const minted = randomUUID().slice(0, 8);
    // `OR IGNORE` + re-read: two processes opening the same file concurrently
    // must agree on one value rather than each keeping its own.
    sqlite
      .prepare("INSERT OR IGNORE INTO stream_meta (key, value) VALUES ('stream_space_id', ?)")
      .run(minted);
    const row = sqlite
      .prepare("SELECT value FROM stream_meta WHERE key = 'stream_space_id'")
      .get() as { value: string } | undefined;
    this.cachedSpaceId = row?.value ?? minted;
    return this.cachedSpaceId;
  }

  /**
   * Delete every row for one (scope, scope_id).
   *
   * Needed because the durable stream log is now the only place event payloads
   * live: deleting a chat or a session has to remove its prompts, tool
   * arguments and tool results from here, not just from the legacy table.
   *
   * The `stream_sequences` counter is deliberately NOT reset. Reusing sequence
   * numbers for a scope id that a client might still hold a cursor for would
   * make a stale cursor look valid.
   */
  async deleteScope(scope: StreamScope, scopeId: string): Promise<number> {
    const result = await this.db
      .delete(streamCursors)
      .where(and(eq(streamCursors.scope, scope), eq(streamCursors.scopeId, scopeId)));
    return Number((result as unknown as { changes?: number }).changes ?? 0);
  }

  /** For tests + debugging. */
  async getLastSeq(scope: StreamScope, scopeId: string): Promise<number> {
    const row = await this.db
      .select({ lastSeq: streamSequences.lastSeq })
      .from(streamSequences)
      .where(
        and(eq(streamSequences.scope, scope), eq(streamSequences.scopeId, scopeId)),
      )
      .limit(1);
    return row[0]?.lastSeq ?? 0;
  }

  /** Internal helper — exported for tests. */
  _scopeKey(scope: StreamScope, scopeId: string): string {
    return scopeKey(scope, scopeId);
  }
}
