// ────────────────────────────────────────────────────────────────
// EventRetentionService tests (DB-04)
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { createDB, migrateDB, closeDB, EventRetentionService } from '../src/index.js';
import Database from 'better-sqlite3';

function insertEvent(db: ReturnType<typeof createDB>, ts: number): void {
  const sqlite = (db as unknown as { session: { client: Database.Database } }).session.client;
  sqlite
    .prepare(`INSERT INTO events (session_id, sequence_id, kind, data, timestamp) VALUES (?, ?, ?, ?, ?)`)
    .run('s1', Math.floor(Math.random() * 1_000_000), 'session.created', '{}', ts);
}

function insertStreamCursor(db: ReturnType<typeof createDB>, ts: number): void {
  const sqlite = (db as unknown as { session: { client: Database.Database } }).session.client;
  sqlite
    .prepare(
      `INSERT INTO stream_cursors (scope, scope_id, seq, kind, payload, ts) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run('session', 's1', Math.floor(Math.random() * 1_000_000), 'k', '{}', ts);
}

describe('EventRetentionService (DB-04)', () => {
  let db: ReturnType<typeof createDB>;

  beforeEach(() => {
    db = createDB(':memory:');
    migrateDB(db);
  });

  it('prunes events and stream_cursors older than TTL', async () => {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    // Old rows (100 days ago)
    insertEvent(db, now - 100 * oneDay);
    insertEvent(db, now - 100 * oneDay);
    insertStreamCursor(db, now - 100 * oneDay);
    // Fresh rows (1 day ago)
    insertEvent(db, now - oneDay);
    insertStreamCursor(db, now - oneDay);

    const svc = new EventRetentionService(db, {
      enabled: true,
      eventPayloadTtlDays: 90,
      sweepIntervalMs: 60_000,
      maxDeletePerSweep: 100,
    });
    const result = await svc.sweep();

    expect(result.eventsDeleted).toBe(2);
    expect(result.streamCursorsDeleted).toBe(1);

    const sqlite = (db as unknown as { session: { client: Database.Database } }).session.client;
    const eventsLeft = (sqlite.prepare(`SELECT COUNT(*) as c FROM events`).get() as { c: number }).c;
    const cursorsLeft = (sqlite.prepare(`SELECT COUNT(*) as c FROM stream_cursors`).get() as { c: number }).c;
    expect(eventsLeft).toBe(1);
    expect(cursorsLeft).toBe(1);

    closeDB(db);
  });

  it('respects maxDeletePerSweep cap', async () => {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    for (let i = 0; i < 10; i++) insertEvent(db, now - 100 * oneDay);

    const svc = new EventRetentionService(db, {
      enabled: true,
      eventPayloadTtlDays: 90,
      sweepIntervalMs: 60_000,
      maxDeletePerSweep: 3,
    });
    const result = await svc.sweep();
    expect(result.eventsDeleted).toBe(3);

    closeDB(db);
  });

  it('custom sweeper receives cutoff and limit', async () => {
    const svc = new EventRetentionService(db, {
      enabled: true,
      eventPayloadTtlDays: 30,
      sweepIntervalMs: 60_000,
      maxDeletePerSweep: 42,
    });
    let receivedCutoff = 0;
    let receivedLimit = 0;
    svc.registerSweeper('blob-store', async (cutoff, limit) => {
      receivedCutoff = cutoff;
      receivedLimit = limit;
      return 7;
    });

    const result = await svc.sweep();
    expect(result.customDeleted['blob-store']).toBe(7);
    expect(receivedLimit).toBe(42);
    // Cutoff should be approximately now - 30 days
    expect(Date.now() - receivedCutoff).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);

    closeDB(db);
  });

  it('start() is a no-op when disabled', () => {
    const svc = new EventRetentionService(db, {
      enabled: false,
      eventPayloadTtlDays: 90,
      sweepIntervalMs: 60_000,
      maxDeletePerSweep: 100,
    });
    svc.start(); // should not throw, should not schedule
    svc.stop(); // safe to call anyway
    closeDB(db);
  });
});
