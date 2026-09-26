// ────────────────────────────────────────────────────────────────
// Renumbered migrations (the redesign ↔ Workflow Overhaul merge).
//
// The redesign branch shipped `chat_list_summary_columns`,
// `chat_list_activity_indexes` and `background_task_cancel_attribution` as
// v55–v57; after the merge they are v61–v63 behind the Overhaul's v55–v60.
// A database migrated on the redesign branch must reach the merged head with
// every Overhaul migration applied and the redesign's columns intact, and a
// database recorded by an unknown build must fail loudly.
// ────────────────────────────────────────────────────────────────

import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { closeDB, createDB, type AppDatabase } from '../index.js';
import { MIGRATIONS, forgetRenumberedMigrations, migrateDB } from '../migrations/index.js';

const open: AppDatabase[] = [];
afterEach(() => {
  for (const db of open.splice(0)) closeDB(db);
});

const raw = (db: AppDatabase): Database.Database =>
  (db as unknown as { session: { client: Database.Database } }).session.client;

const columnsOf = (s: Database.Database, t: string): string[] =>
  (s.pragma(`table_info(${t})`) as Array<{ name: string }>).map((c) => c.name);

const REDESIGN = ['chat_list_summary_columns', 'chat_list_activity_indexes', 'background_task_cancel_attribution'];
const HEAD = Math.max(...MIGRATIONS.map((m) => m.version));

/** A v54 database that then ran the redesign branch's v55–v57, as that branch recorded them. */
function redesignBranchDb(): { db: AppDatabase; s: Database.Database } {
  const db = createDB(':memory:');
  open.push(db);
  migrateDB(db, { targetVersion: 54 });
  const s = raw(db);
  const T = 1_790_000_000;
  s.prepare(
    `INSERT INTO sessions (id, name, status, created_at, updated_at, conversation_id, owner_type, owner_id) VALUES ('s1', 'Chat', 'active', ?, ?, 'conv-1', 'chat', 'c1')`,
  ).run(T, T);
  s.prepare(
    `INSERT INTO chats (id, name, session_id, created_at, updated_at, harness_config, default_agent_mode, orchestrator_mode) VALUES ('c1', 'Chat', 's1', ?, ?, '{}', 'auto', 0)`,
  ).run(T, T);
  s.prepare(
    `INSERT INTO chat_messages (id, session_id, role, content, timestamp, chat_id) VALUES ('m1', 's1', 'assistant', 'done', ?, 'c1')`,
  ).run(T + 5);
  REDESIGN.forEach((name, i) => {
    const m = MIGRATIONS.find((x) => x.name === name)!;
    for (const stmt of m.sql) s.exec(stmt);
    s.prepare(`INSERT INTO _schema_versions (version, applied_at, name) VALUES (?, ?, ?)`).run(55 + i, Date.now(), name);
  });
  return { db, s };
}

describe('renumbered migrations', () => {
  it('the redesign migrations follow the Overhaul migrations, contiguously', () => {
    const versions = MIGRATIONS.map((m) => m.version).sort((a, b) => a - b);
    versions.forEach((v, i) => expect(v).toBe(i + 1));
    expect(REDESIGN.map((name) => MIGRATIONS.find((m) => m.name === name)!.version)).toEqual([61, 62, 63]);
    for (const v of [55, 56, 57, 58, 59, 60]) {
      expect(REDESIGN).not.toContain(MIGRATIONS.find((m) => m.version === v)!.name);
    }
  });

  it('a database migrated on the redesign branch re-runs from v55 and reaches the head intact', () => {
    const { db, s } = redesignBranchDb();
    migrateDB(db);

    const recorded = s.prepare(`SELECT version, name FROM _schema_versions WHERE version >= 55 ORDER BY version`).all() as Array<{
      version: number;
      name: string;
    }>;
    expect(recorded).toEqual(
      MIGRATIONS.filter((m) => m.version >= 55)
        .sort((a, b) => a.version - b.version)
        .map((m) => ({ version: m.version, name: m.name })),
    );
    expect(recorded.at(-1)!.version).toBe(HEAD);
    // The Overhaul's engine tables exist (v57) and so do the redesign's columns (v61–v63).
    expect(columnsOf(s, 'chat_messages')).toContain('turn_role');
    expect(columnsOf(s, 'chats')).toEqual(expect.arrayContaining(['last_activity_at', 'last_turn_status', 'changes_files', 'background_task_cancelled_by', 'created_by_principal']));
    expect(s.prepare(`SELECT id, name, last_activity_at FROM chats`).all()).toEqual([
      { id: 'c1', name: 'Chat', last_activity_at: (1_790_000_000 + 5) * 1000 },
    ]);
    const triggers = (s.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'chats'`).all() as Array<{ name: string }>).map((t) => t.name);
    expect(triggers).toEqual(expect.arrayContaining(['chats_last_activity_insert_not_null', 'chats_last_activity_update_not_null']));
    expect(s.pragma('foreign_key_check')).toEqual([]);

    // Nothing is left to forget, and migrating again changes nothing.
    expect(forgetRenumberedMigrations(s)).toBeUndefined();
    migrateDB(db);
    expect((s.prepare(`SELECT MAX(version) AS v FROM _schema_versions`).get() as { v: number }).v).toBe(HEAD);
  });

  it('a fresh database reaches the head through the baseline with the current names', () => {
    const db = createDB(':memory:');
    open.push(db);
    migrateDB(db);
    const s = raw(db);
    expect(forgetRenumberedMigrations(s)).toBeUndefined();
    expect((s.prepare(`SELECT MAX(version) AS v FROM _schema_versions`).get() as { v: number }).v).toBe(HEAD);
    expect(columnsOf(s, 'chats')).toContain('last_activity_at');
  });

  it('a version recorded under a name this build does not know fails loudly', () => {
    const db = createDB(':memory:');
    open.push(db);
    migrateDB(db);
    const s = raw(db);
    s.prepare(`UPDATE _schema_versions SET name = 'from_the_future' WHERE version = 56`).run();
    expect(() => forgetRenumberedMigrations(s)).toThrow(/v56 .*from_the_future/);
  });
});
