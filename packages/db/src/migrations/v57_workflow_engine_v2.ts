// ────────────────────────────────────────────────────────────────
// Migration v57 — workflow_engine_v2 (workflow overhaul P03 WP-3.2).
//
// The run side of the v2 engine (G5 §6.2, RV-17), in this order:
//   0. precondition: the run-worktree cleanup (P00 WP-0.8) ran for this DB,
//      as for v55
//   1. purge the dev runs created since v55 with EXPLICIT child deletes
//      through the `v57_purge_sessions` temp table (RV-1): foreign keys are
//      off during the rebuild, so nothing cascades; every delete filters on
//      owner_type / scope / run ids, never on "not a chat"
//   2. drop `automation_execution_runs`, `stage_session_maps`,
//      `session_allocations`, `stage_runs`, `workflow_runs`
//   3. create the v2 run tables: `workflow_runs` (+ invocation, ownership
//      and fencing columns), `stage_runs` (instances: instance path, scope,
//      loop/iteration columns, leases, `amended_at`), `stage_attempts`,
//      `run_sessions`, `workflow_timers`, `workflow_outbox`,
//      `scheduler_journal`, `engine_lock`; `automation_execution_runs`
//      again, with its FK bound to the new `workflow_runs`
//   4. `chat_messages.turn_role` — added, never backfilled, and with no
//      CHECK so later roles need no rebuild of the chat table
//
// Chats, chat sessions and chat messages are never rewritten: the only chat
// table change is the added column. Definitions are not touched. The DDL is
// frozen in `./v57/ddl.ts` (RV-33).
// ────────────────────────────────────────────────────────────────

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type Database from 'better-sqlite3';
import {
  AUTOMATION_EXECUTION_RUNS_DDL,
  AUTOMATION_EXECUTION_RUNS_INDEXES,
  ENGINE_LOCK_DDL,
  RUN_SESSIONS_DDL,
  RUN_SESSIONS_INDEXES,
  SCHEDULER_JOURNAL_DDL,
  STAGE_ATTEMPTS_DDL,
  STAGE_ATTEMPTS_INDEXES,
  STAGE_RUNS_DDL,
  STAGE_RUNS_INDEXES,
  WORKFLOW_OUTBOX_DDL,
  WORKFLOW_OUTBOX_INDEXES,
  WORKFLOW_RUNS_DDL,
  WORKFLOW_RUNS_INDEXES,
  WORKFLOW_TIMERS_DDL,
  WORKFLOW_TIMERS_INDEXES,
} from './v57/ddl.js';

/** Files whose content `migrations.lock.json` pins for v57 (relative to this folder). */
export const V57_LOCK_FILES = ['v57_workflow_engine_v2.ts', 'v57/ddl.ts'] as const;

/** Set to `1` to skip the run-cleanup precondition (tests and DB-copy checks only). */
export const V57_SKIP_CLEANUP_ENV = 'GENERATORAI_V57_SKIP_RUN_CLEANUP';

function sameFile(a: string, b: string): boolean {
  const norm = (p: string) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
  return norm(a) === norm(b);
}

/**
 * Purging runs forgets where their git worktrees live, so a database with
 * run-owned worktrees or workspaces needs a non-dry-run `cleanup.json` from
 * `pnpm workflow:cleanup-runs` for this DB file first (as v55).
 */
function assertRunCleanupDone(sqlite: Database.Database): void {
  const pending = (
    sqlite
      .prepare(
        `SELECT (SELECT COUNT(*) FROM worktrees WHERE run_type = 'workflow')
              + (SELECT COUNT(*) FROM execution_workspaces WHERE owner_type = 'workflow_run') AS n`,
      )
      .get() as { n: number }
  ).n;
  if (pending === 0) return;
  if (process.env[V57_SKIP_CLEANUP_ENV] === '1') return;
  const dbPath = sqlite.name;
  if (!dbPath || dbPath === ':memory:' || dbPath === '') return;
  const root = process.env['GENERATORAI_BACKUP_ROOT'] || join(homedir(), '.generatorai-backups');
  if (existsSync(root)) {
    for (const dir of readdirSync(root)) {
      const file = join(root, dir, 'cleanup.json');
      if (!existsSync(file)) continue;
      try {
        const summary = JSON.parse(readFileSync(file, 'utf8')) as { dbPath?: string; dryRun?: boolean };
        if (summary.dryRun === false && summary.dbPath && sameFile(summary.dbPath, dbPath)) return;
      } catch {
        /* not a cleanup record */
      }
    }
  }
  throw new Error(
    `v57 drops workflow run history, and ${pending} run-owned worktree/workspace row(s) still point at git worktrees on disk. ` +
      `Stop the server, run \`pnpm workflow:backup\` and then \`pnpm workflow:cleanup-runs --db "${dbPath}"\` ` +
      `(it writes cleanup.json under ${root}), then start again. ` +
      `To migrate a throwaway copy without cleaning up, set ${V57_SKIP_CLEANUP_ENV}=1.`,
  );
}

function columnsOf(sqlite: Database.Database, table: string): Set<string> {
  return new Set((sqlite.pragma(`table_info("${table}")`) as Array<{ name: string }>).map((c) => c.name));
}

function tableExists(sqlite: Database.Database, table: string): boolean {
  return !!sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
}

function purgeRunHistory(sqlite: Database.Database, nowSec: number, log: (entity: string, message: string) => void): void {
  // 1. Every run-owned row, children first, explicitly (RV-1).
  const allocations = tableExists(sqlite, 'session_allocations');
  sqlite.exec(`CREATE TEMP TABLE v57_purge_sessions AS
    SELECT id, conversation_id FROM sessions
     WHERE (owner_type IN ('stage_run', 'workflow_run')
            OR id IN (SELECT session_id FROM stage_runs WHERE session_id IS NOT NULL)
            ${allocations ? `OR id IN (SELECT session_id FROM stage_session_maps)
            OR id IN (SELECT shared_session_id FROM session_allocations WHERE shared_session_id IS NOT NULL)` : ''})
       AND id NOT IN (SELECT session_id FROM chats WHERE session_id IS NOT NULL)`);
  sqlite.exec(`CREATE TEMP TABLE v57_purge_workspaces AS
    SELECT id FROM execution_workspaces WHERE owner_type = 'workflow_run'`);
  const purged = {
    sessions: (sqlite.prepare(`SELECT COUNT(*) AS n FROM v57_purge_sessions`).get() as { n: number }).n,
    runs: (sqlite.prepare(`SELECT COUNT(*) AS n FROM workflow_runs`).get() as { n: number }).n,
  };
  const statements = [
    `DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM v57_purge_sessions)`,
    `DELETE FROM artifacts WHERE session_id IN (SELECT id FROM v57_purge_sessions) OR workflow_run_id IS NOT NULL OR stage_run_id IS NOT NULL`,
    `DELETE FROM events WHERE session_id IN (SELECT id FROM v57_purge_sessions) OR workflow_run_id IS NOT NULL OR stage_run_id IS NOT NULL`,
    `DELETE FROM event_sequences WHERE session_id IN (SELECT id FROM v57_purge_sessions)`,
    `DELETE FROM stream_cursors WHERE (scope = 'session' AND scope_id IN (SELECT id FROM v57_purge_sessions)) OR scope = 'run'`,
    `DELETE FROM stream_sequences WHERE (scope = 'session' AND scope_id IN (SELECT id FROM v57_purge_sessions)) OR scope = 'run'`,
    `DELETE FROM agent_interactions WHERE scope_kind = 'stage_run'`,
    `DELETE FROM entries WHERE scope IN ('stage_run', 'workflow_run')`,
    `DELETE FROM registers WHERE scope IN ('stage_run', 'workflow_run')`,
    `DELETE FROM widget_instances WHERE workflow_run_id IS NOT NULL OR stage_run_id IS NOT NULL OR session_id IN (SELECT id FROM v57_purge_sessions)`,
    `DELETE FROM plan_comments WHERE plan_id IN (SELECT id FROM plan_documents WHERE stage_run_id IS NOT NULL OR workflow_run_id IS NOT NULL)`,
    `DELETE FROM plan_revisions WHERE plan_id IN (SELECT id FROM plan_documents WHERE stage_run_id IS NOT NULL OR workflow_run_id IS NOT NULL)`,
    `DELETE FROM plan_documents WHERE stage_run_id IS NOT NULL OR workflow_run_id IS NOT NULL`,
    `DELETE FROM review_comments WHERE thread_id IN (SELECT id FROM review_threads WHERE scope = 'run' OR workspace_id IN (SELECT id FROM v57_purge_workspaces))`,
    `DELETE FROM review_threads WHERE scope = 'run' OR workspace_id IN (SELECT id FROM v57_purge_workspaces)`,
    `DELETE FROM checkpoints WHERE workflow_run_id IS NOT NULL OR stage_run_id IS NOT NULL OR workspace_id IN (SELECT id FROM v57_purge_workspaces)`,
    `DELETE FROM workspace_artifacts WHERE stage_run_id IS NOT NULL OR workspace_id IN (SELECT id FROM v57_purge_workspaces)`,
    `DELETE FROM workspace_mounts WHERE workspace_id IN (SELECT id FROM v57_purge_workspaces)`,
    `DELETE FROM workspace_file_reviews WHERE workspace_id IN (SELECT id FROM v57_purge_workspaces)`,
    `DELETE FROM computer_use_grants WHERE workspace_id IN (SELECT id FROM v57_purge_workspaces)`,
    `DELETE FROM computer_use_audit WHERE workspace_id IN (SELECT id FROM v57_purge_workspaces)`,
    `DELETE FROM execution_workspaces WHERE id IN (SELECT id FROM v57_purge_workspaces)`,
    `DELETE FROM worktrees WHERE run_type = 'workflow'`,
    `DELETE FROM conversation_ownership WHERE conversation_id IN (SELECT conversation_id FROM v57_purge_sessions WHERE conversation_id IS NOT NULL)`,
    `DELETE FROM conversation_instance_ownership WHERE conversation_id IN (SELECT conversation_id FROM v57_purge_sessions WHERE conversation_id IS NOT NULL)`,
    ...(allocations ? [`DELETE FROM stage_session_maps`, `DELETE FROM session_allocations`] : []),
    `UPDATE automation_executions SET status = 'cancelled', completed_at = COALESCE(completed_at, ${nowSec}) WHERE status IN ('pending', 'running')`,
    `DELETE FROM automation_execution_runs`,
    `DELETE FROM stage_runs`,
    `DELETE FROM workflow_runs`,
    `DELETE FROM sessions WHERE id IN (SELECT id FROM v57_purge_sessions)`,
  ];
  for (const stmt of statements) sqlite.exec(stmt);
  sqlite.exec(`DROP TABLE v57_purge_sessions`);
  sqlite.exec(`DROP TABLE v57_purge_workspaces`);
  if (purged.runs > 0 || purged.sessions > 0) {
    log('run_history', `dropped ${purged.runs} workflow run(s) and ${purged.sessions} stage/run session(s) with their messages`);
  }
}

function recreateRunTables(sqlite: Database.Database): void {
  // 2. Drop the v1 run tables (empty after 1), children first.
  for (const t of ['automation_execution_runs', 'stage_session_maps', 'session_allocations', 'stage_runs', 'workflow_runs']) {
    sqlite.exec(`DROP TABLE IF EXISTS ${t}`);
  }
  // 3. The v2 run tables.
  const tables: Array<[ddl: string, indexes: readonly string[]]> = [
    [WORKFLOW_RUNS_DDL, WORKFLOW_RUNS_INDEXES],
    [STAGE_RUNS_DDL, STAGE_RUNS_INDEXES],
    [STAGE_ATTEMPTS_DDL, STAGE_ATTEMPTS_INDEXES],
    [RUN_SESSIONS_DDL, RUN_SESSIONS_INDEXES],
    [WORKFLOW_TIMERS_DDL, WORKFLOW_TIMERS_INDEXES],
    [WORKFLOW_OUTBOX_DDL, WORKFLOW_OUTBOX_INDEXES],
    [SCHEDULER_JOURNAL_DDL, []],
    [ENGINE_LOCK_DDL, []],
    [AUTOMATION_EXECUTION_RUNS_DDL, AUTOMATION_EXECUTION_RUNS_INDEXES],
  ];
  for (const [ddl, indexes] of tables) {
    sqlite.exec(ddl);
    for (const idx of indexes) sqlite.exec(idx);
  }
}

export function runV57(sqlite: Database.Database): void {
  const nowSec = Math.floor(Date.now() / 1000);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS _migration_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`);
  const logStmt = sqlite.prepare(`INSERT INTO _migration_log (version, entity, entity_id, message, created_at) VALUES (57, ?, NULL, ?, ?)`);
  const log = (entity: string, message: string) => logStmt.run(entity, message, nowSec);

  // Replaying v57 on a database that already has it (tests roll
  // `_schema_versions` back and migrate again) must be a no-op, not a
  // second purge.
  if (!tableExists(sqlite, 'stage_attempts')) {
    assertRunCleanupDone(sqlite); // 0
    purgeRunHistory(sqlite, nowSec, log); // 1
    recreateRunTables(sqlite); // 2, 3
  }
  if (!columnsOf(sqlite, 'chat_messages').has('turn_role')) {
    sqlite.exec(`ALTER TABLE chat_messages ADD COLUMN turn_role TEXT`); // 4
  }
}
