// ────────────────────────────────────────────────────────────────
// Migration v57 `workflow_engine_v2` (workflow overhaul P03 WP-3.2, R-3).
//
// Builds a v56 database through the real migrations and fills it with what
// the developer DB holds: a chat with messages, an orchestrator worker chat
// whose parent is a stage run, a definition with its version, a run with two
// stage runs, their stage sessions and transcripts, a v1 session allocation,
// run-scoped artifacts/entries/checkpoints and an automation execution.
// After v57:
//   - chats, chat sessions and chat messages are unchanged apart from the
//     new NULL `turn_role` (hash over every pre-v57 column);
//   - the stage sessions and exactly their messages are gone;
//   - definitions and versions are untouched;
//   - the v2 run tables exist, the v1 allocation tables do not;
//   - `foreign_key_check` is empty; a replay of v57 is a no-op;
//   - a fresh database reaches v57 through the baseline.
// ────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { closeDB, createDB, type AppDatabase } from '../index.js';
import { chooseMigrationRoute, migrateDB } from '../migrations/index.js';

const open: AppDatabase[] = [];
afterEach(() => {
  for (const db of open.splice(0)) closeDB(db);
});

const raw = (db: AppDatabase): Database.Database =>
  (db as unknown as { session: { client: Database.Database } }).session.client;

const T = 1_790_000_000;

function seedV56(s: Database.Database): void {
  const session = s.prepare(
    `INSERT INTO sessions (id, name, status, created_at, updated_at, conversation_id, owner_type, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  session.run('s-c1', 'Chat one', 'active', T, T, 'conv-c1', 'chat', 'c1');
  session.run('s-worker', 'Worker', 'active', T, T, 'conv-w', 'chat', 'cw');
  session.run('s-sr1', 'Stage 1', 'closed', T, T, 'conv-sr1', 'stage_run', 'sr1');
  session.run('s-sr2', 'Stage 2', 'closed', T, T, 'conv-sr2', 'stage_run', 'sr2');
  const chat = s.prepare(
    `INSERT INTO chats (id, name, session_id, created_at, updated_at, harness_config, parent_chat_id, orchestrator_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  chat.run('c1', 'Chat', 's-c1', T, T, '{"model":"claude"}', null, 0);
  // An orchestrator worker: a chat whose parent is a stage run (P02).
  chat.run('cw', 'Worker', 's-worker', T, T, null, 'sr1', 0);
  const msg = s.prepare(
    `INSERT INTO chat_messages (id, session_id, role, content, timestamp, chat_id, metadata, complete) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  msg.run('m1', 's-c1', 'user', 'hello', T, 'c1', '{"turnId":"t1"}', 1);
  msg.run('m2', 's-c1', 'assistant', 'done ✓', T + 1, 'c1', '{"turnId":"t1"}', 1);
  msg.run('m3', 's-c1', 'assistant', 'stopped', T + 2, 'c1', '{"partial":true}', 0);
  msg.run('mw', 's-worker', 'assistant', 'worker result', T + 3, 'cw', null, 1);
  msg.run('ms1', 's-sr1', 'user', 'stage prompt', T + 4, null, '{"stageRunId":"sr1"}', 1);
  msg.run('ms2', 's-sr1', 'assistant', 'stage answer', T + 5, null, '{"stageRunId":"sr1"}', 1);
  msg.run('ms3', 's-sr2', 'assistant', 'stage two', T + 6, null, '{"stageRunId":"sr2"}', 1);

  s.prepare(
    `INSERT INTO workflow_definitions (id, name, status, revision, current_version_id, spec, created_at, updated_at) VALUES ('d1', 'Def', 'published', 1, 'v1', '{"session":{}}', ?, ?)`,
  ).run(T, T);
  s.prepare(
    `INSERT INTO stage_definitions (id, workflow_definition_id, key, name, ordinal, spec, created_at, updated_at) VALUES ('sd1', 'd1', 'a', 'A', 0, '{"kind":"agent"}', ?, ?)`,
  ).run(T, T);
  s.prepare(
    `INSERT INTO workflow_definition_versions (id, workflow_definition_id, version, content_hash, kind, spec, created_at) VALUES ('v1', 'd1', 1, 'h', 'published', '{}', ?)`,
  ).run(T);
  s.prepare(
    `INSERT INTO workflow_runs (id, workflow_definition_id, definition_version_id, name, status, session_mode, created_at, updated_at) VALUES ('r1', 'd1', 'v1', 'run', 'running', 'per-stage', ?, ?)`,
  ).run(T, T);
  const sr = s.prepare(`INSERT INTO stage_runs (id, workflow_run_id, stage_key, session_id, name, status, created_at) VALUES (?, 'r1', 'a', ?, 'A', ?, ?)`);
  sr.run('sr1', 's-sr1', 'completed', T);
  sr.run('sr2', 's-sr2', 'running', T);
  s.prepare(`INSERT INTO session_allocations (id, workflow_run_id, mode, shared_ref_count, created_at) VALUES ('al1', 'r1', 'per-stage', 0, ?)`).run(T);
  s.prepare(`INSERT INTO stage_session_maps (id, allocation_id, stage_run_id, session_id) VALUES ('sm1', 'al1', 'sr2', 's-sr2')`).run();
  s.prepare(`INSERT INTO artifacts (id, session_id, name, path, size, direction, created_at, workflow_run_id) VALUES ('ar1', 's-sr1', 'out.md', 'out.md', 1, 'out', ?, 'r1')`).run(T);
  s.prepare(`INSERT INTO entries (id, scope, scope_id, kind, key, payload, created_at) VALUES ('e1', 'stage_run', 'sr1', 'tool_result', 'k', 'p', ?)`).run(T);
  s.prepare(`INSERT INTO automations (id, name, trigger_type, workflow_ids, created_at, updated_at) VALUES ('a1', 'Nightly', 'schedule', '["d1"]', ?, ?)`).run(T, T);
  s.prepare(`INSERT INTO automation_executions (id, automation_id, status, triggered_by, created_at) VALUES ('ae1', 'a1', 'running', 'schedule', ?)`).run(T);
  s.prepare(
    `INSERT INTO automation_execution_runs (id, execution_id, workflow_run_id, workflow_definition_id, created_at) VALUES ('aer1', 'ae1', 'r1', 'd1', ?)`,
  ).run(T);
}

const CHAT_COLUMNS = {
  chats: ['id', 'name', 'session_id', 'harness_config', 'parent_chat_id', 'orchestrator_mode', 'created_at', 'updated_at'],
  chat_messages: ['id', 'session_id', 'role', 'content', 'timestamp', 'metadata', 'chat_id', 'complete'],
  sessions: ['id', 'name', 'status', 'conversation_id', 'owner_type', 'owner_id', 'created_at', 'updated_at'],
};

function chatHash(s: Database.Database) {
  return Object.fromEntries(
    Object.entries(CHAT_COLUMNS).map(([t, cols]) => {
      const where = t === 'chats' ? '' : t === 'sessions' ? `WHERE owner_type = 'chat'` : `WHERE session_id IN (SELECT id FROM sessions WHERE owner_type = 'chat')`;
      const rows = s.prepare(`SELECT ${cols.join(', ')} FROM ${t} ${where} ORDER BY id`).all();
      return [t, { n: rows.length, hash: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }];
    }),
  );
}

function definitionHash(s: Database.Database): string {
  const rows = ['workflow_definitions', 'stage_definitions', 'stage_edges', 'workflow_definition_versions'].map((t) =>
    s.prepare(`SELECT * FROM ${t} ORDER BY id`).all(),
  );
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

const count = (s: Database.Database, sqlText: string) => (s.prepare(sqlText).get() as { n: number }).n;
const tableExists = (s: Database.Database, t: string) =>
  !!s.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t);

describe('migration v57 workflow_engine_v2', () => {
  it('keeps chats and definitions, purges exactly the run history, and creates the v2 run tables', () => {
    const db = createDB(':memory:');
    open.push(db);
    migrateDB(db, { targetVersion: 54 });
    migrateDB(db, { targetVersion: 56 });
    const s = raw(db);
    seedV56(s);
    const chatsBefore = chatHash(s);
    const defsBefore = definitionHash(s);
    const messagesBefore = count(s, `SELECT COUNT(*) AS n FROM chat_messages`);
    const stageMessages = count(s, `SELECT COUNT(*) AS n FROM chat_messages WHERE session_id IN ('s-sr1', 's-sr2')`);

    migrateDB(db, { targetVersion: 57 });

    expect((s.prepare(`SELECT MAX(version) AS v FROM _schema_versions`).get() as { v: number }).v).toBe(57);
    // Chats: unchanged apart from the new column, which is NULL.
    expect(chatHash(s)).toEqual(chatsBefore);
    expect(count(s, `SELECT COUNT(*) AS n FROM chat_messages WHERE turn_role IS NOT NULL`)).toBe(0);
    expect(s.prepare(`SELECT id, parent_chat_id FROM chats WHERE id = 'cw'`).get()).toEqual({ id: 'cw', parent_chat_id: 'sr1' });
    // Stage sessions and exactly their messages are gone.
    expect(count(s, `SELECT COUNT(*) AS n FROM chat_messages`)).toBe(messagesBefore - stageMessages);
    expect(count(s, `SELECT COUNT(*) AS n FROM sessions WHERE owner_type = 'stage_run'`)).toBe(0);
    expect(count(s, `SELECT COUNT(*) AS n FROM artifacts`)).toBe(0);
    expect(count(s, `SELECT COUNT(*) AS n FROM entries WHERE scope = 'stage_run'`)).toBe(0);
    // Definitions untouched; run history dropped; automations cancelled, not deleted.
    expect(definitionHash(s)).toBe(defsBefore);
    expect(count(s, `SELECT COUNT(*) AS n FROM workflow_runs`)).toBe(0);
    expect(count(s, `SELECT COUNT(*) AS n FROM automation_execution_runs`)).toBe(0);
    expect(s.prepare(`SELECT status FROM automation_executions WHERE id = 'ae1'`).get()).toEqual({ status: 'cancelled' });
    // The v2 tables, and the v1 allocator tables gone.
    for (const t of ['stage_attempts', 'run_sessions', 'workflow_timers', 'workflow_outbox', 'scheduler_journal', 'engine_lock']) {
      expect(tableExists(s, t), t).toBe(true);
    }
    expect(tableExists(s, 'session_allocations')).toBe(false);
    expect(tableExists(s, 'stage_session_maps')).toBe(false);
    const runCols = new Set((s.pragma(`table_info(workflow_runs)`) as Array<{ name: string }>).map((c) => c.name));
    for (const c of ['owner_epoch', 'idempotency_key', 'trigger', 'run_overrides', 'root_run_id', 'permission_mode']) expect(runCols.has(c), c).toBe(true);
    expect(runCols.has('session_mode')).toBe(false);
    const stageCols = new Set((s.pragma(`table_info(stage_runs)`) as Array<{ name: string }>).map((c) => c.name));
    for (const c of ['instance_path', 'scope_id', 'loop_state', 'iteration_index', 'item_index', 'amended_at', 'lease_owner']) {
      expect(stageCols.has(c), c).toBe(true);
    }
    expect(s.pragma('foreign_key_check')).toEqual([]);
    const log = s.prepare(`SELECT message FROM _migration_log WHERE version = 57`).all() as Array<{ message: string }>;
    expect(log.map((l) => l.message)).toEqual(['dropped 1 workflow run(s) and 2 stage/run session(s) with their messages']);

    // A replay (tests roll `_schema_versions` back) changes nothing.
    s.exec(`DELETE FROM _schema_versions WHERE version = 57`);
    migrateDB(db);
    expect(chatHash(s)).toEqual(chatsBefore);
    expect((s.prepare(`SELECT MAX(version) AS v FROM _schema_versions`).get() as { v: number }).v).toBe(57);
  });

  it('the run tables enforce the v2 state machines and the chat table takes any turn role', () => {
    const db = createDB(':memory:');
    open.push(db);
    expect(chooseMigrationRoute(raw(db))).toEqual({ kind: 'baseline' });
    migrateDB(db);
    const s = raw(db);
    s.prepare(`INSERT INTO workflow_definitions (id, name, spec, created_at, updated_at) VALUES ('d', 'D', '{}', ?, ?)`).run(T, T);
    s.prepare(`INSERT INTO workflow_definition_versions (id, workflow_definition_id, version, content_hash, kind, spec, created_at) VALUES ('v', 'd', 1, 'h', 'published', '{}', ?)`).run(T);
    const run = s.prepare(
      `INSERT INTO workflow_runs (id, workflow_definition_id, definition_version_id, name, status, permission_mode, root_run_id, created_at, updated_at) VALUES (?, 'd', 'v', 'r', ?, 'default', ?, ?, ?)`,
    );
    run.run('r', 'waiting', 'r', T, T);
    expect(() => run.run('r2', 'queued', 'r2', T, T)).toThrow(/CHECK/);
    const inst = s.prepare(
      `INSERT INTO stage_runs (id, workflow_run_id, stage_key, name, instance_path, status, created_at, updated_at) VALUES (?, 'r', 'a', 'A', ?, ?, ?, ?)`,
    );
    inst.run('i1', 'a', 'retry_wait', T, T);
    expect(() => inst.run('i2', 'b', 'queued', T, T)).toThrow(/CHECK/);
    expect(() => inst.run('i3', 'a', 'pending', T, T)).toThrow(/UNIQUE/);
    s.prepare(`INSERT INTO sessions (id, name, status, created_at, updated_at) VALUES ('s', 's', 'active', ?, ?)`).run(T, T);
    s.prepare(`INSERT INTO chat_messages (id, session_id, role, content, timestamp, turn_role) VALUES ('m', 's', 'user', 'x', ?, 'a_future_role')`).run(T);
    expect(() => s.prepare(`INSERT INTO engine_lock (id, owner_id) VALUES (2, 'x')`).run()).toThrow(/CHECK/);
  });
});
