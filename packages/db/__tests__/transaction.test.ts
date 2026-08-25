// ────────────────────────────────────────────────────────────────
// W03 — the transaction primitive.
//
// Two invariants, both of which failed silently before:
//
//   P0-3  A row that has been broadcast can never be rolled back. better-
//         sqlite3 turns `.transaction()` into a SAVEPOINT when a transaction is
//         already open, so a stream append nested inside `withTransaction` was
//         a savepoint the outer rollback could undo — after subscribers had
//         already seen the event.
//
//   P1-5  A transaction that times out must not release the queue while its
//         function is still running. It used to, and the zombie's remaining
//         statements landed inside the NEXT caller's transaction.
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createDB,
  migrateDB,
  withTransaction,
  isInTransaction,
  TransactionTimeoutError,
  type AppDatabase,
} from '../src/index.js';
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

/** Reads straight through the driver so it cannot be fooled by a cache. */
function countRows(): number {
  const sqlite = (db as unknown as { session: { client: { prepare: (s: string) => { get: () => { n: number } } } } })
    .session.client;
  return sqlite.prepare('SELECT COUNT(*) AS n FROM stream_cursors').get().n;
}

describe('P0-3 — a broadcast row can never be rolled back', () => {
  it('refuses to append inside an open transaction', async () => {
    await expect(
      withTransaction(db, async () => {
        await repo.append('chat', 'c1', 'harness.token', { delta: 'hi' });
      }),
    ).rejects.toBeInstanceOf(StreamAppendInTransactionError);

    // And nothing was written — the refusal happens before the insert, so there
    // is no half-state to reason about.
    expect(countRows()).toBe(0);
  });

  it('names the scope and kind so the offending call site is findable', async () => {
    const err = await withTransaction(db, async () => {
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
    await withTransaction(db, async () => {
      throw new Error('unrelated failure');
    }).catch(() => undefined);

    expect(countRows()).toBe(1);
  });

  it('leaves no transaction open after a rollback', async () => {
    await withTransaction(db, async () => {
      throw new Error('boom');
    }).catch(() => undefined);

    expect(isInTransaction(db)).toBe(false);
    // The connection is usable again, which is what "no transaction open"
    // actually has to mean.
    await expect(repo.append('chat', 'c2', 'harness.token', {})).resolves.toBeDefined();
  });
});

describe('P1-5 — a timed-out transaction does not release the queue early', () => {
  it('rejects with a typed error and rolls back', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });

    const slow = withTransaction(
      db,
      async () => {
        await gate;
      },
      { timeoutMs: 30 },
    );

    await expect(slow).rejects.toBeInstanceOf(TransactionTimeoutError);
    release?.();
  });

  it('does not start the next transaction until the timed-out one has settled', async () => {
    // The failure this pins: the queue used to advance on timeout, so the next
    // BEGIN opened underneath a function that was still issuing statements, and
    // that function's remaining writes were absorbed into a stranger's
    // transaction.
    const order: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });

    const slow = withTransaction(
      db,
      async () => {
        order.push('slow:start');
        await gate;
        order.push('slow:end');
      },
      { timeoutMs: 30 },
    ).catch(() => order.push('slow:rejected'));

    // Queued behind the slow one.
    const next = withTransaction(db, async () => {
      order.push('next:body');
    });

    await new Promise((r) => setTimeout(r, 80)); // past the deadline

    // The caller has already been told — it must not wait on the very function
    // that blew its deadline. But `next` has NOT begun, because the queue is
    // still held by the zombie.
    expect(order).toContain('slow:rejected');
    expect(order).not.toContain('next:body');
    expect(order).not.toContain('slow:end');

    release?.();
    await slow;
    await next;

    // `next:body` must come after `slow:end`, never between start and end.
    expect(order.indexOf('next:body')).toBeGreaterThan(order.indexOf('slow:end'));
  });

  it('a zombie write lands outside any transaction, not inside the next one', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });

    const slow = withTransaction(
      db,
      async () => {
        await gate;
        // Issued long after the deadline, so it auto-commits on its own.
        await repo.append('chat', 'zombie', 'harness.token', { delta: 'late' });
      },
      { timeoutMs: 30 },
    ).catch(() => undefined);

    await new Promise((r) => setTimeout(r, 80));
    release?.();
    await slow;

    // It committed independently rather than being swallowed by, or rolled back
    // with, someone else's transaction.
    expect(countRows()).toBe(1);

    await withTransaction(db, async () => {
      throw new Error('unrelated');
    }).catch(() => undefined);

    expect(countRows()).toBe(1);
  });
});

describe('withTransaction — serialisation', () => {
  it('never opens two transactions at once on one handle', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    await Promise.all(
      Array.from({ length: 8 }, () =>
        withTransaction(db, async () => {
          concurrent += 1;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((r) => setTimeout(r, 5));
          concurrent -= 1;
        }),
      ),
    );

    expect(maxConcurrent).toBe(1);
  });

  it('a failing transaction does not poison the queue', async () => {
    await withTransaction(db, async () => {
      throw new Error('first fails');
    }).catch(() => undefined);

    await expect(withTransaction(db, async () => 'second succeeds')).resolves.toBe(
      'second succeeds',
    );
  });
});
