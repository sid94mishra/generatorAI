// ────────────────────────────────────────────────────────────────
// Migration v59 `control_flow` (workflow overhaul P05 WP-5A.4, R-3).
//
// Builds a v58 database through the real migrations and fills it with
// chats, their messages and sessions, a stage session, and a definition
// whose stages are a loop and its body. After v59:
//   - chats, chat messages and sessions are unchanged (hash over every
//     column);
//   - `stage_definitions.kind` / `parent_key` are backfilled from `spec`;
//   - `loop_iterations`, `workflow_run_events` and `stage_runs.item_key`
//     exist;
//   - running v59 again changes nothing, and `foreign_key_check` is empty.
// ────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { closeDB, createDB, type AppDatabase } from '../index.js';
import { migrateDB } from '../migrations/index.js';
import { runV59 } from '../migrations/v59_control_flow.js';

const open: AppDatabase[] = [];
afterEach(() => {
  for (const db of open.splice(0)) closeDB(db);
});

const raw = (db: AppDatabase): Database.Database =>
  (db as unknown as { session: { client: Database.Database } }).session.client;

const T = 1_790_000_000;

function seedV58(s: Database.Database): void {
  const session = s.prepare(
    `INSERT INTO sessions (id, name, status, created_at, updated_at, conversation_id, owner_type, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  session.run('s-c1', 'Chat one', 'active', T, T, 'conv-c1', 'chat', 'c1');
  session.run('s-stage', 'Stage', 'closed', T, T, 'conv-stage', 'stage_run', 'sr-x');
  s.prepare(
    `INSERT INTO chats (id, name, session_id, created_at, updated_at, harness_config, default_agent_mode) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('c1', 'Chat', 's-c1', T, T, '{"model":"claude"}', 'auto');
  const msg = s.prepare(
    `INSERT INTO chat_messages (id, session_id, role, content, timestamp, chat_id, metadata, complete, turn_role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  msg.run('m1', 's-c1', 'user', 'hello', T, 'c1', '{"turnId":"t1"}', 1, null);
  msg.run('m2', 's-c1', 'assistant', 'done ✓', T + 1, 'c1', '{"turnId":"t1"}', 1, null);
  msg.run('ms1', 's-stage', 'assistant', 'stage answer', T + 2, null, '{"stageRunId":"sr-x"}', 1, 'prompt');
  s.prepare(
    `INSERT INTO workflow_definitions (id, name, status, revision, spec, created_at, updated_at) VALUES (?, ?, 'draft', 1, '{}', ?, ?)`,
  ).run('wd1', 'Loop', T, T);
  const stage = s.prepare(
    `INSERT INTO stage_definitions (id, workflow_definition_id, key, name, ordinal, spec, created_at, updated_at) VALUES (?, 'wd1', ?, ?, ?, ?, ?, ?)`,
  );
  stage.run('sd1', 'fix_review', 'Loop', 0, '{"kind":"loop","loop":{"maxIterations":3}}', T, T);
  stage.run('sd2', 'fix', 'Fix', 1, '{"kind":"agent","parentKey":"fix_review","prompts":[]}', T, T);
  stage.run('sd3', 'legacy', 'Legacy', 2, 'not json', T, T);
}

const CHAT_TABLES = ['chats', 'chat_messages', 'sessions'] as const;

function hash(s: Database.Database): Record<string, { n: number; hash: string }> {
  return Object.fromEntries(
    CHAT_TABLES.map((t) => {
      const rows = s.prepare(`SELECT * FROM ${t} ORDER BY id`).all();
      return [t, { n: rows.length, hash: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }];
    }),
  );
}

describe('migration v59 control_flow', () => {
  it('keeps chats, messages and sessions; adds the loop, event and item-key storage; backfills stage kinds', () => {
    const db = createDB(':memory:');
    open.push(db);
    migrateDB(db, { targetVersion: 54 });
    migrateDB(db, { targetVersion: 58 });
    const s = raw(db);
    seedV58(s);
    const before = hash(s);

    migrateDB(db, { targetVersion: 59 });

    expect((s.prepare(`SELECT MAX(version) AS v FROM _schema_versions`).get() as { v: number }).v).toBe(59);
    expect(hash(s)).toEqual(before);
    expect(s.prepare(`SELECT key, kind, parent_key FROM stage_definitions ORDER BY ordinal`).all()).toEqual([
      { key: 'fix_review', kind: 'loop', parent_key: null },
      { key: 'fix', kind: 'agent', parent_key: 'fix_review' },
      { key: 'legacy', kind: 'agent', parent_key: null },
    ]);
    expect(s.prepare(`SELECT COUNT(*) AS n FROM loop_iterations`).get()).toEqual({ n: 0 });
    expect(s.prepare(`SELECT COUNT(*) AS n FROM workflow_run_events`).get()).toEqual({ n: 0 });
    expect((s.pragma('table_info(stage_runs)') as Array<{ name: string }>).some((c) => c.name === 'item_key')).toBe(true);

    runV59(s); // idempotent replay
    expect(hash(s)).toEqual(before);
    expect(s.pragma('foreign_key_check')).toEqual([]);
  });
});
