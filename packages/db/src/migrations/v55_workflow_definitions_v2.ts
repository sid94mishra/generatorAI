// ────────────────────────────────────────────────────────────────
// Migration v55 — workflow_definitions_v2 (workflow overhaul P01 WP-1.6).
//
// One forward conversion, in the PHASE-01 WP-1.6 order (G3 §4.4 + RV-1):
//   0. precondition: the run-worktree cleanup (P00 WP-0.8) ran for this DB
//   1. drop the indexes on columns that go away
//   2. drop chat_messages.workflow_id / artifacts.workflow_id (before 3)
//   3. drop the v1 `workflows` and webhook tables
//   4. drop workflow run history with EXPLICIT child deletes (foreign keys
//      are off, so nothing cascades; every delete filters on owner_type /
//      scope, never on "not a chat")
//   5. column drops: sessions (RV-42), automations (after converting the
//      legacy input modes and hashing plaintext webhook tokens), chats and
//      stage_runs/workflow_runs dead columns; defaults fixed
//   6. rebuild stage_definitions / stage_edges / workflow_definitions into
//      v2 documents (JS step, `./v55/convert.ts`, frozen schemas in
//      `./v55/spec/`); every definition migrates `published` with version 1
//   7. workflow_definition_versions; runs pin definition_version_id; stage
//      runs carry the stage key
//   8. automation_execution_runs.workflow_run_id nullable, ON DELETE SET NULL
//
// Every rebuilt table uses the SQLite procedure (create new, copy, drop,
// rename) with foreign keys OFF (`disableForeignKeys`). Chats, chat
// messages and chat sessions are never rewritten except for the column
// drops and the chats column order (the P00 drift allowlist), which copies
// every value verbatim.
//
// Anything the conversion cannot carry over is written to `_migration_log`
// and, when an author has to act, to `workflow_definitions.needs_attention`.
// ────────────────────────────────────────────────────────────────

import { randomUUID, createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type Database from 'better-sqlite3';
import {
  convertLegacyAutomation,
  convertLegacyDefinition,
  type LegacyAutomationRow,
  type LegacyDefinitionRow,
  type LegacyEdgeRow,
  type LegacyStageRow,
} from './v55/convert.js';

/** Files whose content `migrations.lock.json` pins for v55 (relative to this folder). */
export const V55_LOCK_FILES = [
  'v55_workflow_definitions_v2.ts',
  'v55/convert.ts',
  'v55/spec/common.ts',
  'v55/spec/constants.ts',
  'v55/spec/edge.ts',
  'v55/spec/errors.ts',
  'v55/spec/graph.ts',
  'v55/spec/session.ts',
  'v55/spec/stage.ts',
  'v55/spec/workflow.ts',
] as const;

/** Set to `1` to skip the run-cleanup precondition (tests and DB-copy checks only). */
export const V55_SKIP_CLEANUP_ENV = 'GENERATORAI_V55_SKIP_RUN_CLEANUP';

// ── Precondition (P00 WP-0.8, RV-29) ─────────────────────────────

function sameFile(a: string, b: string): boolean {
  const norm = (p: string) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
  return norm(a) === norm(b);
}

/**
 * Purging run rows forgets where the runs' git worktrees live, so the
 * worktrees and `generatorai/run-*` branches must be released first
 * (`pnpm workflow:cleanup-runs`). A database with run-owned worktrees or
 * workspaces needs that script's non-dry-run `cleanup.json` for this DB file.
 */
export function assertRunCleanupDone(sqlite: Database.Database): void {
  const pending = (
    sqlite
      .prepare(
        `SELECT (SELECT COUNT(*) FROM worktrees WHERE run_type = 'workflow')
              + (SELECT COUNT(*) FROM execution_workspaces WHERE owner_type = 'workflow_run') AS n`,
      )
      .get() as { n: number }
  ).n;
  if (pending === 0) return;
  if (process.env[V55_SKIP_CLEANUP_ENV] === '1') return;
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
    `v55 drops workflow run history, and ${pending} run-owned worktree/workspace row(s) still point at git worktrees on disk. ` +
      `Stop the server, run \`pnpm workflow:backup\` and then \`pnpm workflow:cleanup-runs --db "${dbPath}"\` ` +
      `(it writes cleanup.json under ${root}), then start again. ` +
      `To migrate a throwaway copy without cleaning up, set ${V55_SKIP_CLEANUP_ENV}=1.`,
  );
}

// ── Helpers ──────────────────────────────────────────────────────

/** The SQLite rebuild procedure: create `<t>__v55`, copy, drop `<t>`, rename, re-index. */
function rebuild(
  sqlite: Database.Database,
  table: string,
  columnsDdl: string,
  copy: Array<[target: string, source: string]>,
  indexes: string[],
): void {
  sqlite.exec(`CREATE TABLE "${table}__v55" (\n${columnsDdl}\n)`);
  if (copy.length > 0) {
    sqlite.exec(
      `INSERT INTO "${table}__v55" (${copy.map(([t]) => `"${t}"`).join(', ')}) SELECT ${copy.map(([, s]) => s).join(', ')} FROM "${table}"`,
    );
  }
  sqlite.exec(`DROP TABLE "${table}"`);
  sqlite.exec(`ALTER TABLE "${table}__v55" RENAME TO "${table}"`);
  for (const idx of indexes) sqlite.exec(idx);
}

const same = (...cols: string[]): Array<[string, string]> => cols.map((c) => [c, `"${c}"`]);

function columnsOf(sqlite: Database.Database, table: string): Set<string> {
  return new Set((sqlite.pragma(`table_info("${table}")`) as Array<{ name: string }>).map((c) => c.name));
}

/** A column's declared default as SQLite reports it (`'x'` quoted), or null. */
function columnDefault(sqlite: Database.Database, table: string, column: string): string | null {
  const col = (sqlite.pragma(`table_info("${table}")`) as Array<{ name: string; dflt_value: string | null }>).find((c) => c.name === column);
  return col?.dflt_value ?? null;
}

// ── DDL of the rebuilt tables (frozen) ───────────────────────────

const CHATS_COLUMNS = [
  'id', 'name', 'description', 'session_id', 'model', 'repo_url', 'repo_branch', 'workspace_path', 'tags', 'status',
  'created_at', 'updated_at', 'git_repositories', 'project_id', 'workspace_id', 'use_worktree', 'codebase_ids',
  'harness_config', 'agent_ref', 'agent_id', 'agent_version', 'agent_overrides', 'agent_snapshot', 'orchestrator_mode',
  'parent_chat_id', 'background_task_name', 'background_task_index', 'background_task_status', 'default_agent_mode',
  'permission_mode', 'orchestrator_wave_count', 'orchestrator_started_at', 'sources', 'primary_source',
  'forked_from_chat_id', 'forked_at_turn_id', 'conversation_seed', 'source_control',
];

const CHATS_DDL = `  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  model TEXT,
  repo_url TEXT,
  repo_branch TEXT,
  workspace_path TEXT,
  tags TEXT DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  git_repositories TEXT,
  project_id TEXT,
  workspace_id TEXT,
  use_worktree INTEGER NOT NULL DEFAULT 1,
  codebase_ids TEXT,
  harness_config TEXT,
  agent_ref TEXT,
  agent_id TEXT,
  agent_version INTEGER,
  agent_overrides TEXT,
  agent_snapshot TEXT,
  orchestrator_mode INTEGER NOT NULL DEFAULT 0,
  parent_chat_id TEXT,
  background_task_name TEXT,
  background_task_index INTEGER,
  background_task_status TEXT,
  default_agent_mode TEXT NOT NULL DEFAULT 'auto',
  permission_mode TEXT NOT NULL DEFAULT 'bypassPermissions',
  orchestrator_wave_count INTEGER,
  orchestrator_started_at INTEGER,
  sources TEXT,
  primary_source TEXT,
  forked_from_chat_id TEXT,
  forked_at_turn_id TEXT,
  conversation_seed TEXT,
  source_control TEXT`;

const CHATS_INDEXES = [
  'CREATE INDEX idx_chats_status ON chats(status)',
  'CREATE INDEX idx_chats_session_id ON chats(session_id)',
  'CREATE INDEX idx_chats_created_at ON chats(created_at)',
  'CREATE INDEX idx_chats_parent_chat_id ON chats(parent_chat_id)',
  'CREATE INDEX idx_chats_agent_ref ON chats(agent_ref)',
  'CREATE INDEX idx_chats_project_id ON chats(project_id)',
  'CREATE INDEX idx_chats_forked_from ON chats(forked_from_chat_id)',
];

const WORKFLOW_DEFINITIONS_DDL = `  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  project_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published')),
  revision INTEGER NOT NULL DEFAULT 1,
  current_version_id TEXT,
  archived_at INTEGER,
  needs_attention TEXT,
  spec TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL`;

const STAGE_DEFINITIONS_DDL = `  id TEXT PRIMARY KEY,
  workflow_definition_id TEXT NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  ordinal INTEGER NOT NULL DEFAULT 0,
  position_x REAL,
  position_y REAL,
  spec TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL`;

const STAGE_EDGES_DDL = `  id TEXT PRIMARY KEY,
  workflow_definition_id TEXT NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  from_key TEXT NOT NULL,
  to_key TEXT NOT NULL,
  edge_on TEXT NOT NULL DEFAULT 'success' CHECK(edge_on IN ('success', 'failure', 'completion', 'always')),
  when_expr TEXT,
  handles_failure INTEGER,
  ordinal INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (workflow_definition_id, from_key) REFERENCES stage_definitions(workflow_definition_id, key) ON DELETE CASCADE,
  FOREIGN KEY (workflow_definition_id, to_key) REFERENCES stage_definitions(workflow_definition_id, key) ON DELETE CASCADE`;

const VERSIONS_DDL = `CREATE TABLE workflow_definition_versions (
  id TEXT PRIMARY KEY,
  workflow_definition_id TEXT NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('published', 'test')),
  spec TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`;

const WORKFLOW_RUNS_DDL = `  id TEXT PRIMARY KEY,
  workflow_definition_id TEXT NOT NULL REFERENCES workflow_definitions(id),
  definition_version_id TEXT NOT NULL REFERENCES workflow_definition_versions(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  session_mode TEXT NOT NULL DEFAULT 'auto',
  variables TEXT DEFAULT '{}',
  error TEXT,
  permission_mode TEXT,
  project_id TEXT,
  workspace_id TEXT,
  agent_snapshot TEXT,
  ancestor_run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER`;

const STAGE_RUNS_DDL = `  id TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL,
  session_id TEXT REFERENCES sessions(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  current_step INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  summary TEXT,
  output_text TEXT,
  output_data TEXT,
  artifact_manifest TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  interrupt_data TEXT,
  heartbeat_at INTEGER,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER`;

const AUTOMATIONS_COLUMNS = [
  'id', 'name', 'description', 'enabled', 'trigger_type', 'cron_expression', 'timezone', 'missed_run_policy',
  'overlap_policy', 'webhook_token_hash', 'workflow_ids', 'variables', 'max_concurrency', 'on_error', 'last_run_at',
  'next_run_at', 'locked_until', 'locked_by_process', 'scope', 'project_id', 'use_worktree', 'data_schema',
  'iteration_mode', 'default_dataset', 'retry_policy', 'created_at', 'updated_at',
];

const AUTOMATIONS_DDL = `  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  trigger_type TEXT NOT NULL,
  cron_expression TEXT,
  timezone TEXT,
  missed_run_policy TEXT NOT NULL DEFAULT 'skip',
  overlap_policy TEXT NOT NULL DEFAULT 'skip',
  webhook_token_hash TEXT,
  workflow_ids TEXT NOT NULL DEFAULT '[]',
  variables TEXT DEFAULT '{}',
  max_concurrency INTEGER NOT NULL DEFAULT 1,
  on_error TEXT NOT NULL DEFAULT 'continue',
  last_run_at INTEGER,
  next_run_at INTEGER,
  locked_until INTEGER,
  locked_by_process TEXT,
  scope TEXT DEFAULT 'global',
  project_id TEXT,
  use_worktree INTEGER NOT NULL DEFAULT 1,
  data_schema TEXT,
  iteration_mode TEXT,
  default_dataset TEXT,
  retry_policy TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL`;

const AUTOMATION_EXECUTION_RUNS_DDL = `  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES automation_executions(id) ON DELETE CASCADE,
  workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
  workflow_definition_id TEXT NOT NULL REFERENCES workflow_definitions(id),
  iteration_index INTEGER NOT NULL DEFAULT 0,
  iteration_variables TEXT,
  iteration_label TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL`;

const PLAN_DOCUMENTS_COLUMNS = [
  'id', 'chat_id', 'session_id', 'turn_id', 'title', 'file_name', 'file_path', 'status', 'current_revision',
  'harness_type', 'available_actions', 'recommended_action', 'decision', 'stage_run_id', 'workflow_run_id',
  'created_at', 'updated_at',
];

const PLAN_DOCUMENTS_DDL = `  id                 TEXT PRIMARY KEY,
  chat_id            TEXT NOT NULL,
  session_id         TEXT NOT NULL,
  turn_id            TEXT NOT NULL,
  title              TEXT NOT NULL,
  file_name          TEXT NOT NULL,
  file_path          TEXT,
  status             TEXT NOT NULL DEFAULT 'drafting'
    CHECK(status IN ('drafting','recorded','awaiting_review','changes_requested','approved','rejected','superseded','expired')),
  current_revision   INTEGER NOT NULL DEFAULT 1,
  harness_type       TEXT NOT NULL,
  available_actions  TEXT NOT NULL DEFAULT '[]',
  recommended_action TEXT,
  decision           TEXT,
  stage_run_id       TEXT,
  workflow_run_id    TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL`;

const CONVERSATION_INSTANCE_OWNERSHIP_DDL = `  conversation_id TEXT PRIMARY KEY,
  instance_id     TEXT NOT NULL,
  updated_at      INTEGER NOT NULL,
  provider        TEXT,
  adapter_key     TEXT,
  resume_cursor   TEXT,
  runtime_payload TEXT,
  runtime_mode    TEXT,
  binding_origin  TEXT NOT NULL DEFAULT 'migrated-ambiguous'`;

// ── The migration ────────────────────────────────────────────────

export function runV55(sqlite: Database.Database): void {
  assertRunCleanupDone(sqlite);
  const nowSec = Math.floor(Date.now() / 1000);

  sqlite.exec(`CREATE TABLE IF NOT EXISTS _migration_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`);
  const logStmt = sqlite.prepare(`INSERT INTO _migration_log (version, entity, entity_id, message, created_at) VALUES (55, ?, ?, ?, ?)`);
  const log = (entity: string, id: string | null, message: string) => logStmt.run(entity, id, message, nowSec);

  // Every step checks the shape it produces, so replaying v55 on a database
  // that already has it (tests roll `_schema_versions` back and migrate
  // again) is a no-op rather than a second purge.
  const firstRun = !columnsOf(sqlite, 'workflow_runs').has('definition_version_id');

  dropLegacyStack(sqlite); // 1–3
  if (firstRun) purgeRunHistory(sqlite, nowSec, log); // 4
  if (columnsOf(sqlite, 'automations').has('input_mode')) convertAutomations(sqlite, log); // 5a
  // 5b. sessions: the v1 columns (RV-42). Chat sessions keep every other value.
  const sessionCols = columnsOf(sqlite, 'sessions');
  for (const col of ['repo_url', 'requires_codebase', 'workspace_path', 'triggered_by']) {
    if (sessionCols.has(col)) sqlite.exec(`ALTER TABLE sessions DROP COLUMN ${col}`);
  }
  if ([...columnsOf(sqlite, 'chats')].join(',') !== CHATS_COLUMNS.join(',')) rebuildChats(sqlite); // 5c
  fixInstallDrift(sqlite); // 5d
  if (!columnsOf(sqlite, 'workflow_definitions').has('spec')) convertDefinitions(sqlite, nowSec, log); // 6
  if (firstRun) rebuildRunTables(sqlite); // 7
  const runRef = (sqlite.pragma('table_info("automation_execution_runs")') as Array<{ name: string; notnull: number }>).find(
    (c) => c.name === 'workflow_run_id',
  );
  if (runRef?.notnull === 1) rebuildAutomationExecutionRuns(sqlite); // 8
}

// ── Steps ────────────────────────────────────────────────────────

function dropLegacyStack(sqlite: Database.Database): void {
  // 1. Indexes on columns that go away.
  for (const idx of ['idx_workflow_runs_parent_stage', 'idx_stage_runs_parent', 'idx_workflow_defs_agent_ref', 'idx_workflow_defs_scope', 'idx_stage_runs_wake_at']) {
    sqlite.exec(`DROP INDEX IF EXISTS ${idx}`);
  }

  // 2. Columns that reference the v1 `workflows` table (before 3).
  for (const table of ['chat_messages', 'artifacts']) {
    if (columnsOf(sqlite, table).has('workflow_id')) sqlite.exec(`ALTER TABLE ${table} DROP COLUMN workflow_id`);
  }

  // 3. The v1 session/webhook stack.
  sqlite.exec(`DROP TABLE IF EXISTS webhook_deliveries`);
  sqlite.exec(`DROP TABLE IF EXISTS webhook_registrations`);
  sqlite.exec(`DROP TABLE IF EXISTS workflows`);
}

function purgeRunHistory(sqlite: Database.Database, nowSec: number, log: (entity: string, id: string | null, message: string) => void): void {
  // 4. Workflow run history, every child deleted explicitly (RV-1, RV-14).
  sqlite.exec(`CREATE TEMP TABLE v55_purge_sessions AS
    SELECT id, conversation_id FROM sessions
     WHERE (owner_type IN ('stage_run', 'workflow_run')
            OR id IN (SELECT session_id FROM stage_runs WHERE session_id IS NOT NULL)
            OR id IN (SELECT session_id FROM stage_session_maps)
            OR id IN (SELECT master_session_id FROM workflow_runs WHERE master_session_id IS NOT NULL))
       AND id NOT IN (SELECT session_id FROM chats WHERE session_id IS NOT NULL)`);
  sqlite.exec(`CREATE TEMP TABLE v55_purge_workspaces AS
    SELECT id FROM execution_workspaces WHERE owner_type = 'workflow_run'`);
  const purged = {
    sessions: (sqlite.prepare(`SELECT COUNT(*) AS n FROM v55_purge_sessions`).get() as { n: number }).n,
    runs: (sqlite.prepare(`SELECT COUNT(*) AS n FROM workflow_runs`).get() as { n: number }).n,
  };
  for (const stmt of [
    `DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM v55_purge_sessions)`,
    `DELETE FROM artifacts WHERE session_id IN (SELECT id FROM v55_purge_sessions) OR workflow_run_id IS NOT NULL OR stage_run_id IS NOT NULL`,
    `DELETE FROM events WHERE session_id IN (SELECT id FROM v55_purge_sessions) OR workflow_run_id IS NOT NULL OR stage_run_id IS NOT NULL`,
    `DELETE FROM event_sequences WHERE session_id IN (SELECT id FROM v55_purge_sessions)`,
    `DELETE FROM stream_cursors WHERE (scope = 'session' AND scope_id IN (SELECT id FROM v55_purge_sessions)) OR scope = 'run'`,
    `DELETE FROM stream_sequences WHERE (scope = 'session' AND scope_id IN (SELECT id FROM v55_purge_sessions)) OR scope = 'run'`,
    `DELETE FROM agent_interactions WHERE scope_kind = 'stage_run'`,
    `DELETE FROM entries WHERE scope IN ('stage_run', 'workflow_run')`,
    `DELETE FROM registers WHERE scope IN ('stage_run', 'workflow_run')`,
    `DELETE FROM widget_instances WHERE workflow_run_id IS NOT NULL OR stage_run_id IS NOT NULL OR session_id IN (SELECT id FROM v55_purge_sessions)`,
    `DELETE FROM plan_comments WHERE plan_id IN (SELECT id FROM plan_documents WHERE stage_run_id IS NOT NULL OR workflow_run_id IS NOT NULL)`,
    `DELETE FROM plan_revisions WHERE plan_id IN (SELECT id FROM plan_documents WHERE stage_run_id IS NOT NULL OR workflow_run_id IS NOT NULL)`,
    `DELETE FROM plan_documents WHERE stage_run_id IS NOT NULL OR workflow_run_id IS NOT NULL`,
    `DELETE FROM review_comments WHERE thread_id IN (SELECT id FROM review_threads WHERE scope = 'run' OR workspace_id IN (SELECT id FROM v55_purge_workspaces))`,
    `DELETE FROM review_threads WHERE scope = 'run' OR workspace_id IN (SELECT id FROM v55_purge_workspaces)`,
    `DELETE FROM checkpoints WHERE workflow_run_id IS NOT NULL OR stage_run_id IS NOT NULL OR workspace_id IN (SELECT id FROM v55_purge_workspaces)`,
    `DELETE FROM workspace_artifacts WHERE stage_run_id IS NOT NULL OR workspace_id IN (SELECT id FROM v55_purge_workspaces)`,
    `DELETE FROM workspace_mounts WHERE workspace_id IN (SELECT id FROM v55_purge_workspaces)`,
    `DELETE FROM workspace_file_reviews WHERE workspace_id IN (SELECT id FROM v55_purge_workspaces)`,
    `DELETE FROM computer_use_grants WHERE workspace_id IN (SELECT id FROM v55_purge_workspaces)`,
    `DELETE FROM computer_use_audit WHERE workspace_id IN (SELECT id FROM v55_purge_workspaces)`,
    `DELETE FROM execution_workspaces WHERE id IN (SELECT id FROM v55_purge_workspaces)`,
    `DELETE FROM worktrees WHERE run_type = 'workflow'`,
    `DELETE FROM conversation_ownership WHERE conversation_id IN (SELECT conversation_id FROM v55_purge_sessions WHERE conversation_id IS NOT NULL)`,
    `DELETE FROM conversation_instance_ownership WHERE conversation_id IN (SELECT conversation_id FROM v55_purge_sessions WHERE conversation_id IS NOT NULL)`,
    `DELETE FROM stage_session_maps`,
    `DELETE FROM session_allocations`,
    `UPDATE automation_executions SET status = 'cancelled', completed_at = COALESCE(completed_at, ${nowSec}) WHERE status IN ('pending', 'running')`,
    `DELETE FROM automation_execution_runs`,
    `DELETE FROM stage_runs`,
    `DELETE FROM workflow_runs`,
    `DELETE FROM sessions WHERE id IN (SELECT id FROM v55_purge_sessions)`,
  ]) {
    sqlite.exec(stmt);
  }
  sqlite.exec(`DROP TABLE v55_purge_sessions`);
  sqlite.exec(`DROP TABLE v55_purge_workspaces`);
  if (purged.runs > 0 || purged.sessions > 0) {
    log('run_history', null, `dropped ${purged.runs} workflow run(s) and ${purged.sessions} stage/run session(s) with their messages`);
  }
}

function convertAutomations(sqlite: Database.Database, log: (entity: string, id: string | null, message: string) => void): void {
  // 5a. Automations: legacy input modes → dataSchema (PD-8), plaintext
  //     webhook tokens → hash, then the column drops.
  const autoRows = sqlite
    .prepare(
      `SELECT id, input_mode, loop_variable, loop_items, batch_data_format, batch_data, batch_columns,
              batch_column_mapping, data_source_config, data_schema, webhook_token, webhook_token_hash FROM automations`,
    )
    .all() as Array<LegacyAutomationRow & { webhook_token: string | null; webhook_token_hash: string | null }>;
  const setSchema = sqlite.prepare(`UPDATE automations SET data_schema = ?, iteration_mode = ?, default_dataset = ? WHERE id = ?`);
  const disable = sqlite.prepare(`UPDATE automations SET enabled = 0, next_run_at = NULL WHERE id = ?`);
  const setHash = sqlite.prepare(`UPDATE automations SET webhook_token_hash = ? WHERE id = ?`);
  for (const row of autoRows) {
    const c = convertLegacyAutomation(row);
    if (c.update) setSchema.run(JSON.stringify(c.update.dataSchema), JSON.stringify(c.update.iterationMode), JSON.stringify(c.update.defaultDataset), row.id);
    if (c.disable) disable.run(row.id);
    for (const m of c.log) log('automation', row.id, m);
    if (row.webhook_token && !row.webhook_token_hash) {
      setHash.run(createHash('sha256').update(row.webhook_token).digest('hex'), row.id);
      log('automation', row.id, 'plaintext webhook token replaced by its hash');
    }
  }
  const autoCols = columnsOf(sqlite, 'automations');
  rebuild(
    sqlite,
    'automations',
    AUTOMATIONS_DDL,
    AUTOMATIONS_COLUMNS.filter((c) => autoCols.has(c)).map((c) => [c, `"${c}"`]),
    [
      'CREATE INDEX idx_automations_enabled ON automations(enabled)',
      'CREATE INDEX idx_automations_trigger_type ON automations(trigger_type)',
      'CREATE INDEX idx_automations_created_at ON automations(created_at)',
      'CREATE INDEX idx_automations_lock ON automations(locked_until)',
      'CREATE INDEX idx_automations_project ON automations(project_id)',
      'CREATE INDEX idx_automations_scope ON automations(scope)',
      'CREATE INDEX idx_automations_webhook_token_hash ON automations(webhook_token_hash)',
      'CREATE INDEX idx_automations_due ON automations(trigger_type, enabled, next_run_at)',
    ],
  );
}

function rebuildChats(sqlite: Database.Database): void {
  // 5c. chats: drop copilot_config (and the never-dropped selected_artifacts),
  //     default_agent_mode defaults to `auto`, one column order on every
  //     install path. Values are copied verbatim.
  sqlite.exec(`UPDATE chats SET default_agent_mode = 'auto' WHERE default_agent_mode = 'interactive'`);
  rebuild(sqlite, 'chats', CHATS_DDL, same(...CHATS_COLUMNS), CHATS_INDEXES);
}

function fixInstallDrift(sqlite: Database.Database): void {
  // 5d. Defaults and install-path drift from the P00 allowlist.
  const planCols = columnsOf(sqlite, 'plan_documents');
  if (columnDefault(sqlite, 'plan_documents', 'harness_type') !== null) rebuild(
    sqlite,
    'plan_documents',
    PLAN_DOCUMENTS_DDL,
    same(...PLAN_DOCUMENTS_COLUMNS.filter((c) => planCols.has(c))),
    [
      'CREATE INDEX idx_plan_documents_chat ON plan_documents(chat_id, created_at)',
      'CREATE INDEX idx_plan_documents_status ON plan_documents(chat_id, status)',
      'CREATE INDEX idx_plan_documents_stage ON plan_documents(stage_run_id)',
    ],
  );
  if (columnDefault(sqlite, 'conversation_instance_ownership', 'binding_origin') !== "'migrated-ambiguous'") rebuild(
    sqlite,
    'conversation_instance_ownership',
    CONVERSATION_INSTANCE_OWNERSHIP_DDL,
    same('conversation_id', 'instance_id', 'updated_at', 'provider', 'adapter_key', 'resume_cursor', 'runtime_payload', 'runtime_mode', 'binding_origin'),
    ['CREATE INDEX idx_conv_instance_ownership_instance ON conversation_instance_ownership(instance_id)'],
  );
  sqlite.exec(`DROP INDEX IF EXISTS idx_idempotency_keys_scope_expires`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires ON idempotency_keys(expires_at)`);
}

function convertDefinitions(sqlite: Database.Database, nowSec: number, log: (entity: string, id: string | null, message: string) => void): void {
  // 6. Definitions → v2 documents.
  const defs = sqlite.prepare(`SELECT * FROM workflow_definitions ORDER BY created_at, id`).all() as LegacyDefinitionRow[];
  const stagesOf = sqlite.prepare(`SELECT * FROM stage_definitions WHERE workflow_definition_id = ?`);
  const edgesOf = sqlite.prepare(`SELECT id, from_stage_id, to_stage_id, edge_type FROM stage_edges WHERE workflow_definition_id = ?`);
  const converted = defs.map((def) => ({
    def,
    result: convertLegacyDefinition(def, stagesOf.all(def.id) as LegacyStageRow[], edgesOf.all(def.id) as LegacyEdgeRow[]),
  }));

  sqlite.exec(`DROP TABLE stage_edges`);
  sqlite.exec(`DROP TABLE stage_definitions`);
  sqlite.exec(`DROP TABLE workflow_definitions`);
  sqlite.exec(`CREATE TABLE workflow_definitions (\n${WORKFLOW_DEFINITIONS_DDL}\n)`);
  sqlite.exec(`CREATE TABLE stage_definitions (\n${STAGE_DEFINITIONS_DDL}\n)`);
  sqlite.exec(`CREATE TABLE stage_edges (\n${STAGE_EDGES_DDL}\n)`);
  sqlite.exec(VERSIONS_DDL);
  for (const idx of [
    'CREATE INDEX idx_workflow_defs_created_at ON workflow_definitions(created_at)',
    'CREATE INDEX idx_workflow_defs_project ON workflow_definitions(project_id)',
    'CREATE INDEX idx_workflow_defs_status ON workflow_definitions(status)',
    'CREATE UNIQUE INDEX idx_stage_defs_key ON stage_definitions(workflow_definition_id, key)',
    'CREATE UNIQUE INDEX idx_stage_edges_pair ON stage_edges(workflow_definition_id, from_key, to_key)',
    'CREATE UNIQUE INDEX idx_wf_def_versions_version ON workflow_definition_versions(workflow_definition_id, version)',
    'CREATE INDEX idx_wf_def_versions_hash ON workflow_definition_versions(workflow_definition_id, content_hash)',
  ]) {
    sqlite.exec(idx);
  }

  const insDef = sqlite.prepare(
    `INSERT INTO workflow_definitions (id, name, description, project_id, status, revision, current_version_id, archived_at, needs_attention, spec, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'published', ?, ?, NULL, ?, ?, ?, ?)`,
  );
  const insStage = sqlite.prepare(
    `INSERT INTO stage_definitions (id, workflow_definition_id, key, name, ordinal, position_x, position_y, spec, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
  );
  const insEdge = sqlite.prepare(
    `INSERT INTO stage_edges (id, workflow_definition_id, from_key, to_key, edge_on, when_expr, handles_failure, ordinal)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
  );
  const insVersion = sqlite.prepare(
    `INSERT INTO workflow_definition_versions (id, workflow_definition_id, version, content_hash, kind, spec, created_at)
     VALUES (?, ?, 1, ?, 'published', ?, ?)`,
  );
  let attentionCount = 0;
  for (const { def, result } of converted) {
    const { graph } = result;
    const { name, description, projectId, ...workflowRest } = graph.workflow;
    const versionId = randomUUID();
    const attention = result.attention.length > 0 ? JSON.stringify(result.attention) : null;
    if (attention) attentionCount++;
    insDef.run(def.id, name, description ?? null, projectId ?? null, Math.max(1, def.version || 1), versionId, attention, JSON.stringify(workflowRest), def.created_at, def.updated_at);
    for (const s of result.stages) {
      const { key, name: stageName, position, ...stageRest } = s.spec;
      void position;
      insStage.run(s.id, def.id, key, stageName, s.ordinal, JSON.stringify(stageRest), def.created_at, def.updated_at);
    }
    graph.edges.forEach((e, i) => {
      insEdge.run(randomUUID(), def.id, e.from, e.to, e.on, e.when ?? null, i);
    });
    insVersion.run(versionId, def.id, result.contentHash, result.canonical, nowSec);
    for (const m of result.attention) log('workflow_definition', def.id, `needs attention: ${m}`);
    for (const m of result.log) log('workflow_definition', def.id, m);
  }
  if (defs.length > 0) log('workflow_definitions', null, `converted ${defs.length} definition(s) to v2 documents; ${attentionCount} need attention`);
}

function rebuildRunTables(sqlite: Database.Database): void {
  // 7. Run tables, now empty, pinned to versions and keyed by stage key.
  rebuild(sqlite, 'workflow_runs', WORKFLOW_RUNS_DDL, [], [
    'CREATE INDEX idx_workflow_runs_definition ON workflow_runs(workflow_definition_id)',
    'CREATE INDEX idx_workflow_runs_version ON workflow_runs(definition_version_id)',
    'CREATE INDEX idx_workflow_runs_project ON workflow_runs(project_id)',
    'CREATE INDEX idx_workflow_runs_status ON workflow_runs(status)',
    'CREATE INDEX idx_workflow_runs_created_at ON workflow_runs(created_at)',
    'CREATE INDEX idx_workflow_runs_status_created ON workflow_runs(status, created_at)',
    'CREATE INDEX idx_workflow_runs_ancestor ON workflow_runs(ancestor_run_id) WHERE ancestor_run_id IS NOT NULL',
  ]);
  rebuild(sqlite, 'stage_runs', STAGE_RUNS_DDL, [], [
    'CREATE INDEX idx_stage_runs_workflow_run ON stage_runs(workflow_run_id)',
    'CREATE INDEX idx_stage_runs_session ON stage_runs(session_id)',
    'CREATE INDEX idx_stage_runs_status ON stage_runs(status)',
    'CREATE INDEX idx_stage_runs_status_created ON stage_runs(status, created_at)',
    'CREATE INDEX idx_stage_runs_run_status ON stage_runs(workflow_run_id, status)',
  ]);
}

function rebuildAutomationExecutionRuns(sqlite: Database.Database): void {
  // 8. automation_execution_runs: workflow_run_id nullable, ON DELETE SET NULL.
  rebuild(sqlite, 'automation_execution_runs', AUTOMATION_EXECUTION_RUNS_DDL, [], [
    'CREATE INDEX idx_automation_exec_runs_execution ON automation_execution_runs(execution_id)',
    'CREATE INDEX idx_automation_exec_runs_workflow_run ON automation_execution_runs(workflow_run_id)',
    'CREATE INDEX idx_automation_exec_runs_status ON automation_execution_runs(status)',
    'CREATE INDEX idx_automation_exec_runs_iteration ON automation_execution_runs(iteration_index)',
  ]);
}
