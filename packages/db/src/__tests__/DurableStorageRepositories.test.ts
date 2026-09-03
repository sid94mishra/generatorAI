// ────────────────────────────────────────────────────────────────
// EntryRepository / RegisterRepository — the durable-storage invariants the
// DurableExecutionEngine builds on.
//
// Covers three defects found in the V2 re-audit:
//   • `entries` had no unique index for `tool_result`, so a `replay: safe`
//     re-run could insert a second settlement for one operationId and which
//     one a later read returned was arbitrary (migration 42).
//   • `RegisterRepository` re-`prepare()`d every statement on every call,
//     contradicting the P0-2 prepared-statement policy `EntryRepository`
//     follows — on the register path, which runs once per durable step.
//   • Iteration slots had no way to record completion or to be handed back
//     after a lease expiry (P0-c).
// ────────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';

import { createDB, type AppDatabase } from '../index.js';
import { migrateDB } from '../migrations/index.js';
import { EntryRepository } from '../repositories/EntryRepository.js';
import { RegisterRepository } from '../repositories/RegisterRepository.js';

function rawClient(db: AppDatabase): Database.Database {
  return (db as unknown as { session: { client: Database.Database } }).session.client;
}

let dir: string;
let db: AppDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gai-durable-repos-'));
  db = createDB(join(dir, 'd.db'));
  migrateDB(db);
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows handle */
  }
});

describe('EntryRepository — one settlement per operationId (migration 42)', () => {
  it('refuses a duplicate tool_result for the same (scope, scopeId, key)', () => {
    const repo = new EntryRepository(db);
    const params = {
      scope: 'stage_run' as const,
      scopeId: 'stage-1',
      kind: 'tool_result' as const,
      key: 'op-1',
      payload: 'first',
    };
    repo.create(params);

    expect(() => repo.create({ ...params, payload: 'second' })).toThrow(/UNIQUE|constraint/i);
    expect(repo.findToolResult('stage_run', 'stage-1', 'op-1')?.payload).toBe('first');
  });

  it('scopes the constraint — the same operationId in another scope is a different settlement', () => {
    const repo = new EntryRepository(db);
    repo.create({ scope: 'stage_run', scopeId: 'stage-1', kind: 'tool_result', key: 'op-1', payload: 'a' });
    repo.create({ scope: 'stage_run', scopeId: 'stage-2', kind: 'tool_result', key: 'op-1', payload: 'b' });

    expect(repo.findToolResult('stage_run', 'stage-1', 'op-1')?.payload).toBe('a');
    expect(repo.findToolResult('stage_run', 'stage-2', 'op-1')?.payload).toBe('b');
  });

  it('does not constrain other kinds that legitimately repeat a key', () => {
    const repo = new EntryRepository(db);
    // Signals are resolvable repeatedly — each occurrence is its own row.
    repo.create({ scope: 'stage_run', scopeId: 'stage-1', kind: 'signal', key: 'steer', payload: 1 });
    expect(() =>
      repo.create({ scope: 'stage_run', scopeId: 'stage-1', kind: 'signal', key: 'steer', payload: 2 }),
    ).not.toThrow();
  });

  it('returns the OLDEST row when a pre-migration database still holds duplicates', () => {
    // Insert two settlements behind the repository's back, the way a database
    // written before migration 42 could hold them, and prove the read is
    // deterministic rather than "whichever SQLite feels like".
    const client = rawClient(db);
    client.exec(`DROP INDEX idx_entries_tool_result_key;`);
    const repo = new EntryRepository(db);
    repo.create({ scope: 'stage_run', scopeId: 'stage-1', kind: 'tool_result', key: 'op-1', payload: 'older' });
    repo.create({ scope: 'stage_run', scopeId: 'stage-1', kind: 'tool_result', key: 'op-1', payload: 'newer' });

    expect(repo.findToolResult('stage_run', 'stage-1', 'op-1')?.payload).toBe('older');
  });

  it('migration 42 dedups an existing database before adding the unique index', () => {
    // Roll the schema back to pre-42 and plant a duplicate, then re-run the
    // migration: `CREATE UNIQUE INDEX` would fail outright without the dedup.
    const client = rawClient(db);
    client.exec(`DROP INDEX idx_entries_tool_result_key;`);
    // △ `>= 42`, not `= 42`. The runner resumes from MAX(version), so deleting
    // only row 42 while later migrations remain leaves the maximum unchanged
    // and migration 42 is silently skipped — the test would then assert
    // nothing. Every migration after 42 must be idempotent for this rollback
    // to be safe, which they are (DROP … IF EXISTS / CREATE … IF NOT EXISTS).
    client.exec(`DELETE FROM _schema_versions WHERE version >= 42;`);
    const repo = new EntryRepository(db);
    repo.create({ scope: 'stage_run', scopeId: 'stage-1', kind: 'tool_result', key: 'op-1', payload: 'older' });
    repo.create({ scope: 'stage_run', scopeId: 'stage-1', kind: 'tool_result', key: 'op-1', payload: 'newer' });

    expect(() => migrateDB(db)).not.toThrow();

    const rows = client
      .prepare(`SELECT payload FROM entries WHERE kind = 'tool_result' AND key = 'op-1'`)
      .all() as Array<{ payload: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toBe('"older"'); // oldest wins
  });
});

describe('EntryRepository — iteration slot lifecycle (P0-c)', () => {
  const SCOPE = 'automation_execution' as const;

  function makeSlot(repo: EntryRepository, index: number): string {
    return repo.create({
      scope: SCOPE,
      scopeId: 'exec-1',
      kind: 'stage_result',
      key: `iter/${String(index).padStart(10, '0')}`,
      payload: { index, variables: {}, label: `i${index}`, status: 'pending' },
    }).id;
  }

  it('updatePayload rewrites a claimed row without un-claiming it', () => {
    const repo = new EntryRepository(db);
    const id = makeSlot(repo, 0);
    repo.resolve(id, { index: 0, status: 'running' });

    repo.updatePayload(id, { index: 0, status: 'completed' });

    const row = repo.getById(id)!;
    expect(row.resolved).toBe(true);
    expect(row.payload).toMatchObject({ status: 'completed' });
    expect(repo.countPendingIterations(SCOPE, 'exec-1')).toBe(0);
  });

  it('unresolve hands a claimed row back, and only the first caller wins', () => {
    const repo = new EntryRepository(db);
    const id = makeSlot(repo, 0);
    repo.resolve(id, { index: 0, status: 'running' });

    expect(repo.unresolve(id, { index: 0, status: 'pending' })).not.toBeNull();
    expect(repo.getById(id)!.resolved).toBe(false);
    expect(repo.getById(id)!.resolvedAt).toBeUndefined();
    expect(repo.countPendingIterations(SCOPE, 'exec-1')).toBe(1);

    // Second reclaim pass on an already-pending row must not "succeed" —
    // otherwise two recovery passes could hand one slot to two workers.
    expect(repo.unresolve(id, { index: 0, status: 'pending' })).toBeNull();
  });

  it('listClaimedIterations returns claimed slots in index order, ignoring other entries', () => {
    const repo = new EntryRepository(db);
    const ids = [0, 1, 2].map((i) => makeSlot(repo, i));
    repo.create({ scope: SCOPE, scopeId: 'exec-1', kind: 'tool_result', key: 'op-1', payload: 'x' });
    repo.resolve(ids[2]!, { index: 2, status: 'running' });
    repo.resolve(ids[0]!, { index: 0, status: 'running' });

    const claimed = repo.listClaimedIterations(SCOPE, 'exec-1');
    expect(claimed.map((e) => (e.payload as { index: number }).index)).toEqual([0, 2]);
  });
});

describe('RegisterRepository — P0-2 prepared-statement policy', () => {
  it('never calls prepare() again once constructed', () => {
    const repo = new RegisterRepository(db);
    const prepareSpy = vi.spyOn(rawClient(db), 'prepare');

    repo.set('stage_run', 's1', 'k', { a: 1 });
    repo.get('stage_run', 's1', 'k');
    repo.listByScope('stage_run', 's1');
    repo.cas('stage_run', 's1', 'k', 1, { a: 2 });
    repo.deleteByScope('stage_run', 's1');

    expect(prepareSpy).not.toHaveBeenCalled();
    prepareSpy.mockRestore();
  });

  it('still behaves identically — set/get/cas/list/delete round-trip', () => {
    const repo = new RegisterRepository(db);

    const first = repo.set('stage_run', 's1', 'op.state/a', { state: 'intent' });
    expect(first.version).toBe(0);
    expect(repo.get('stage_run', 's1', 'op.state/a')?.value).toEqual({ state: 'intent' });

    const second = repo.set('stage_run', 's1', 'op.state/a', { state: 'settled' });
    expect(second.version).toBe(1);

    // CAS on a stale version is refused; on the current one it succeeds.
    expect(repo.cas('stage_run', 's1', 'op.state/a', 0, { state: 'x' })).toBeNull();
    expect(repo.cas('stage_run', 's1', 'op.state/a', 1, { state: 'x' })?.version).toBe(2);

    repo.set('stage_run', 's1', 'op.state/b', 1);
    expect(repo.listByScope('stage_run', 's1').map((r) => r.key)).toEqual([
      'op.state/a',
      'op.state/b',
    ]);

    repo.deleteByScope('stage_run', 's1');
    expect(repo.listByScope('stage_run', 's1')).toEqual([]);
  });
});
