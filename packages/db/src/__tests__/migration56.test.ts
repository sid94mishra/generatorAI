// ────────────────────────────────────────────────────────────────
// Migration v56 `session_parity` (workflow overhaul P02 WP-2.10).
//
// Builds a v55 database through the real migrations, fills it with chats,
// their messages (one partial), a chat session, a stage session with its
// transcript and two automations, and migrates it. Chats, messages and
// sessions must be unchanged apart from the new `complete` column (R-3);
// automations get the PD-18 default mode.
// ────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { closeDB, createDB, DrizzleChatMessageRepository, type AppDatabase } from '../index.js';
import { migrateDB } from '../migrations/index.js';

const open: AppDatabase[] = [];
afterEach(() => {
  for (const db of open.splice(0)) closeDB(db);
});

const raw = (db: AppDatabase): Database.Database =>
  (db as unknown as { session: { client: Database.Database } }).session.client;

const T = 1_790_000_000;

function seedV55(s: Database.Database): void {
  const session = s.prepare(
    `INSERT INTO sessions (id, name, status, created_at, updated_at, conversation_id, owner_type, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  session.run('s-c1', 'Chat one', 'active', T, T, 'conv-c1', 'chat', 'c1');
  session.run('s-stage', 'Stage', 'closed', T, T, 'conv-stage', 'stage_run', 'sr-x');
  s.prepare(
    `INSERT INTO chats (id, name, session_id, created_at, updated_at, harness_config, default_agent_mode) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('c1', 'Chat', 's-c1', T, T, '{"model":"claude"}', 'auto');
  const msg = s.prepare(`INSERT INTO chat_messages (id, session_id, role, content, timestamp, chat_id, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  msg.run('m1', 's-c1', 'user', 'hello', T, 'c1', '{"turnId":"t1"}');
  msg.run('m2', 's-c1', 'assistant', 'done ✓', T + 1, 'c1', '{"turnId":"t1"}');
  msg.run('m3', 's-c1', 'assistant', 'stopped half', T + 2, 'c1', '{"turnId":"t2","partial":true}');
  msg.run('m4', 's-c1', 'assistant', 'odd metadata', T + 3, 'c1', 'not json');
  msg.run('ms1', 's-stage', 'assistant', 'stage partial', T + 4, null, '{"stageRunId":"sr-x","partial":true}');
  const auto = s.prepare(`INSERT INTO automations (id, name, trigger_type, workflow_ids, created_at, updated_at) VALUES (?, ?, ?, '[]', ?, ?)`);
  auto.run('a1', 'Nightly', 'schedule', T, T);
  auto.run('a2', 'Hook', 'webhook', T, T);
}

const CHAT_COLUMNS = {
  chats: ['id', 'name', 'session_id', 'harness_config', 'default_agent_mode', 'created_at', 'updated_at'],
  chat_messages: ['id', 'session_id', 'role', 'content', 'timestamp', 'metadata', 'chat_id'],
  sessions: ['id', 'name', 'status', 'conversation_id', 'owner_type', 'owner_id', 'created_at', 'updated_at'],
};

function hash(s: Database.Database) {
  return Object.fromEntries(
    Object.entries(CHAT_COLUMNS).map(([t, cols]) => {
      const rows = s.prepare(`SELECT ${cols.join(', ')} FROM ${t} ORDER BY id`).all();
      return [t, { n: rows.length, hash: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }];
    }),
  );
}

describe('migration v56 session_parity', () => {
  it('keeps chats, messages and sessions; marks partial messages incomplete; gives automations a mode', () => {
    const db = createDB(':memory:');
    open.push(db);
    migrateDB(db, { targetVersion: 54 });
    migrateDB(db, { targetVersion: 55 });
    const s = raw(db);
    seedV55(s);
    const before = hash(s);

    migrateDB(db, { targetVersion: 56 });

    expect((s.prepare(`SELECT MAX(version) AS v FROM _schema_versions`).get() as { v: number }).v).toBe(56);
    expect(hash(s)).toEqual(before);
    expect(s.prepare(`SELECT id, complete FROM chat_messages ORDER BY id`).all()).toEqual([
      { id: 'm1', complete: 1 },
      { id: 'm2', complete: 1 },
      { id: 'm3', complete: 0 },
      { id: 'm4', complete: 1 },
      { id: 'ms1', complete: 0 },
    ]);
    expect(s.prepare(`SELECT id, permission_mode FROM automations ORDER BY id`).all()).toEqual([
      { id: 'a1', permission_mode: 'acceptEdits' },
      { id: 'a2', permission_mode: 'acceptEdits' },
    ]);
    expect(s.pragma('foreign_key_check')).toEqual([]);
  });

  it('the message repository writes and reads `complete` for assistant rows (WP-2.9)', async () => {
    const db = createDB(':memory:');
    open.push(db);
    migrateDB(db);
    raw(db).prepare(`INSERT INTO sessions (id, name, status, created_at, updated_at) VALUES ('s', 's', 'active', ?, ?)`).run(T, T);
    const repo = new DrizzleChatMessageRepository(db);
    const at = new Date(T * 1000);
    await repo.create({ id: 'u', sessionId: 's', role: 'user', content: 'q', timestamp: at });
    await repo.create({ id: 'a1', sessionId: 's', role: 'assistant', content: 'a', complete: true, timestamp: at });
    await repo.create({ id: 'a2', sessionId: 's', role: 'assistant', content: 'half', complete: false, timestamp: at });
    await repo.create({ id: 'a3', sessionId: 's', role: 'assistant', content: 'old', metadata: { partial: true }, timestamp: at });
    const rows = await repo.getBySessionId('s');
    expect(Object.fromEntries(rows.map((m) => [m.id, m.complete]))).toEqual({ u: undefined, a1: true, a2: false, a3: false });
  });
});
