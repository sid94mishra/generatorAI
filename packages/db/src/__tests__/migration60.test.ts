// ────────────────────────────────────────────────────────────────
// Migration v60 `agent_integration` (workflow overhaul P06, R-3).
//
// Builds a v59 database through the real migrations and fills it with
// chats, their messages and sessions, a stage session, and a definition.
// After v60:
//   - chats, chat messages and sessions are unchanged (hash over every
//     column they had before; the new `chats.created_by_principal` is NULL);
//   - `chat_workflow_runs` exists and links a chat to a run;
//   - `workflow_definitions.authored_by` exists (NULL for existing rows);
//   - running v60 again changes nothing, and `foreign_key_check` is empty.
// ────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { closeDB, createDB, type AppDatabase } from '../index.js';
import { migrateDB } from '../migrations/index.js';
import { runV60 } from '../migrations/v60_agent_integration.js';

const open: AppDatabase[] = [];
afterEach(() => {
  for (const db of open.splice(0)) closeDB(db);
});

const raw = (db: AppDatabase): Database.Database =>
  (db as unknown as { session: { client: Database.Database } }).session.client;

const T = 1_790_000_000;

function seedV59(s: Database.Database): void {
  const session = s.prepare(
    `INSERT INTO sessions (id, name, status, created_at, updated_at, conversation_id, owner_type, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  session.run('s-c1', 'Chat one', 'active', T, T, 'conv-c1', 'chat', 'c1');
  session.run('s-c2', 'Orchestrator', 'active', T, T, 'conv-c2', 'chat', 'c2');
  session.run('s-stage', 'Stage', 'closed', T, T, 'conv-stage', 'stage_run', 'sr-x');
  const chat = s.prepare(
    `INSERT INTO chats (id, name, session_id, created_at, updated_at, harness_config, default_agent_mode, orchestrator_mode, agent_overrides) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  chat.run('c1', 'Chat', 's-c1', T, T, '{"model":"claude"}', 'auto', 0, null);
  chat.run('c2', 'Orchestrator', 's-c2', T, T, '{}', 'auto', 1, '{"tools":{"browser":false}}');
  const msg = s.prepare(
    `INSERT INTO chat_messages (id, session_id, role, content, timestamp, chat_id, metadata, complete, turn_role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  msg.run('m1', 's-c1', 'user', 'hello', T, 'c1', '{"turnId":"t1"}', 1, null);
  msg.run('m2', 's-c1', 'assistant', 'done ✓', T + 1, 'c1', '{"turnId":"t1"}', 1, null);
  msg.run('m3', 's-c2', 'assistant', 'spawning', T + 2, 'c2', '{"turnId":"t2"}', 1, null);
  msg.run('ms1', 's-stage', 'assistant', 'stage answer', T + 3, null, '{"stageRunId":"sr-x"}', 1, 'prompt');
  s.prepare(
    `INSERT INTO workflow_definitions (id, name, status, revision, spec, created_at, updated_at) VALUES (?, ?, 'published', 1, '{}', ?, ?)`,
  ).run('wd1', 'Review', T, T);
}

const CHAT_TABLES = ['chats', 'chat_messages', 'sessions'] as const;

/** Rows over the columns each table had BEFORE v60 (an added column must not change a value). */
function hash(s: Database.Database, columns: Record<string, string[]>): Record<string, { n: number; hash: string }> {
  return Object.fromEntries(
    CHAT_TABLES.map((t) => {
      const rows = s.prepare(`SELECT ${columns[t]!.map((c) => `"${c}"`).join(', ')} FROM ${t} ORDER BY id`).all();
      return [t, { n: rows.length, hash: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }];
    }),
  );
}

const columnsOf = (s: Database.Database, t: string): string[] => (s.pragma(`table_info(${t})`) as Array<{ name: string }>).map((c) => c.name);

describe('migration v60 agent_integration', () => {
  it('keeps chats, messages and sessions; adds the chat run links, the creating principal and the definition author', () => {
    const db = createDB(':memory:');
    open.push(db);
    migrateDB(db, { targetVersion: 54 });
    migrateDB(db, { targetVersion: 59 });
    const s = raw(db);
    seedV59(s);
    const before = Object.fromEntries(CHAT_TABLES.map((t) => [t, columnsOf(s, t)]));
    const hashed = hash(s, before);

    migrateDB(db, { targetVersion: 60 });

    expect((s.prepare(`SELECT MAX(version) AS v FROM _schema_versions`).get() as { v: number }).v).toBe(60);
    expect(hash(s, before)).toEqual(hashed);
    expect(columnsOf(s, 'chats')).toContain('created_by_principal');
    expect(s.prepare(`SELECT COUNT(*) AS n FROM chats WHERE created_by_principal IS NOT NULL`).get()).toEqual({ n: 0 });
    expect(columnsOf(s, 'workflow_definitions')).toContain('authored_by');
    expect(s.prepare(`SELECT authored_by FROM workflow_definitions`).all()).toEqual([{ authored_by: null }]);
    expect(columnsOf(s, 'chat_workflow_runs')).toEqual(['chat_id', 'run_id', 'tool_call_id', 'created_at']);

    runV60(s); // idempotent replay
    expect(hash(s, before)).toEqual(hashed);
    expect(s.pragma('foreign_key_check')).toEqual([]);
  });
});
