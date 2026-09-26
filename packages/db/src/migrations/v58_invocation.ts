// ────────────────────────────────────────────────────────────────
// Migration v58 — invocation (workflow overhaul P04 WP-4.3).
//
//   1. `idempotency_keys.request_hash` (added): an invocation claim records
//      the hash of the request it was claimed for, so a replay with another
//      body is refused (409 IDEMPOTENCY_KEY_REUSED).
//   2. `invocation_uploads` (created): files staged before a run starts,
//      consumed by the run's `uploads` lifecycle phase.
//   3. `auth_devices` rebuilt with `mcp` in its platform CHECK (PD-22: the
//      MCP server pairs as a device). The SQLite table-rebuild procedure with
//      foreign keys OFF (the migration's `disableForeignKeys`): copy by
//      column name, drop, rename, re-create the indexes. Its children
//      (`device_push_tokens`, `device_scope_requests`) reference it by name
//      and are not touched.
//
// Chats, chat sessions and chat messages are not touched. The run columns
// the invocation writes (trigger, lineage, overrides, system_vars) already
// exist since v57. The DDL is frozen in `./v58/ddl.ts` (RV-33).
// ────────────────────────────────────────────────────────────────

import type Database from 'better-sqlite3';
import {
  AUTH_DEVICES_V58_COLUMNS,
  AUTH_DEVICES_V58_DDL,
  AUTH_DEVICES_V58_INDEXES,
  IDEMPOTENCY_REQUEST_HASH_SQL,
  INVOCATION_UPLOADS_DDL,
  INVOCATION_UPLOADS_INDEXES,
} from './v58/ddl.js';

/** Files whose content `migrations.lock.json` pins for v58 (relative to this folder). */
export const V58_LOCK_FILES = ['v58_invocation.ts', 'v58/ddl.ts'] as const;

function columnsOf(sqlite: Database.Database, table: string): Set<string> {
  return new Set((sqlite.pragma(`table_info("${table}")`) as Array<{ name: string }>).map((c) => c.name));
}

export function runV58(sqlite: Database.Database): void {
  // 1.
  if (!columnsOf(sqlite, 'idempotency_keys').has('request_hash')) sqlite.exec(IDEMPOTENCY_REQUEST_HASH_SQL);

  // 2.
  sqlite.exec(INVOCATION_UPLOADS_DDL);
  for (const idx of INVOCATION_UPLOADS_INDEXES) sqlite.exec(idx);

  // 3. Every column the old table has is copied by name; a column the old
  //    table lacks takes its default.
  const present = columnsOf(sqlite, 'auth_devices');
  const cols = AUTH_DEVICES_V58_COLUMNS.filter((c) => present.has(c)).join(', ');
  sqlite.exec(AUTH_DEVICES_V58_DDL);
  sqlite.exec(`INSERT INTO auth_devices_v58 (${cols}) SELECT ${cols} FROM auth_devices`);
  sqlite.exec(`DROP TABLE auth_devices`);
  sqlite.exec(`ALTER TABLE auth_devices_v58 RENAME TO auth_devices`);
  for (const idx of AUTH_DEVICES_V58_INDEXES) sqlite.exec(idx);
}
