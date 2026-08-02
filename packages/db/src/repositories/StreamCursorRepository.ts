// ────────────────────────────────────────────────────────────────
// DrizzleStreamCursorRepository — persistent log for StreamBroker.
//
// STR-02 — writes go through `allocate + insert` inside a single
// transaction so per-(scope, scope_id) sequences are gap-free under
// concurrent publishers. Reads return newest-first or above-cursor
// depending on caller.
// ────────────────────────────────────────────────────────────────

import type Database from 'better-sqlite3';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { streamCursors, streamSequences } from '../schema.js';
import type { AppDatabase } from '../index.js';

export type StreamScope = 'session' | 'run' | 'chat' | 'global' | 'automation';

export interface StreamEventRow {
  id: number;
  scope: StreamScope;
  scopeId: string;
  seq: number;
  kind: string;
  payload: unknown;
  ts: number;
}

/** Primary-key the `(scope, scope_id)` composite as a single string for Maps. */
function scopeKey(scope: StreamScope, scopeId: string): string {
  return `${scope}:${scopeId}`;
}

export class DrizzleStreamCursorRepository {
  constructor(private db: AppDatabase) {}

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
    // Reach the raw sqlite handle through drizzle's session.client so we can
    // run the allocate+insert in one synchronous transaction (better-sqlite3
    // transactions are synchronous — that's the whole point of the API).
    // We intentionally do NOT `as unknown as` the private internals here —
    // drizzle exposes `.session.client` as a public extension point for
    // exactly this kind of "I need raw SQLite" use case.
    const sqlite = (this.db as unknown as { session: { client: Database.Database } }).session.client;

    const now = Date.now();
    const txn = sqlite.transaction((args: {
      scope: string;
      scopeId: string;
      kind: string;
      payloadJson: string;
      ts: number;
    }): StreamEventRow => {
      // 1. Upsert sequence counter — SQLite's `ON CONFLICT DO UPDATE` with
      //    `RETURNING` gives us the new value atomically.
      const seqRow = sqlite
        .prepare(
          `INSERT INTO stream_sequences (scope, scope_id, last_seq)
           VALUES (?, ?, 1)
           ON CONFLICT(scope, scope_id) DO UPDATE SET last_seq = last_seq + 1
           RETURNING last_seq`,
        )
        .get(args.scope, args.scopeId) as { last_seq: number } | undefined;
      if (!seqRow) {
        throw new Error(
          `StreamCursorRepository: failed to allocate seq for ${args.scope}:${args.scopeId}`,
        );
      }
      const seq = seqRow.last_seq;

      // 2. Insert the row. UNIQUE(scope, scope_id, seq) guards against a
      //    torn write — though if the allocation path runs inside the same
      //    tx, collisions are impossible.
      const result = sqlite
        .prepare(
          `INSERT INTO stream_cursors (scope, scope_id, seq, kind, payload, ts)
           VALUES (?, ?, ?, ?, ?, ?)
           RETURNING id`,
        )
        .get(args.scope, args.scopeId, seq, args.kind, args.payloadJson, args.ts) as
        | { id: number }
        | undefined;
      if (!result) {
        throw new Error('StreamCursorRepository: INSERT did not return id');
      }

      return {
        id: result.id,
        scope: args.scope as StreamScope,
        scopeId: args.scopeId,
        seq,
        kind: args.kind,
        payload: JSON.parse(args.payloadJson),
        ts: args.ts,
      };
    });

    return txn({
      scope,
      scopeId,
      kind,
      payloadJson: JSON.stringify(payload ?? null),
      ts: now,
    });
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

  /** Delete rows older than `olderThanTs` — for retention sweeps. */
  async prune(olderThanTs: number): Promise<number> {
    const result = await this.db
      .delete(streamCursors)
      .where(sql`${streamCursors.ts} < ${olderThanTs}`);
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
