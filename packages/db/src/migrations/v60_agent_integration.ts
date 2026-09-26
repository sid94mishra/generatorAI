// ────────────────────────────────────────────────────────────────
// Migration v60 — agent_integration (workflow overhaul P06 WP-6.2/6.5).
//
//   1. `chat_workflow_runs` (created): the runs a chat started through its
//      workflow tools, with the tool call that started each.
//   2. `chats.created_by_principal` (added): the creating principal, whose
//      scopes the chat's in-process workflow tools act with.
//   3. `workflow_definitions.authored_by` (added): who authored a draft.
//
// Additive only: nothing is dropped, rebuilt or rewritten; the existing
// chat rows keep every value (the new column is NULL). Idempotent (a table
// or column that exists is left as it is). The DDL is frozen in
// `./v60/ddl.ts` (RV-33).
// ────────────────────────────────────────────────────────────────

import type Database from 'better-sqlite3';
import {
  CHAT_WORKFLOW_RUNS_DDL,
  CHAT_WORKFLOW_RUNS_INDEXES,
  CHATS_CREATED_BY_PRINCIPAL_SQL,
  WORKFLOW_DEFINITIONS_AUTHORED_BY_SQL,
} from './v60/ddl.js';

/** Files whose content `migrations.lock.json` pins for v60 (relative to this folder). */
export const V60_LOCK_FILES = ['v60_agent_integration.ts', 'v60/ddl.ts'] as const;

function columnsOf(sqlite: Database.Database, table: string): Set<string> {
  return new Set((sqlite.pragma(`table_info("${table}")`) as Array<{ name: string }>).map((c) => c.name));
}

function tableExists(sqlite: Database.Database, table: string): boolean {
  return !!sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
}

export function runV60(sqlite: Database.Database): void {
  // 1.
  if (!tableExists(sqlite, 'chat_workflow_runs')) {
    sqlite.exec(CHAT_WORKFLOW_RUNS_DDL);
    for (const idx of CHAT_WORKFLOW_RUNS_INDEXES) sqlite.exec(idx);
  }

  // 2.
  if (!columnsOf(sqlite, 'chats').has('created_by_principal')) sqlite.exec(CHATS_CREATED_BY_PRINCIPAL_SQL);

  // 3.
  if (!columnsOf(sqlite, 'workflow_definitions').has('authored_by')) sqlite.exec(WORKFLOW_DEFINITIONS_AUTHORED_BY_SQL);
}
