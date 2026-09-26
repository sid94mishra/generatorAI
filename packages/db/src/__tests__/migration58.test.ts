// ────────────────────────────────────────────────────────────────
// Migration v58 `invocation` (workflow overhaul P04 WP-4.3, R-3).
//
// Builds a v57 database through the real migrations and fills it with
// chats, their messages and sessions, a stage session, an idempotency key,
// and a paired device with a push token and a scope request (the children
// of the rebuilt `auth_devices`). After v58:
//   - chats, chat messages and sessions are unchanged (hash over every
//     column);
//   - the device, its push token and its scope request survive the rebuild,
//     and an `mcp` device can be written;
//   - `idempotency_keys.request_hash` and `invocation_uploads` exist;
//   - `foreign_key_check` is empty.
// ────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { closeDB, createDB, type AppDatabase } from '../index.js';
import { migrateDB } from '../migrations/index.js';

const open: AppDatabase[] = [];
afterEach(() => {
  for (const db of open.splice(0)) closeDB(db);
});

const raw = (db: AppDatabase): Database.Database =>
  (db as unknown as { session: { client: Database.Database } }).session.client;

const T = 1_790_000_000;

function seedV57(s: Database.Database): void {
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
  s.prepare(`INSERT INTO idempotency_keys (key, scope, execution_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`).run(
    'k1',
    'automation:a1',
    'exec-1',
    T,
    T + 300,
  );
  s.prepare(
    `INSERT INTO auth_devices (device_id, name, platform, public_jwk, jwk_thumbprint, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('d1', 'Phone', 'mobile', '{"kty":"EC"}', 'thumb-1', '["read:chats"]', T);
  s.prepare(
    `INSERT INTO device_push_tokens (device_id, provider, token, platform, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('d1', 'expo', 'ExponentPushToken[x]', 'ios', T, T);
  s.prepare(`INSERT INTO device_scope_requests (id, device_id, requested_scopes, created_at) VALUES (?, ?, ?, ?)`).run(
    'sq1',
    'd1',
    '["write:workflows"]',
    T,
  );
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

describe('migration v58 invocation', () => {
  it('keeps chats, messages, sessions and devices; adds the request hash, the upload table and the mcp platform', () => {
    const db = createDB(':memory:');
    open.push(db);
    migrateDB(db, { targetVersion: 54 });
    migrateDB(db, { targetVersion: 57 });
    const s = raw(db);
    seedV57(s);
    const before = hash(s);
    const devicesBefore = s.prepare(`SELECT * FROM auth_devices ORDER BY device_id`).all();

    migrateDB(db, { targetVersion: 58 });

    expect((s.prepare(`SELECT MAX(version) AS v FROM _schema_versions`).get() as { v: number }).v).toBe(58);
    expect(hash(s)).toEqual(before);
    expect(s.prepare(`SELECT * FROM auth_devices ORDER BY device_id`).all()).toEqual(devicesBefore);
    expect(s.prepare(`SELECT device_id FROM device_push_tokens`).all()).toEqual([{ device_id: 'd1' }]);
    expect(s.prepare(`SELECT id FROM device_scope_requests`).all()).toEqual([{ id: 'sq1' }]);
    // An MCP server pairs as a device (PD-22).
    s.prepare(
      `INSERT INTO auth_devices (device_id, name, platform, public_jwk, jwk_thumbprint, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('d-mcp', 'MCP', 'mcp', '{"kty":"EC"}', 'thumb-mcp', '["exec:agent"]', T);
    expect(s.prepare(`SELECT key, request_hash FROM idempotency_keys`).all()).toEqual([{ key: 'k1', request_hash: null }]);
    expect(s.prepare(`SELECT COUNT(*) AS n FROM invocation_uploads`).get()).toEqual({ n: 0 });
    expect(s.pragma('foreign_key_check')).toEqual([]);
  });
});
