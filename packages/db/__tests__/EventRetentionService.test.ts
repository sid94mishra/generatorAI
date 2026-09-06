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
    // A terminal kind, so these rows belong to a FINISHED turn and age alone
    // decides their fate. Rows from a turn that never finished are kept past
    // the TTL on purpose — see the class-split suite below.
    .run('session', 's1', Math.floor(Math.random() * 1_000_000), 'harness.turn_end', '{}', ts);
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

// ────────────────────────────────────────────────────────────────
// H16 — retention split by event class, unfinished turns preserved.
//
// Pruning stream_cursors by age alone deleted the streamed text that chat
// crash recovery replays. These cases pin the three-way split.
// ────────────────────────────────────────────────────────────────

function insertRow(
  db: ReturnType<typeof createDB>,
  opts: { scopeId: string; kind: string; ts: number; seq: number },
): void {
  const sqlite = (db as unknown as { session: { client: Database.Database } }).session.client;
  sqlite
    .prepare(`INSERT INTO stream_cursors (scope, scope_id, seq, kind, payload, ts) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('chat', opts.scopeId, opts.seq, opts.kind, '{}', opts.ts);
}

function remaining(db: ReturnType<typeof createDB>, scopeId: string): string[] {
  const sqlite = (db as unknown as { session: { client: Database.Database } }).session.client;
  return (
    sqlite.prepare(`SELECT kind FROM stream_cursors WHERE scope_id = ? ORDER BY seq`).all(scopeId) as Array<{
      kind: string;
    }>
  ).map((r) => r.kind);
}

describe('EventRetentionService — class split (H16)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  let db: ReturnType<typeof createDB>;

  beforeEach(() => {
    db = createDB(':memory:');
    migrateDB(db);
  });

  function service(overrides: Partial<ConstructorParameters<typeof EventRetentionService>[1]> = {}) {
    return new EventRetentionService(db, {
      enabled: true,
      eventPayloadTtlDays: 30,
      sweepIntervalMs: 60_000,
      maxDeletePerSweep: 1000,
      incrementalVacuum: false,
      ...overrides,
    });
  }

  it('drops superseded deltas from a finished turn but keeps its items', async () => {
    const now = Date.now();
    // A turn that finished 3 days ago: deltas are past the 1-day delta TTL,
    // everything is well inside the 30-day item TTL.
    insertRow(db, { scopeId: 'finished', kind: 'harness.turn_start', ts: now - 3 * DAY, seq: 1 });
    insertRow(db, { scopeId: 'finished', kind: 'harness.token', ts: now - 3 * DAY, seq: 2 });
    insertRow(db, { scopeId: 'finished', kind: 'harness.reasoning_delta', ts: now - 3 * DAY, seq: 3 });
    insertRow(db, { scopeId: 'finished', kind: 'harness.message_complete', ts: now - 3 * DAY, seq: 4 });
    insertRow(db, { scopeId: 'finished', kind: 'harness.turn_end', ts: now - 3 * DAY, seq: 5 });

    await service().sweep();

    expect(remaining(db, 'finished')).toEqual([
      'harness.turn_start',
      'harness.message_complete',
      'harness.turn_end',
    ]);
    closeDB(db);
  });

  it('keeps the deltas of a turn that never finished', async () => {
    const now = Date.now();
    // Same age, but no terminal event: the process died mid-turn and these
    // deltas are the only record of the partial answer.
    insertRow(db, { scopeId: 'crashed', kind: 'harness.turn_start', ts: now - 3 * DAY, seq: 1 });
    insertRow(db, { scopeId: 'crashed', kind: 'harness.token', ts: now - 3 * DAY, seq: 2 });

    await service().sweep();

    expect(remaining(db, 'crashed')).toEqual(['harness.turn_start', 'harness.token']);
    closeDB(db);
  });

  it('still bounds an unfinished turn once it passes the hard cutoff', async () => {
    const now = Date.now();
    // 90 days old, no terminal event. Past 2 x the 30-day item TTL, so
    // "keep unfinished turns" stops applying and the table stays bounded.
    insertRow(db, { scopeId: 'ancient', kind: 'harness.turn_start', ts: now - 90 * DAY, seq: 1 });
    insertRow(db, { scopeId: 'ancient', kind: 'harness.token', ts: now - 90 * DAY, seq: 2 });

    await service().sweep();

    expect(remaining(db, 'ancient')).toEqual([]);
    closeDB(db);
  });

  it('keeps fresh deltas of a turn still in flight', async () => {
    const now = Date.now();
    insertRow(db, { scopeId: 'live', kind: 'harness.turn_start', ts: now - 1000, seq: 1 });
    insertRow(db, { scopeId: 'live', kind: 'harness.token', ts: now - 500, seq: 2 });

    await service().sweep();

    expect(remaining(db, 'live')).toEqual(['harness.turn_start', 'harness.token']);
    closeDB(db);
  });

  it('never lets the delta TTL exceed the item TTL', async () => {
    const now = Date.now();
    insertRow(db, { scopeId: 'short', kind: 'harness.token', ts: now - 2 * DAY, seq: 1 });
    insertRow(db, { scopeId: 'short', kind: 'harness.turn_end', ts: now - 2 * DAY, seq: 2 });

    // A misconfiguration: deltas asked to live longer than items do.
    await service({ eventPayloadTtlDays: 1, deltaPayloadTtlDays: 365 }).sweep();

    expect(remaining(db, 'short')).toEqual([]);
    closeDB(db);
  });
});
