// ────────────────────────────────────────────────────────────────
// W03 — a row that has been broadcast can never be rolled back (P0-3).
//
// better-sqlite3 turns `.transaction()` into a SAVEPOINT when a transaction
// is already open, so a stream append nested inside another transaction was
// a savepoint the outer rollback could undo — after subscribers had already
// seen the event. The append refuses to run inside a transaction.
// (The async `withTransaction` helper is gone, P01 WP-1.7 / A-34:
// multi-row writes are synchronous better-sqlite3 transactions.)
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type Database from 'better-sqlite3';
import { createDB, migrateDB, isInTransaction, type AppDatabase } from '../src/index.js';
import {
  DrizzleStreamCursorRepository,
  StreamAppendInTransactionError,
} from '../src/repositories/StreamCursorRepository.js';

let dir: string;
let db: AppDatabase;
let repo: DrizzleStreamCursorRepository;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gai-tx-'));
  db = createDB(join(dir, 'tx.db'));
  migrateDB(db);
  repo = new DrizzleStreamCursorRepository(db);
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows handle */
  }
});

const client = (): Database.Database => (db as unknown as { session: { client: Database.Database } }).session.client;

/** Runs `fn` inside an open transaction and rolls it back. */
async function inTransaction<T>(fn: () => Promise<T>): Promise<T> {
  client().exec('BEGIN');
  try {
    return await fn();
  } finally {
    client().exec('ROLLBACK');
  }
}

/** Reads straight through the driver so it cannot be fooled by a cache. */
function countRows(): number {
  const sqlite = (db as unknown as { session: { client: { prepare: (s: string) => { get: () => { n: number } } } } })
    .session.client;
  return sqlite.prepare('SELECT COUNT(*) AS n FROM stream_cursors').get().n;
}

describe('P0-3 — a broadcast row can never be rolled back', () => {
  it('refuses to append inside an open transaction', async () => {
    await expect(
      inTransaction(async () => {
        await repo.append('chat', 'c1', 'harness.token', { delta: 'hi' });
      }),
    ).rejects.toBeInstanceOf(StreamAppendInTransactionError);

    // And nothing was written — the refusal happens before the insert, so there
    // is no half-state to reason about.
    expect(countRows()).toBe(0);
  });

  it('names the scope and kind so the offending call site is findable', async () => {
    const err = await inTransaction(async () => {
      await repo.append('run', 'r7', 'stage_run.completed', {});
    }).catch((e: unknown) => e as StreamAppendInTransactionError);

    expect(err).toBeInstanceOf(StreamAppendInTransactionError);
    expect(err.scope).toBe('run');
    expect(err.scopeId).toBe('r7');
    expect(err.kind).toBe('stage_run.completed');
  });

  it('appends normally outside a transaction, and the row survives a later rollback', async () => {
    const row = await repo.append('chat', 'c1', 'harness.token', { delta: 'hi' });
    expect(row.seq).toBe(1);
    expect(countRows()).toBe(1);

    // An unrelated transaction rolling back must not touch it. This is the
    // property the savepoint bug destroyed.
    await inTransaction(async () => {
      throw new Error('unrelated failure');
    }).catch(() => undefined);

    expect(countRows()).toBe(1);
  });

  it('leaves no transaction open after a rollback', async () => {
    await inTransaction(async () => {
      throw new Error('boom');
    }).catch(() => undefined);

    expect(isInTransaction(db)).toBe(false);
    // The connection is usable again, which is what "no transaction open"
    // actually has to mean.
    await expect(repo.append('chat', 'c2', 'harness.token', {})).resolves.toBeDefined();
  });
});
