// ────────────────────────────────────────────────────────────────
// @generatorai/db — Migration runner (extracted from index.ts)
// ────────────────────────────────────────────────────────────────

import type Database from 'better-sqlite3';
import type { AppDatabase } from '../index.js';

/** Run migrations — creates tables if they don't exist */
export function migrateDB(db: AppDatabase): void {
  const sqlite = (db as unknown as { session: { client: Database.Database } }).session.client;
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'created',
      model TEXT,
      repo_url TEXT,
      repo_branch TEXT,
      requires_codebase INTEGER NOT NULL DEFAULT 0,
      workspace_path TEXT,
      tags TEXT DEFAULT '[]',
      triggered_by TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at);

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      template_id TEXT NOT NULL,
      name TEXT NOT NULL,
      "order" INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      conversation_id TEXT,
      variables TEXT DEFAULT '{}',
      hook_overrides TEXT DEFAULT '{}',
      copilot_config_overrides TEXT,
      current_step INTEGER DEFAULT 0,
      total_steps INTEGER DEFAULT 0,
      error TEXT,
      started_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_workflows_session_id ON workflows(session_id);
    CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);
    CREATE INDEX IF NOT EXISTS idx_workflows_order ON workflows(session_id, "order");

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      sequence_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      data TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_events_session_seq ON events(session_id, sequence_id);
    CREATE INDEX IF NOT EXISTS idx_events_session_kind ON events(session_id, kind);
    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);

    -- Per-session sequence counter; atomic UPDATE ... RETURNING lets multiple
    -- processes allocate distinct sequence IDs without colliding on the
    -- (session_id, sequence_id) UNIQUE constraint on events.
    CREATE TABLE IF NOT EXISTS event_sequences (
      session_id TEXT PRIMARY KEY,
      next_sequence INTEGER NOT NULL DEFAULT 1
    );
    -- Seed from existing events so post-migration allocations don't overlap
    -- with the pre-migration in-memory counter's values.
    INSERT OR IGNORE INTO event_sequences (session_id, next_sequence)
    SELECT session_id, COALESCE(MAX(sequence_id), 0) + 1 FROM events GROUP BY session_id;

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      attachments TEXT,
      tool_name TEXT,
      tool_args TEXT,
      tool_result TEXT,
      workflow_id TEXT REFERENCES workflows(id),
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_session_id ON chat_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_chat_session_time ON chat_messages(session_id, timestamp);

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      workflow_id TEXT REFERENCES workflows(id),
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER NOT NULL,
      direction TEXT NOT NULL,
      content BLOB,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_artifacts_session_id ON artifacts(session_id);

    CREATE TABLE IF NOT EXISTS webhook_registrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source TEXT NOT NULL,
      event_type TEXT NOT NULL,
      condition TEXT,
      template_id TEXT NOT NULL,
      auto_start INTEGER NOT NULL DEFAULT 1,
      session_config TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      last_triggered_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      registration_id TEXT REFERENCES webhook_registrations(id),
      delivery_id TEXT,
      source TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT,
      status TEXT NOT NULL,
      error TEXT,
      session_id TEXT REFERENCES sessions(id),
      received_at INTEGER NOT NULL,
      processed_at INTEGER
    );
  `);

  // ── Incremental migrations (safe to run multiple times) ──
  // Helper: only ignore "duplicate column" errors from ALTER TABLE
  function safeAddColumn(sql: string): void {
    try {
      sqlite.exec(sql);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('duplicate column') || msg.includes('already exists') || msg.includes('no such table')) {
        // Column already exists or table doesn't exist yet (will be created with the column)
        return;
      }
      // Re-throw unexpected errors (permissions, disk full, etc.)
      throw err;
    }
  }

  // Add model column to sessions if it doesn't exist (for existing databases)
  safeAddColumn(`ALTER TABLE sessions ADD COLUMN model TEXT`);

  // Add metadata column to chat_messages for rich assistant message data
  // (thinking text, tool calls, system messages)
  safeAddColumn(`ALTER TABLE chat_messages ADD COLUMN metadata TEXT`);

  // ═══════════════════════════════════════════════════════════════
  // New columns on existing tables
  // ═══════════════════════════════════════════════════════════════

  // ── New columns on sessions ──
  safeAddColumn(`ALTER TABLE sessions ADD COLUMN conversation_id TEXT`);
  safeAddColumn(`ALTER TABLE sessions ADD COLUMN owner_type TEXT`);
  safeAddColumn(`ALTER TABLE sessions ADD COLUMN owner_id TEXT`);
  safeAddColumn(`ALTER TABLE sessions ADD COLUMN closed_at INTEGER`);

  // ── New columns on events ──
  safeAddColumn(`ALTER TABLE events ADD COLUMN workflow_run_id TEXT`);
  safeAddColumn(`ALTER TABLE events ADD COLUMN stage_run_id TEXT`);

  // ── New column on chat_messages ──
  safeAddColumn(`ALTER TABLE chat_messages ADD COLUMN chat_id TEXT`);

  // ── New column on workflow_definitions ──
  safeAddColumn(`ALTER TABLE workflow_definitions ADD COLUMN orchestrator_config TEXT`);

  // ── New columns on artifacts ──
  safeAddColumn(`ALTER TABLE artifacts ADD COLUMN workflow_run_id TEXT`);
  safeAddColumn(`ALTER TABLE artifacts ADD COLUMN stage_run_id TEXT`);

  // ── New table: chats ──
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      description   TEXT,
      session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      model         TEXT,
      copilot_config TEXT,
      repo_url      TEXT,
      repo_branch   TEXT,
      workspace_path TEXT,
      tags          TEXT DEFAULT '[]',
      status        TEXT NOT NULL DEFAULT 'active',
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chats_status ON chats(status);
    CREATE INDEX IF NOT EXISTS idx_chats_session_id ON chats(session_id);
    CREATE INDEX IF NOT EXISTS idx_chats_created_at ON chats(created_at);
  `);

  // ── New column on chats ──
  safeAddColumn(`ALTER TABLE chats ADD COLUMN git_repositories TEXT`);

  // ── New table: workflow_definitions ──
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS workflow_definitions (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      description    TEXT,
      version        INTEGER NOT NULL DEFAULT 1,
      session_mode   TEXT NOT NULL DEFAULT 'auto',
      copilot_config        TEXT,
      variables             TEXT DEFAULT '[]',
      tags                  TEXT DEFAULT '[]',
      orchestrator_config   TEXT,
      created_at            INTEGER NOT NULL,
      updated_at            INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_defs_created_at ON workflow_definitions(created_at);
  `);

  // ── New table: stage_definitions ──
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS stage_definitions (
      id                       TEXT PRIMARY KEY,
      workflow_definition_id   TEXT NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
      name                     TEXT NOT NULL,
      description              TEXT,
      template_id              TEXT,
      "order"                  INTEGER NOT NULL DEFAULT 0,
      prompts                  TEXT DEFAULT '[]',
      copilot_config_overrides TEXT,
      variables                TEXT DEFAULT '{}',
      hooks                    TEXT DEFAULT '[]',
      retry_policy             TEXT,
      timeout_ms               INTEGER,
      condition                TEXT,
      created_at               INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stage_defs_workflow ON stage_definitions(workflow_definition_id);
    CREATE INDEX IF NOT EXISTS idx_stage_defs_order ON stage_definitions(workflow_definition_id, "order");
  `);

  // ── New table: stage_edges ──
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS stage_edges (
      id                       TEXT PRIMARY KEY,
      workflow_definition_id   TEXT NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
      from_stage_id            TEXT NOT NULL REFERENCES stage_definitions(id) ON DELETE CASCADE,
      to_stage_id              TEXT NOT NULL REFERENCES stage_definitions(id) ON DELETE CASCADE,
      edge_type                TEXT NOT NULL DEFAULT 'on_success'
    );
    CREATE INDEX IF NOT EXISTS idx_stage_edges_workflow ON stage_edges(workflow_definition_id);
    CREATE INDEX IF NOT EXISTS idx_stage_edges_from ON stage_edges(from_stage_id);
    CREATE INDEX IF NOT EXISTS idx_stage_edges_to ON stage_edges(to_stage_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_stage_edges_unique ON stage_edges(from_stage_id, to_stage_id);
  `);

  // ── New table: workflow_runs ──
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id                       TEXT PRIMARY KEY,
      workflow_definition_id   TEXT NOT NULL REFERENCES workflow_definitions(id),
      name                     TEXT NOT NULL,
      status                   TEXT NOT NULL DEFAULT 'created',
      session_mode             TEXT NOT NULL DEFAULT 'auto',
      variables                TEXT DEFAULT '{}',
      error                    TEXT,
      created_at               INTEGER NOT NULL,
      updated_at               INTEGER NOT NULL,
      started_at               INTEGER,
      completed_at             INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_definition ON workflow_runs(workflow_definition_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_created_at ON workflow_runs(created_at);
  `);

  // Add master_session_id column if it doesn't exist
  try {
    sqlite.exec(`ALTER TABLE workflow_runs ADD COLUMN master_session_id TEXT`);
  } catch {
    // Column already exists — ignore
  }

  // ── New table: stage_runs ──
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS stage_runs (
      id                       TEXT PRIMARY KEY,
      workflow_run_id          TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      stage_definition_id      TEXT NOT NULL REFERENCES stage_definitions(id),
      session_id               TEXT REFERENCES sessions(id),
      name                     TEXT NOT NULL,
      status                   TEXT NOT NULL DEFAULT 'pending',
      current_step             INTEGER NOT NULL DEFAULT 0,
      total_steps              INTEGER NOT NULL DEFAULT 0,
      retry_count              INTEGER NOT NULL DEFAULT 0,
      error                    TEXT,
      created_at               INTEGER NOT NULL,
      started_at               INTEGER,
      completed_at             INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_stage_runs_workflow_run ON stage_runs(workflow_run_id);
    CREATE INDEX IF NOT EXISTS idx_stage_runs_session ON stage_runs(session_id);
    CREATE INDEX IF NOT EXISTS idx_stage_runs_status ON stage_runs(status);
  `);

  // ── New column on stage_runs for stage execution summaries ──
  safeAddColumn(`ALTER TABLE stage_runs ADD COLUMN summary TEXT`);

  // ═══════════════════════════════════════════════════════════════
  // Automations Tables
  // ═══════════════════════════════════════════════════════════════

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS automations (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      description      TEXT,
      enabled          INTEGER NOT NULL DEFAULT 1,
      trigger_type     TEXT NOT NULL,
      cron_expression  TEXT,
      webhook_token    TEXT,
      workflow_ids     TEXT NOT NULL DEFAULT '[]',
      input_mode       TEXT NOT NULL DEFAULT 'single',
      loop_variable    TEXT,
      loop_items       TEXT DEFAULT '[]',
      variables        TEXT DEFAULT '{}',
      max_concurrency  INTEGER NOT NULL DEFAULT 1,
      on_error         TEXT NOT NULL DEFAULT 'continue',
      last_run_at      INTEGER,
      next_run_at      INTEGER,
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_automations_enabled ON automations(enabled);
    CREATE INDEX IF NOT EXISTS idx_automations_trigger_type ON automations(trigger_type);
    CREATE INDEX IF NOT EXISTS idx_automations_created_at ON automations(created_at);
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS automation_executions (
      id                    TEXT PRIMARY KEY,
      automation_id         TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
      status                TEXT NOT NULL DEFAULT 'pending',
      triggered_by          TEXT NOT NULL,
      webhook_payload       TEXT,
      total_iterations      INTEGER NOT NULL DEFAULT 0,
      completed_iterations  INTEGER NOT NULL DEFAULT 0,
      failed_iterations     INTEGER NOT NULL DEFAULT 0,
      error                 TEXT,
      started_at            INTEGER,
      completed_at          INTEGER,
      created_at            INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_automation_executions_automation ON automation_executions(automation_id);
    CREATE INDEX IF NOT EXISTS idx_automation_executions_status ON automation_executions(status);
    CREATE INDEX IF NOT EXISTS idx_automation_executions_created_at ON automation_executions(created_at);
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS automation_execution_runs (
      id                      TEXT PRIMARY KEY,
      execution_id            TEXT NOT NULL REFERENCES automation_executions(id) ON DELETE CASCADE,
      workflow_run_id         TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE SET NULL,
      workflow_definition_id  TEXT NOT NULL REFERENCES workflow_definitions(id),
      iteration_index         INTEGER NOT NULL DEFAULT 0,
      status                  TEXT NOT NULL DEFAULT 'pending',
      created_at              INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_automation_exec_runs_execution ON automation_execution_runs(execution_id);
    CREATE INDEX IF NOT EXISTS idx_automation_exec_runs_workflow_run ON automation_execution_runs(workflow_run_id);
    CREATE INDEX IF NOT EXISTS idx_automation_exec_runs_status ON automation_execution_runs(status);
    CREATE INDEX IF NOT EXISTS idx_automation_exec_runs_iteration ON automation_execution_runs(iteration_index);
  `);

  // ── Batch mode migrations — add new columns to existing automation tables ──
  safeAddColumn(`ALTER TABLE automations ADD COLUMN batch_data_format TEXT`);
  safeAddColumn(`ALTER TABLE automations ADD COLUMN batch_data TEXT`);
  safeAddColumn(`ALTER TABLE automations ADD COLUMN batch_columns TEXT DEFAULT '[]'`);
  safeAddColumn(`ALTER TABLE automations ADD COLUMN batch_column_mapping TEXT DEFAULT '{}'`);
  safeAddColumn(`ALTER TABLE automation_execution_runs ADD COLUMN iteration_variables TEXT`);
  safeAddColumn(`ALTER TABLE automation_execution_runs ADD COLUMN iteration_label TEXT`);

  // ── E1: Dynamic data source migration ──
  safeAddColumn(`ALTER TABLE automations ADD COLUMN data_source_config TEXT`);

  // ══════════════════════════════════════════════════════════════════
  // Versioned migrations (Phase 1, 1.1).
  //
  // Everything above this block is the legacy idempotent "initial schema"
  // (version 0). From here on, schema changes are recorded in the
  // `_schema_versions` table so boot doesn't re-run every migration on
  // already-migrated DBs. Older tables still use the IF-NOT-EXISTS pattern
  // and remain forward-compatible.
  // ══════════════════════════════════════════════════════════════════

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS _schema_versions (
      version    INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL,
      name       TEXT NOT NULL
    );
  `);

  const currentVersionRow = sqlite
    .prepare(`SELECT COALESCE(MAX(version), 0) AS v FROM _schema_versions`)
    .get() as { v: number };
  const currentVersion = currentVersionRow?.v ?? 0;

  // ALTER TABLE ADD COLUMN needs to happen BEFORE the versioned migration
  // block, because some of those migrations create indexes over the new
  // columns. SQLite doesn't support `ADD COLUMN IF NOT EXISTS`, so we use
  // the existing `safeAddColumn` helper (swallows "duplicate column").
  // These are idempotent and cheap — fine to run every boot.
  safeAddColumn(`ALTER TABLE stage_runs ADD COLUMN version INTEGER NOT NULL DEFAULT 0`);
  safeAddColumn(`ALTER TABLE automations ADD COLUMN locked_until INTEGER`);
  safeAddColumn(`ALTER TABLE automations ADD COLUMN locked_by_process TEXT`);
  // DUR-05 — durable `step.sleep`. `wake_at` is the epoch-ms deadline the
  // sweeper compares against; `slept_since` is observability only.
  // These are nullable — active / terminal stages leave them NULL.
  safeAddColumn(`ALTER TABLE stage_runs ADD COLUMN wake_at INTEGER`);
  safeAddColumn(`ALTER TABLE stage_runs ADD COLUMN slept_since INTEGER`);
  // HITL-01 + HITL-02 — human-in-the-loop.
  //   `interrupt_data` (stage_runs): opaque JSON the stage wants an
  //   approver to review. Nullable; set on entry to awaiting_input.
  //   `permission_mode` (workflow_runs): run-level choice of auto vs
  //   prompt mode. Nullable for backward-compat — NULL is read as
  //   'bypassPermissions' (the default).
  safeAddColumn(`ALTER TABLE stage_runs ADD COLUMN interrupt_data TEXT`);
  safeAddColumn(`ALTER TABLE workflow_runs ADD COLUMN permission_mode TEXT`);

  // Project & Codebase Management — scope + projectId columns on existing tables
  safeAddColumn(`ALTER TABLE workflow_definitions ADD COLUMN scope TEXT DEFAULT 'global'`);
  safeAddColumn(`ALTER TABLE automations ADD COLUMN scope TEXT DEFAULT 'global'`);
  safeAddColumn(`ALTER TABLE workflow_runs ADD COLUMN project_id TEXT`);
  safeAddColumn(`ALTER TABLE chats ADD COLUMN project_id TEXT`);
  safeAddColumn(`ALTER TABLE workflow_definitions ADD COLUMN project_id TEXT`);
  safeAddColumn(`ALTER TABLE automations ADD COLUMN project_id TEXT`);
  safeAddColumn(`ALTER TABLE workflow_definitions ADD COLUMN selected_artifacts TEXT DEFAULT '{}'`);

  // Scenario 1 & 2: contextFilter and agentName for stage definitions
  safeAddColumn(`ALTER TABLE stage_definitions ADD COLUMN context_filter TEXT DEFAULT 'summary-only'`);
  safeAddColumn(`ALTER TABLE stage_definitions ADD COLUMN agent_name TEXT`);

  // Per-stage result validation rules (JSON array of ResultValidationRule)
  safeAddColumn(`ALTER TABLE stage_definitions ADD COLUMN result_validation TEXT`);

  // Workspace Management — workspace_id columns on existing tables
  safeAddColumn(`ALTER TABLE chats ADD COLUMN workspace_id TEXT`);
  safeAddColumn(`ALTER TABLE chats ADD COLUMN use_worktree INTEGER NOT NULL DEFAULT 1`);
  safeAddColumn(`ALTER TABLE workflow_runs ADD COLUMN workspace_id TEXT`);
  safeAddColumn(`ALTER TABLE workflow_definitions ADD COLUMN use_worktree INTEGER NOT NULL DEFAULT 1`);
  safeAddColumn(`ALTER TABLE automations ADD COLUMN use_worktree INTEGER NOT NULL DEFAULT 1`);
  safeAddColumn(`ALTER TABLE automation_executions ADD COLUMN workspace_id TEXT`);

  // ── Track A + C — automation correctness & schema-driven pipeline ──
  // Retry policy on automations, attempt_count on execution runs,
  // schema-driven columns on automations, and dataset snapshot on
  // executions. Nullable so pre-existing rows continue to work with
  // the legacy inline `inputMode` path.
  safeAddColumn(`ALTER TABLE automations ADD COLUMN retry_policy TEXT`);
  safeAddColumn(`ALTER TABLE automations ADD COLUMN data_schema TEXT`);
  safeAddColumn(`ALTER TABLE automations ADD COLUMN iteration_mode TEXT`);
  safeAddColumn(`ALTER TABLE automations ADD COLUMN default_dataset TEXT`);
  safeAddColumn(`ALTER TABLE automation_executions ADD COLUMN dataset_snapshot TEXT`);
  safeAddColumn(`ALTER TABLE automation_execution_runs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 1`);

  // Phase 9: Structured outputs, enhanced context, iteration support
  safeAddColumn(`ALTER TABLE stage_definitions ADD COLUMN expected_output TEXT`);
  safeAddColumn(`ALTER TABLE stage_definitions ADD COLUMN output_schema TEXT`);
  safeAddColumn(`ALTER TABLE stage_definitions ADD COLUMN iteration_config TEXT`);

  // Phase 10: Streamlined pipeline — contextSources + outputFormat
  safeAddColumn(`ALTER TABLE stage_definitions ADD COLUMN context_sources TEXT`);
  safeAddColumn(`ALTER TABLE stage_definitions ADD COLUMN output_format TEXT DEFAULT 'text'`);
  safeAddColumn(`ALTER TABLE stage_runs ADD COLUMN output_data TEXT`);
  // Full raw stage output for contextFilter='full' handoff (HANDOFF-1).
  safeAddColumn(`ALTER TABLE stage_runs ADD COLUMN output_text TEXT`);
  safeAddColumn(`ALTER TABLE stage_runs ADD COLUMN artifact_manifest TEXT`);
  safeAddColumn(`ALTER TABLE stage_runs ADD COLUMN iteration_index INTEGER DEFAULT 0`);
  safeAddColumn(`ALTER TABLE stage_runs ADD COLUMN parent_stage_run_id TEXT`);
  safeAddColumn(`ALTER TABLE workflow_runs ADD COLUMN parent_stage_run_id TEXT`);

  // Phase 11: Workflow-level hooks + hooks file support
  safeAddColumn(`ALTER TABLE workflow_definitions ADD COLUMN hooks TEXT DEFAULT '[]'`);
  safeAddColumn(`ALTER TABLE workflow_definitions ADD COLUMN hooks_file TEXT`);

  // Phase 12: Chat codebase_ids — persist selected codebase IDs on the chat
  safeAddColumn(`ALTER TABLE chats ADD COLUMN codebase_ids TEXT`);

  // Phase 13: Harness-config column rename (generic naming).
  // The physical columns were historically named `copilot_config*` from when
  // Copilot was the only supported harness. The system now supports multiple
  // harnesses (Copilot SDK, Claude Agent SDK, …), so the Drizzle schema uses
  // generic `harness_config*` columns. Add the new columns here (idempotent on
  // both fresh and existing DBs); existing data is backfilled by versioned
  // migration 11 below. The old `copilot_config*` columns are RETAINED
  // (deprecated, no DROP) so pre-existing databases stay readable.
  safeAddColumn(`ALTER TABLE workflows ADD COLUMN harness_config_overrides TEXT`);
  safeAddColumn(`ALTER TABLE chats ADD COLUMN harness_config TEXT`);
  safeAddColumn(`ALTER TABLE workflow_definitions ADD COLUMN harness_config TEXT`);
  safeAddColumn(`ALTER TABLE stage_definitions ADD COLUMN harness_config_overrides TEXT`);

  // Stage-level review gate. When 1, the stage parks in `awaiting_input`
  // after its work + hooks complete and waits for a human approve or
  // feedback follow-up before the DAG advances. Default 0 (auto-advance).
  safeAddColumn(`ALTER TABLE stage_definitions ADD COLUMN approval_required INTEGER NOT NULL DEFAULT 0`);

  // NOTE: Integrated Browser columns (browser_config, browser_status, ...)
  // are added inside the versioned v13 migration below so they run AFTER
  // `execution_workspaces` is guaranteed to exist (v8 creates it). Using
  // `safeAddColumn` here would silently no-op on fresh DBs where the table
  // hasn't been created yet, leaving v13's index creation to fail on the
  // missing browser_status column.

  /**
   * Each migration is a numbered, idempotent block. Adding a new Phase N
   * migration: pick the next version number, add the object below, do
   * NOT modify older ones. Statements run in a single SQLite transaction
   * so a mid-block failure rolls back.
   */
  const migrations: Array<{ version: number; name: string; sql: string[] }> = [
    {
      version: 1,
      name: 'phase1_schema_and_indexes',
      sql: [
        // 1.2: missing indexes
        `CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON chat_messages(chat_id);`,
        `CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_registration ON webhook_deliveries(registration_id);`,
        `CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status);`,
        `CREATE INDEX IF NOT EXISTS idx_workflow_runs_status_created ON workflow_runs(status, created_at);`,
        `CREATE INDEX IF NOT EXISTS idx_stage_runs_status_created ON stage_runs(status, created_at);`,

        // 1.13: webhook delivery id UNIQUE — enables dedup by idempotency key
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_deliveries_delivery_id ON webhook_deliveries(delivery_id);`,

        // 1.25: optimistic-lock version column on stage_runs
        // (uses the safe ALTER helper defined above)
      ],
    },
    {
      version: 2,
      name: 'phase1_session_allocations',
      sql: [
        // 1.6: persistent SessionAllocator state
        `
        CREATE TABLE IF NOT EXISTS session_allocations (
          id                TEXT PRIMARY KEY,
          workflow_run_id   TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
          mode              TEXT NOT NULL,
          shared_session_id TEXT,
          shared_ref_count  INTEGER NOT NULL DEFAULT 0,
          created_at        INTEGER NOT NULL
        );
        `,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_session_allocations_run ON session_allocations(workflow_run_id);`,
        `
        CREATE TABLE IF NOT EXISTS stage_session_maps (
          id            TEXT PRIMARY KEY,
          allocation_id TEXT NOT NULL REFERENCES session_allocations(id) ON DELETE CASCADE,
          stage_run_id  TEXT NOT NULL,
          session_id    TEXT NOT NULL
        );
        `,
        `CREATE INDEX IF NOT EXISTS idx_stage_session_maps_allocation ON stage_session_maps(allocation_id);`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_stage_session_maps_stage_run ON stage_session_maps(stage_run_id);`,
      ],
    },
    {
      version: 3,
      name: 'phase1_cron_lease',
      sql: [
        // 1.23: row-level lease columns — added via safeAddColumn outside this
        // array since ALTER TABLE ADD COLUMN IF NOT EXISTS isn't universally
        // supported. See the ALTER calls below.
        `CREATE INDEX IF NOT EXISTS idx_automations_lock ON automations(locked_until);`,
      ],
    },
    {
      // STR-02 / Phase 4 streaming rewrite — persistent log for the
      // new StreamBroker. Coexists with the legacy `events` table.
      version: 4,
      name: 'phase4_stream_cursors',
      sql: [
        `
        CREATE TABLE IF NOT EXISTS stream_cursors (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          scope      TEXT    NOT NULL,
          scope_id   TEXT    NOT NULL,
          seq        INTEGER NOT NULL,
          kind       TEXT    NOT NULL,
          payload    TEXT    NOT NULL,
          ts         INTEGER NOT NULL
        );
        `,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_stream_cursors_scope_id_seq ON stream_cursors(scope, scope_id, seq);`,
        `CREATE INDEX IF NOT EXISTS idx_stream_cursors_ts ON stream_cursors(ts);`,
        `
        CREATE TABLE IF NOT EXISTS stream_sequences (
          scope     TEXT    NOT NULL,
          scope_id  TEXT    NOT NULL,
          last_seq  INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (scope, scope_id)
        );
        `,
      ],
    },
    {
      // DUR-05 — durable step.sleep sweeper needs a fast lookup of sleeping
      // stages whose wake_at has passed. The column was added via the
      // `safeAddColumn` block above (earlier, before versioned migrations
      // run); the index goes in the versioned list so it only creates once.
      version: 5,
      name: 'dur05_stage_run_wake_at_index',
      sql: [
        `CREATE INDEX IF NOT EXISTS idx_stage_runs_wake_at ON stage_runs(wake_at);`,
      ],
    },
    {
      // Project & Codebase Management — new tables + scope columns
      version: 6,
      name: 'project_codebase_management',
      sql: [
        // ── Projects ──
        `
        CREATE TABLE IF NOT EXISTS projects (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          description TEXT,
          settings    TEXT DEFAULT '{}',
          root_path   TEXT NOT NULL,
          status      TEXT NOT NULL DEFAULT 'active',
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL
        );
        `,
        `CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);`,
        `CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at);`,
        `CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);`,

        // ── Project Codebases ──
        `
        CREATE TABLE IF NOT EXISTS project_codebases (
          id              TEXT PRIMARY KEY,
          project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          alias           TEXT NOT NULL,
          type            TEXT NOT NULL,
          url             TEXT,
          local_path      TEXT,
          default_branch  TEXT,
          subdirectory    TEXT,
          clone_path      TEXT,
          status          TEXT NOT NULL DEFAULT 'pending',
          last_fetched_at INTEGER,
          last_error      TEXT,
          settings        TEXT DEFAULT '{}',
          created_at      INTEGER NOT NULL,
          updated_at      INTEGER NOT NULL
        );
        `,
        `CREATE INDEX IF NOT EXISTS idx_project_codebases_project ON project_codebases(project_id);`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_project_codebases_alias ON project_codebases(project_id, alias);`,
        `CREATE INDEX IF NOT EXISTS idx_project_codebases_status ON project_codebases(status);`,

        // ── Project Configs ──
        `
        CREATE TABLE IF NOT EXISTS project_configs (
          id          TEXT PRIMARY KEY,
          project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          type        TEXT NOT NULL,
          name        TEXT NOT NULL,
          description TEXT,
          file_path   TEXT NOT NULL,
          metadata    TEXT DEFAULT '{}',
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL
        );
        `,
        `CREATE INDEX IF NOT EXISTS idx_project_configs_project ON project_configs(project_id);`,
        `CREATE INDEX IF NOT EXISTS idx_project_configs_type ON project_configs(project_id, type);`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_project_configs_unique_name ON project_configs(project_id, type, name);`,

        // ── Worktrees ──
        `
        CREATE TABLE IF NOT EXISTS worktrees (
          id             TEXT PRIMARY KEY,
          project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          codebase_id    TEXT NOT NULL REFERENCES project_codebases(id) ON DELETE CASCADE,
          run_id         TEXT,
          run_type       TEXT,
          worktree_path  TEXT NOT NULL,
          branch_name    TEXT NOT NULL,
          status         TEXT NOT NULL DEFAULT 'active',
          created_at     INTEGER NOT NULL,
          cleaned_up_at  INTEGER
        );
        `,
        `CREATE INDEX IF NOT EXISTS idx_worktrees_project ON worktrees(project_id);`,
        `CREATE INDEX IF NOT EXISTS idx_worktrees_codebase ON worktrees(codebase_id);`,
        `CREATE INDEX IF NOT EXISTS idx_worktrees_run ON worktrees(run_id);`,
        `CREATE INDEX IF NOT EXISTS idx_worktrees_status ON worktrees(status);`,
      ],
    },
    {
      // Phase 7: System configs + project scoping indexes
      version: 7,
      name: 'system_configs_and_project_scoping',
      sql: [
        `
        CREATE TABLE IF NOT EXISTS system_configs (
          id          TEXT PRIMARY KEY,
          type        TEXT NOT NULL CHECK(type IN ('agent', 'prompt', 'skill')),
          name        TEXT NOT NULL,
          description TEXT,
          file_path   TEXT NOT NULL,
          version     TEXT DEFAULT '1.0.0',
          metadata    TEXT DEFAULT '{}',
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL
        );
        `,
        `CREATE INDEX IF NOT EXISTS idx_system_configs_type ON system_configs(type);`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_system_configs_unique ON system_configs(type, name);`,
        `CREATE INDEX IF NOT EXISTS idx_workflow_defs_project ON workflow_definitions(project_id);`,
        `CREATE INDEX IF NOT EXISTS idx_automations_project ON automations(project_id);`,
      ],
    },
    {
      // Phase 8: Workspace Management — execution_workspaces, workspace_worktrees, workspace_artifacts
      version: 8,
      name: 'workspace_management',
      sql: [
        // ── Execution Workspaces ──
        `
        CREATE TABLE IF NOT EXISTS execution_workspaces (
          id          TEXT PRIMARY KEY,
          owner_type  TEXT NOT NULL CHECK(owner_type IN ('chat', 'workflow_run', 'automation_execution')),
          owner_id    TEXT NOT NULL,
          project_id  TEXT,
          root_path   TEXT NOT NULL,
          status      TEXT NOT NULL DEFAULT 'creating'
            CHECK(status IN ('creating', 'active', 'completed', 'archived', 'failed')),
          git_enabled INTEGER NOT NULL DEFAULT 1,
          use_worktree INTEGER NOT NULL DEFAULT 1,
          snapshot_path TEXT,
          metadata    TEXT,
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL,
          completed_at INTEGER,
          archived_at INTEGER
        );
        `,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_workspaces_owner_unique ON execution_workspaces(owner_type, owner_id);`,
        `CREATE INDEX IF NOT EXISTS idx_execution_workspaces_owner ON execution_workspaces(owner_type, owner_id);`,
        `CREATE INDEX IF NOT EXISTS idx_execution_workspaces_project ON execution_workspaces(project_id);`,
        `CREATE INDEX IF NOT EXISTS idx_execution_workspaces_status ON execution_workspaces(status);`,

        // ── Workspace Worktrees ──
        `
        CREATE TABLE IF NOT EXISTS workspace_worktrees (
          id                      TEXT PRIMARY KEY,
          workspace_id            TEXT NOT NULL REFERENCES execution_workspaces(id) ON DELETE CASCADE,
          codebase_id             TEXT NOT NULL,
          alias                   TEXT NOT NULL,
          branch_name             TEXT NOT NULL,
          base_branch             TEXT NOT NULL DEFAULT 'main',
          relative_path           TEXT NOT NULL,
          status                  TEXT NOT NULL DEFAULT 'active'
            CHECK(status IN ('active', 'committed', 'pushed', 'deleted', 'error')),
          commit_hash             TEXT,
          has_uncommitted_changes INTEGER DEFAULT 0,
          created_at              INTEGER NOT NULL,
          updated_at              INTEGER NOT NULL
        );
        `,
        `CREATE INDEX IF NOT EXISTS idx_workspace_worktrees_workspace ON workspace_worktrees(workspace_id);`,
        `CREATE INDEX IF NOT EXISTS idx_workspace_worktrees_codebase ON workspace_worktrees(codebase_id);`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_worktrees_alias ON workspace_worktrees(workspace_id, alias);`,

        // ── Workspace Artifacts ──
        `
        CREATE TABLE IF NOT EXISTS workspace_artifacts (
          id              TEXT PRIMARY KEY,
          workspace_id    TEXT NOT NULL REFERENCES execution_workspaces(id) ON DELETE CASCADE,
          stage_run_id    TEXT,
          artifact_type   TEXT NOT NULL
            CHECK(artifact_type IN ('code_file', 'response_md', 'attachment', 'script_output', 'log', 'snapshot')),
          relative_path   TEXT NOT NULL,
          file_size       INTEGER,
          mime_type       TEXT,
          metadata        TEXT,
          created_at      INTEGER NOT NULL
        );
        `,
        `CREATE INDEX IF NOT EXISTS idx_workspace_artifacts_workspace ON workspace_artifacts(workspace_id);`,
        `CREATE INDEX IF NOT EXISTS idx_workspace_artifacts_stage ON workspace_artifacts(stage_run_id);`,
      ],
    },
    {
      // Phase 9: Structured outputs, enhanced context, iteration support
      version: 9,
      name: 'structured_outputs_and_iterations',
      sql: [
        `CREATE INDEX IF NOT EXISTS idx_stage_runs_parent ON stage_runs(parent_stage_run_id);`,
        `CREATE INDEX IF NOT EXISTS idx_workflow_runs_parent_stage ON workflow_runs(parent_stage_run_id);`,
      ],
    },
    {
      // Phase 10: Workflow-level lifecycle hooks + hooks file support
      version: 10,
      name: 'workflow_level_hooks',
      sql: [
        // No indexes needed — hooks are loaded with the definition (already cached)
      ],
    },
    {
      // Phase 11: Backfill the generic `harness_config*` columns from the
      // deprecated `copilot_config*` columns. The new columns are created by the
      // `safeAddColumn` block above (which runs before this loop), so they are
      // guaranteed to exist here. Runs once; old columns are left in place.
      version: 11,
      name: 'harness_config_rename_backfill',
      sql: [
        `UPDATE workflows SET harness_config_overrides = copilot_config_overrides WHERE harness_config_overrides IS NULL AND copilot_config_overrides IS NOT NULL;`,
        `UPDATE chats SET harness_config = copilot_config WHERE harness_config IS NULL AND copilot_config IS NOT NULL;`,
        `UPDATE workflow_definitions SET harness_config = copilot_config WHERE harness_config IS NULL AND copilot_config IS NOT NULL;`,
        `UPDATE stage_definitions SET harness_config_overrides = copilot_config_overrides WHERE harness_config_overrides IS NULL AND copilot_config_overrides IS NOT NULL;`,
      ],
    },
    {
      // DUR-06 + P0#5 — composite indexes for the two hottest run/chat-scoped
      // scans:
      //   * stage_runs(workflow_run_id, status): the scheduler/poller filters a
      //     run's stages by status (getReadyStages, getByStatus, recovery) on
      //     every scheduling decision — the single-column status index forced a
      //     scan across all runs' stages.
      //   * chat_messages(chat_id, timestamp): paginated history ("latest N,
      //     then older") orders by timestamp within a chat.
      version: 12,
      name: 'composite_indexes_stage_runs_and_chat_messages',
      sql: [
        `CREATE INDEX IF NOT EXISTS idx_stage_runs_run_status ON stage_runs(workflow_run_id, status);`,
        `CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_time ON chat_messages(chat_id, timestamp);`,
      ],
    },
    {
      // Phase 13: Integrated Browser feature. Rebuild `workspace_artifacts` so
      // the artifact_type CHECK constraint permits the new browser_* types.
      // SQLite doesn't support ALTER ... CHECK — the canonical way is
      // create-new / copy / drop-old / rename. Legacy rows are preserved.
      //
      // Also adds the browser_* columns to execution_workspaces (v8-created)
      // and a status index on browser_status so BrowserService's recovery-
      // on-boot pass can find lingering sessions.
      version: 13,
      name: 'integrated_browser_artifact_types',
      sql: [
        // 0. Add browser_* columns to execution_workspaces. These live in a
        //    versioned block (not the top-level safeAddColumn stack) so they
        //    run AFTER v8 creates the table on fresh DBs. safeAddColumn
        //    would silently swallow "no such table" and skip them.
        `ALTER TABLE execution_workspaces ADD COLUMN browser_config TEXT;`,
        `ALTER TABLE execution_workspaces ADD COLUMN browser_status TEXT;`,
        `ALTER TABLE execution_workspaces ADD COLUMN browser_current_url TEXT;`,
        `ALTER TABLE execution_workspaces ADD COLUMN browser_cdp_endpoint TEXT;`,
        `ALTER TABLE execution_workspaces ADD COLUMN browser_target_id TEXT;`,
        `ALTER TABLE execution_workspaces ADD COLUMN browser_started_at INTEGER;`,
        `ALTER TABLE execution_workspaces ADD COLUMN browser_last_activity_at INTEGER;`,
        // 1. Create the replacement workspace_artifacts table with the
        //    expanded CHECK.
        `
        CREATE TABLE IF NOT EXISTS workspace_artifacts_v13 (
          id              TEXT PRIMARY KEY,
          workspace_id    TEXT NOT NULL REFERENCES execution_workspaces(id) ON DELETE CASCADE,
          stage_run_id    TEXT,
          artifact_type   TEXT NOT NULL
            CHECK(artifact_type IN (
              'code_file', 'response_md', 'attachment', 'script_output', 'log', 'snapshot',
              'browser_screenshot', 'browser_dom', 'browser_har',
              'browser_console_log', 'browser_video', 'browser_selection'
            )),
          relative_path   TEXT NOT NULL,
          file_size       INTEGER,
          mime_type       TEXT,
          metadata        TEXT,
          created_at      INTEGER NOT NULL
        );
        `,
        // 2. Copy existing rows over.
        `
        INSERT INTO workspace_artifacts_v13
          (id, workspace_id, stage_run_id, artifact_type, relative_path, file_size, mime_type, metadata, created_at)
        SELECT
          id, workspace_id, stage_run_id, artifact_type, relative_path, file_size, mime_type, metadata, created_at
        FROM workspace_artifacts;
        `,
        // 3. Drop old + rename.
        `DROP TABLE workspace_artifacts;`,
        `ALTER TABLE workspace_artifacts_v13 RENAME TO workspace_artifacts;`,
        // 4. Recreate indexes on the renamed table.
        `CREATE INDEX IF NOT EXISTS idx_workspace_artifacts_workspace ON workspace_artifacts(workspace_id);`,
        `CREATE INDEX IF NOT EXISTS idx_workspace_artifacts_stage ON workspace_artifacts(stage_run_id);`,
        `CREATE INDEX IF NOT EXISTS idx_workspace_artifacts_type ON workspace_artifacts(artifact_type);`,
        // 5. Browser status index for BrowserService's recovery-on-boot pass.
        `CREATE INDEX IF NOT EXISTS idx_execution_workspaces_browser_status ON execution_workspaces(browser_status);`,
      ],
    },
    {
      // Phase 14: Widgets & Extensions. `widget_instances` table backs
      // ExtensionService/WidgetService — persisted so refreshing the page
      // replays the same widget UI (see chatMessageToBlocks on the client).
      // Extension state on disk is scanned at boot; nothing to persist in DB.
      version: 14,
      name: 'widgets_and_extensions',
      sql: [
        `
        CREATE TABLE IF NOT EXISTS widget_instances (
          id                TEXT PRIMARY KEY,
          descriptor_id     TEXT NOT NULL,
          session_id        TEXT NOT NULL,
          chat_id           TEXT,
          workflow_run_id   TEXT,
          stage_run_id      TEXT,
          message_id        TEXT,
          surface           TEXT NOT NULL CHECK(surface IN ('inline', 'canvas', 'right-pane')),
          props             TEXT,
          state             TEXT,
          status            TEXT NOT NULL DEFAULT 'active'
            CHECK(status IN ('active', 'suspended', 'closed', 'error')),
          error             TEXT,
          created_at        INTEGER NOT NULL,
          updated_at        INTEGER NOT NULL
        );
        `,
        `CREATE INDEX IF NOT EXISTS idx_widget_instances_session ON widget_instances(session_id);`,
        `CREATE INDEX IF NOT EXISTS idx_widget_instances_chat ON widget_instances(chat_id);`,
        `CREATE INDEX IF NOT EXISTS idx_widget_instances_run ON widget_instances(workflow_run_id);`,
        `CREATE INDEX IF NOT EXISTS idx_widget_instances_stage ON widget_instances(stage_run_id);`,
      ],
    },
    {
      // Track A + Track C — Automation correctness, durability, and
      // schema-driven pipeline.
      //   A2 — retry policy column on automations + attempt_count on runs.
      //   A3 — idempotency_keys table.
      //   C2 — data_schema, iteration_mode, default_dataset on
      //        automations; dataset_snapshot on automation_executions.
      // All ALTERs are done via safeAddColumn helper (see below) since
      // SQLite doesn't support ADD COLUMN IF NOT EXISTS. This block only
      // creates the new idempotency_keys table and indexes.
      version: 15,
      name: 'automation_retry_schema_and_idempotency',
      sql: [
        `
        CREATE TABLE IF NOT EXISTS idempotency_keys (
          key           TEXT NOT NULL,
          scope         TEXT NOT NULL,
          execution_id  TEXT NOT NULL,
          created_at    INTEGER NOT NULL,
          expires_at    INTEGER NOT NULL,
          PRIMARY KEY (key, scope)
        );
        `,
        `CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires ON idempotency_keys(expires_at);`,
      ],
    },
    {
      // Phase 16: Widget surface model collapsed to two values
      // ('inline' | 'widget'). The v14 CHECK constraint only allowed
      // 'inline' / 'canvas' / 'right-pane', so we rebuild the table (SQLite
      // cannot ALTER a CHECK) and remap legacy values:
      //   canvas / right-pane / widget → 'widget'
      //   chat / inline               → 'inline'
      version: 16,
      name: 'widget_surface_inline_or_widget',
      sql: [
        `
        CREATE TABLE widget_instances_new (
          id                TEXT PRIMARY KEY,
          descriptor_id     TEXT NOT NULL,
          session_id        TEXT NOT NULL,
          chat_id           TEXT,
          workflow_run_id   TEXT,
          stage_run_id      TEXT,
          message_id        TEXT,
          surface           TEXT NOT NULL CHECK(surface IN ('inline', 'widget')),
          props             TEXT,
          state             TEXT,
          status            TEXT NOT NULL DEFAULT 'active'
            CHECK(status IN ('active', 'suspended', 'closed', 'error')),
          error             TEXT,
          created_at        INTEGER NOT NULL,
          updated_at        INTEGER NOT NULL
        );
        `,
        `
        INSERT INTO widget_instances_new
          (id, descriptor_id, session_id, chat_id, workflow_run_id, stage_run_id,
           message_id, surface, props, state, status, error, created_at, updated_at)
        SELECT
          id, descriptor_id, session_id, chat_id, workflow_run_id, stage_run_id,
          message_id,
          CASE WHEN surface IN ('inline', 'chat') THEN 'inline' ELSE 'widget' END,
          props, state, status, error, created_at, updated_at
        FROM widget_instances;
        `,
        `DROP TABLE widget_instances;`,
        `ALTER TABLE widget_instances_new RENAME TO widget_instances;`,
        `CREATE INDEX IF NOT EXISTS idx_widget_instances_session ON widget_instances(session_id);`,
        `CREATE INDEX IF NOT EXISTS idx_widget_instances_chat ON widget_instances(chat_id);`,
        `CREATE INDEX IF NOT EXISTS idx_widget_instances_run ON widget_instances(workflow_run_id);`,
        `CREATE INDEX IF NOT EXISTS idx_widget_instances_stage ON widget_instances(stage_run_id);`,
      ],
    },
    {
      // Phase 17: Orchestrator mode. Adds background-agent columns to `chats`:
      //   orchestrator_mode      — this chat runs the orchestrator prompt+tools
      //   parent_chat_id         — set on WORKER chats → their orchestrator
      //   background_task_name/index/status — worker task metadata
      // Plain ADD COLUMN (runs exactly once, guarded by version + transaction).
      version: 17,
      name: 'orchestrator_mode_background_tasks',
      sql: [
        `ALTER TABLE chats ADD COLUMN orchestrator_mode INTEGER NOT NULL DEFAULT 0;`,
        `ALTER TABLE chats ADD COLUMN parent_chat_id TEXT;`,
        `ALTER TABLE chats ADD COLUMN background_task_name TEXT;`,
        `ALTER TABLE chats ADD COLUMN background_task_index INTEGER;`,
        `ALTER TABLE chats ADD COLUMN background_task_status TEXT;`,
        `CREATE INDEX IF NOT EXISTS idx_chats_parent_chat_id ON chats(parent_chat_id);`,
      ],
    },
    {
      // Phase 18: Workspace checkpoints. One row per snapshot of a workspace
      // repository's working tree. `ref_value` is a git commit object that is
      // reachable ONLY from `refs/generatorai/checkpoints/…` (never a branch,
      // never pushed); `tree_sha` is the snapshot content every diff uses.
      //
      // Deliberately not FK-constrained to `execution_workspaces`: checkpoints
      // must survive long enough to answer "what did this run change?" even
      // after aggressive workspace cleanup, and are pruned by policy instead.
      version: 18,
      name: 'workspace_checkpoints',
      sql: [
        `
        CREATE TABLE IF NOT EXISTS checkpoints (
          id                           TEXT PRIMARY KEY,
          workspace_id                 TEXT NOT NULL,
          repo_alias                   TEXT NOT NULL DEFAULT '.',
          seq                          INTEGER NOT NULL,
          kind                         TEXT NOT NULL
            CHECK(kind IN ('baseline','turn','stage','autorun','live','manual','pre_restore')),
          label                        TEXT,
          ref_kind                     TEXT NOT NULL DEFAULT 'git_tree',
          ref_value                    TEXT NOT NULL,
          tree_sha                     TEXT NOT NULL,
          parent_id                    TEXT,
          session_id                   TEXT,
          chat_id                      TEXT,
          turn_id                      TEXT,
          workflow_run_id              TEXT,
          stage_run_id                 TEXT,
          automation_execution_run_id  TEXT,
          prompt_excerpt               TEXT,
          file_count                   INTEGER NOT NULL DEFAULT 0,
          additions                    INTEGER NOT NULL DEFAULT 0,
          deletions                    INTEGER NOT NULL DEFAULT 0,
          created_at                   INTEGER NOT NULL
        );
        `,
        `CREATE INDEX IF NOT EXISTS idx_checkpoints_workspace ON checkpoints(workspace_id);`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_checkpoints_ws_alias_seq ON checkpoints(workspace_id, repo_alias, seq);`,
        `CREATE INDEX IF NOT EXISTS idx_checkpoints_turn ON checkpoints(turn_id);`,
        `CREATE INDEX IF NOT EXISTS idx_checkpoints_stage_run ON checkpoints(stage_run_id);`,
        `CREATE INDEX IF NOT EXISTS idx_checkpoints_kind ON checkpoints(kind);`,
      ],
    },
    {
      // Phase 19: Inline review comments on diffs.
      //
      // A thread is anchored to a line range in a file against a specific
      // base→head checkpoint pair. `anchor_text` / `anchor_hash` are what
      // make the anchor survive later edits — line numbers are re-derived by
      // content match rather than trusted, so a comment never silently drifts
      // onto unrelated code.
      version: 19,
      name: 'review_threads_and_comments',
      sql: [
        `
        CREATE TABLE IF NOT EXISTS review_threads (
          id                        TEXT PRIMARY KEY,
          workspace_id              TEXT NOT NULL,
          scope                     TEXT NOT NULL CHECK(scope IN ('chat','run','automation')),
          scope_id                  TEXT NOT NULL,
          repo_alias                TEXT NOT NULL DEFAULT '.',
          path                      TEXT NOT NULL,
          base_checkpoint_id        TEXT NOT NULL,
          head_checkpoint_id        TEXT NOT NULL,
          side                      TEXT NOT NULL CHECK(side IN ('additions','deletions')),
          start_line                INTEGER NOT NULL,
          end_line                  INTEGER NOT NULL,
          anchor_text               TEXT NOT NULL,
          anchor_hash               TEXT NOT NULL,
          status                    TEXT NOT NULL DEFAULT 'pending'
            CHECK(status IN ('draft','pending','submitted','addressed','resolved','outdated')),
          resolved_by_checkpoint_id TEXT,
          submitted_message_id      TEXT,
          review_round              INTEGER NOT NULL DEFAULT 0,
          created_at                INTEGER NOT NULL,
          updated_at                INTEGER NOT NULL
        );
        `,
        `CREATE INDEX IF NOT EXISTS idx_review_threads_workspace ON review_threads(workspace_id);`,
        `CREATE INDEX IF NOT EXISTS idx_review_threads_scope ON review_threads(scope, scope_id);`,
        `CREATE INDEX IF NOT EXISTS idx_review_threads_file ON review_threads(workspace_id, repo_alias, path);`,
        `CREATE INDEX IF NOT EXISTS idx_review_threads_status ON review_threads(status);`,
        `
        CREATE TABLE IF NOT EXISTS review_comments (
          id         TEXT PRIMARY KEY,
          thread_id  TEXT NOT NULL REFERENCES review_threads(id) ON DELETE CASCADE,
          author     TEXT NOT NULL CHECK(author IN ('user','agent')),
          body       TEXT NOT NULL,
          intent     TEXT CHECK(intent IS NULL OR intent IN ('fix','question','note','refactor','test')),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        `,
        `CREATE INDEX IF NOT EXISTS idx_review_comments_thread ON review_comments(thread_id);`,
      ],
    },
    {
      // A turn/stage writes two checkpoints sharing one turn_id: `before`
      // (what the prompt was written against) and `after` (what the agent
      // left behind). Without this column the pair is indistinguishable and
      // "what did this turn change?" degrades to guessing at sequence order.
      version: 20,
      name: 'checkpoint_phase',
      sql: [`ALTER TABLE checkpoints ADD COLUMN phase TEXT;`],
    },
    {
      // Phase 21 (PLN-01): Plan mode.
      //
      // A plan is a first-class, revisable document owned by a chat. The DB is
      // authoritative; the markdown file under `.generatorai/plans/` is only a
      // projection (deliberately git-IGNORED so draft plans never pollute the
      // Changes panel, checkpoints, or commits).
      //
      // `agent_interactions` generalises HITL beyond stage runs: a chat can
      // block an in-flight SDK callback on a human decision. Unlike a stage
      // run, a chat gate CANNOT be resumed after a restart — the blocked
      // vendor callback is gone — hence the `expired` status and the partial
      // unique index that allows exactly one pending gate per turn+kind.
      version: 21,
      name: 'plan_mode',
      sql: [
        `
        CREATE TABLE IF NOT EXISTS plan_documents (
          id                 TEXT PRIMARY KEY,
          chat_id            TEXT NOT NULL,
          session_id         TEXT NOT NULL,
          turn_id            TEXT NOT NULL,
          title              TEXT NOT NULL,
          file_name          TEXT NOT NULL,
          file_path          TEXT,
          status             TEXT NOT NULL DEFAULT 'drafting'
            CHECK(status IN ('drafting','awaiting_review','changes_requested','approved','rejected','superseded','expired')),
          current_revision   INTEGER NOT NULL DEFAULT 1,
          harness_type       TEXT NOT NULL DEFAULT 'copilot',
          available_actions  TEXT NOT NULL DEFAULT '[]',
          recommended_action TEXT,
          decision           TEXT,
          created_at         INTEGER NOT NULL,
          updated_at         INTEGER NOT NULL
        );
        `,
        `CREATE INDEX IF NOT EXISTS idx_plan_documents_chat ON plan_documents(chat_id, created_at);`,
        `CREATE INDEX IF NOT EXISTS idx_plan_documents_status ON plan_documents(chat_id, status);`,
        `
        CREATE TABLE IF NOT EXISTS plan_revisions (
          id          TEXT PRIMARY KEY,
          plan_id     TEXT NOT NULL REFERENCES plan_documents(id) ON DELETE CASCADE,
          revision    INTEGER NOT NULL,
          content     TEXT NOT NULL,
          summary     TEXT NOT NULL DEFAULT '',
          authored_by TEXT NOT NULL DEFAULT 'agent' CHECK(authored_by IN ('agent','user')),
          created_at  INTEGER NOT NULL
        );
        `,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_revisions_unique ON plan_revisions(plan_id, revision);`,
        `
        CREATE TABLE IF NOT EXISTS plan_comments (
          id                TEXT PRIMARY KEY,
          plan_id           TEXT NOT NULL REFERENCES plan_documents(id) ON DELETE CASCADE,
          revision          INTEGER NOT NULL,
          anchor_start_line INTEGER,
          anchor_end_line   INTEGER,
          anchor_text       TEXT,
          anchor_hash       TEXT,
          body              TEXT NOT NULL,
          resolved          INTEGER NOT NULL DEFAULT 0,
          created_at        INTEGER NOT NULL
        );
        `,
        `CREATE INDEX IF NOT EXISTS idx_plan_comments_plan ON plan_comments(plan_id, revision);`,
        `
        CREATE TABLE IF NOT EXISTS agent_interactions (
          id          TEXT PRIMARY KEY,
          scope_kind  TEXT NOT NULL CHECK(scope_kind IN ('chat','stage_run')),
          scope_id    TEXT NOT NULL,
          chat_id     TEXT,
          session_id  TEXT,
          turn_id     TEXT,
          kind        TEXT NOT NULL CHECK(kind IN ('plan_review','question','tool_permission')),
          status      TEXT NOT NULL DEFAULT 'pending'
            CHECK(status IN ('pending','approved','changes_requested','answered','rejected','cancelled','expired','failed')),
          payload     TEXT,
          resolution  TEXT,
          created_at  INTEGER NOT NULL,
          resolved_at INTEGER,
          expires_at  INTEGER
        );
        `,
        `CREATE INDEX IF NOT EXISTS idx_agent_interactions_chat ON agent_interactions(chat_id, status);`,
        `CREATE INDEX IF NOT EXISTS idx_agent_interactions_scope ON agent_interactions(scope_kind, scope_id, status);`,
        // Exactly one unresolved gate per (chat, turn, kind). A partial index
        // is what makes "only one approver wins" enforceable at the DB level.
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_interactions_pending
           ON agent_interactions(chat_id, turn_id, kind) WHERE status = 'pending';`,
        `ALTER TABLE chats ADD COLUMN default_agent_mode TEXT NOT NULL DEFAULT 'interactive';`,
        `ALTER TABLE chats ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'bypassPermissions';`,
      ],
    },
    {
      // ── v22 — agent mode rename + per-stage agent mode ──
      //
      // `interactive` is renamed to `auto` so the chat composer reads
      // Auto / Plan. The old name survives only as an inbound API alias
      // (`coerceAgentMode`); nothing is persisted with it after this runs.
      //
      // `stage_definitions.agent_mode` lets a workflow stage opt into plan
      // mode independently of the run, mirroring a chat's per-turn mode.
      version: 22,
      name: 'agent_mode_rename',
      sql: [
        `UPDATE chats SET default_agent_mode = 'auto' WHERE default_agent_mode = 'interactive';`,
        // Column default must move too, otherwise new rows written by an old
        // build (or by a raw INSERT) would reintroduce the legacy value.
        // SQLite cannot ALTER a default in place, so re-point it via a
        // generated-name swap only if the table was created with the old
        // default. Cheapest correct approach: leave the DDL default alone and
        // rely on the repository always supplying an explicit value, then
        // normalise on read. The UPDATE above handles all existing rows.
        `ALTER TABLE stage_definitions ADD COLUMN agent_mode TEXT;`,
        // Plans can now originate from a workflow stage, and can be recorded
        // without ever opening a gate (`status = 'recorded'`).
        `ALTER TABLE plan_documents ADD COLUMN stage_run_id TEXT;`,
        `ALTER TABLE plan_documents ADD COLUMN workflow_run_id TEXT;`,
        `CREATE INDEX IF NOT EXISTS idx_plan_documents_stage ON plan_documents(stage_run_id);`,
      ],
    },
    {
      // ── v23 — allow the `recorded` plan status ──
      //
      // v21 pinned the status set with a CHECK constraint, and SQLite cannot
      // alter a constraint in place — the table has to be rebuilt. `recorded`
      // is a plan captured in a non-blocking mode: real document, real file,
      // but no gate was ever opened, so it must never render approve buttons.
      version: 23,
      name: 'plan_status_recorded',
      sql: [
        `CREATE TABLE plan_documents_v23 (
          id                 TEXT PRIMARY KEY,
          chat_id            TEXT NOT NULL,
          session_id         TEXT NOT NULL,
          turn_id            TEXT NOT NULL,
          title              TEXT NOT NULL,
          file_name          TEXT NOT NULL,
          file_path          TEXT,
          status             TEXT NOT NULL DEFAULT 'drafting'
            CHECK(status IN ('drafting','recorded','awaiting_review','changes_requested','approved','rejected','superseded','expired')),
          current_revision   INTEGER NOT NULL DEFAULT 1,
          harness_type       TEXT NOT NULL DEFAULT 'copilot',
          available_actions  TEXT NOT NULL DEFAULT '[]',
          recommended_action TEXT,
          decision           TEXT,
          stage_run_id       TEXT,
          workflow_run_id    TEXT,
          created_at         INTEGER NOT NULL,
          updated_at         INTEGER NOT NULL
        );`,
        `INSERT INTO plan_documents_v23 (
          id, chat_id, session_id, turn_id, title, file_name, file_path, status,
          current_revision, harness_type, available_actions, recommended_action,
          decision, stage_run_id, workflow_run_id, created_at, updated_at
        )
        SELECT
          id, chat_id, session_id, turn_id, title, file_name, file_path, status,
          current_revision, harness_type, available_actions, recommended_action,
          decision, stage_run_id, workflow_run_id, created_at, updated_at
        FROM plan_documents;`,
        `DROP TABLE plan_documents;`,
        `ALTER TABLE plan_documents_v23 RENAME TO plan_documents;`,
        // Indexes do not survive the rebuild.
        `CREATE INDEX IF NOT EXISTS idx_plan_documents_chat ON plan_documents(chat_id, created_at);`,
        `CREATE INDEX IF NOT EXISTS idx_plan_documents_status ON plan_documents(chat_id, status);`,
        `CREATE INDEX IF NOT EXISTS idx_plan_documents_stage ON plan_documents(stage_run_id);`,
      ],
    },
    {
      // ── v24 — security: device identity, DPoP, audit, relay, harness
      //         instances, SSH targets.
      //
      // See docs/SECURITY_AUTH_RELAY_MOBILE_ARCHITECTURE_PLAN.md §28.
      //
      // Storage rules enforced here:
      //   * Pairing grants, resume credentials, service-account secrets,
      //     stream tickets and DPoP jtis are stored as HASHES only.
      //   * Private keys never touch the database — they live in the
      //     SecretStore and are referenced by `secret_ref`.
      //   * Every "single use" credential has an `expires_at` and a UNIQUE
      //     index so the atomic consume is enforced by the engine, not by a
      //     read-then-write race in application code.
      version: 24,
      name: 'security_device_auth_relay',
      sql: [
        `CREATE TABLE IF NOT EXISTS auth_devices (
          device_id                       TEXT PRIMARY KEY,
          owner_id                        TEXT NOT NULL DEFAULT 'local',
          name                            TEXT NOT NULL,
          platform                        TEXT NOT NULL DEFAULT 'other'
            CHECK(platform IN ('web','desktop','cli','mobile','other')),
          public_jwk                      TEXT NOT NULL,
          jwk_thumbprint                  TEXT NOT NULL,
          scopes                          TEXT NOT NULL DEFAULT '[]',
          created_at                      INTEGER NOT NULL,
          last_seen_at                    INTEGER,
          last_seen_transport             TEXT,
          revoked_at                      INTEGER,
          revoked_reason                  TEXT,
          credential_version              INTEGER NOT NULL DEFAULT 1,
          previous_credential_grace_until INTEGER,
          connection_mode                 TEXT NOT NULL DEFAULT 'auto',
          relay_binding                   TEXT
        );`,
        // Partial unique index: a thumbprint may be reused only after the
        // owning device has been revoked.
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_devices_thumbprint_active
           ON auth_devices(jwk_thumbprint) WHERE revoked_at IS NULL;`,
        `CREATE INDEX IF NOT EXISTS idx_auth_devices_owner ON auth_devices(owner_id, created_at);`,

        `CREATE TABLE IF NOT EXISTS auth_device_credentials (
          credential_id TEXT PRIMARY KEY,
          device_id     TEXT NOT NULL,
          secret_hash   TEXT NOT NULL UNIQUE,
          version       INTEGER NOT NULL DEFAULT 1,
          created_at    INTEGER NOT NULL,
          expires_at    INTEGER,
          last_used_at  INTEGER,
          revoked_at    INTEGER
        );`,
        `CREATE INDEX IF NOT EXISTS idx_auth_device_credentials_device
           ON auth_device_credentials(device_id, created_at);`,

        `CREATE TABLE IF NOT EXISTS auth_pairing_grants (
          grant_id             TEXT PRIMARY KEY,
          token_hash           TEXT NOT NULL UNIQUE,
          device_name_hint     TEXT NOT NULL,
          platform             TEXT NOT NULL DEFAULT 'other',
          requested_scopes     TEXT NOT NULL DEFAULT '[]',
          created_at           INTEGER NOT NULL,
          expires_at           INTEGER NOT NULL,
          consumed_at          INTEGER,
          revoked_at           INTEGER,
          attempts             INTEGER NOT NULL DEFAULT 0,
          max_attempts         INTEGER NOT NULL DEFAULT 5,
          relay_invite         TEXT,
          created_by_principal TEXT NOT NULL DEFAULT 'unknown'
        );`,
        `CREATE INDEX IF NOT EXISTS idx_auth_pairing_pending
           ON auth_pairing_grants(expires_at) WHERE consumed_at IS NULL AND revoked_at IS NULL;`,

        `CREATE TABLE IF NOT EXISTS auth_replay_entries (
          jti_hash   TEXT PRIMARY KEY,
          expires_at INTEGER NOT NULL
        );`,
        `CREATE INDEX IF NOT EXISTS idx_auth_replay_expiry ON auth_replay_entries(expires_at);`,

        `CREATE TABLE IF NOT EXISTS auth_nonces (
          nonce      TEXT PRIMARY KEY,
          expires_at INTEGER NOT NULL
        );`,
        `CREATE INDEX IF NOT EXISTS idx_auth_nonces_expiry ON auth_nonces(expires_at);`,

        `CREATE TABLE IF NOT EXISTS auth_stream_tickets (
          ticket_hash    TEXT PRIMARY KEY,
          principal_id   TEXT NOT NULL,
          principal_type TEXT NOT NULL,
          device_id      TEXT,
          scopes         TEXT NOT NULL DEFAULT '[]',
          scope          TEXT NOT NULL,
          scope_id       TEXT,
          created_at     INTEGER NOT NULL,
          expires_at     INTEGER NOT NULL,
          consumed_at    INTEGER
        );`,
        `CREATE INDEX IF NOT EXISTS idx_auth_stream_tickets_expiry ON auth_stream_tickets(expires_at);`,

        `CREATE TABLE IF NOT EXISTS auth_service_accounts (
          account_id   TEXT PRIMARY KEY,
          name         TEXT NOT NULL,
          secret_hash  TEXT NOT NULL UNIQUE,
          scopes       TEXT NOT NULL DEFAULT '[]',
          created_at   INTEGER NOT NULL,
          last_used_at INTEGER,
          revoked_at   INTEGER,
          legacy       INTEGER NOT NULL DEFAULT 0
        );`,

        `CREATE TABLE IF NOT EXISTS security_audit_events (
          event_id            TEXT PRIMARY KEY,
          timestamp           INTEGER NOT NULL,
          actor_principal_type TEXT NOT NULL,
          actor_principal_id   TEXT NOT NULL,
          actor_device_id      TEXT,
          action              TEXT NOT NULL,
          resource_type       TEXT,
          resource_id         TEXT,
          result              TEXT NOT NULL CHECK(result IN ('success','failure','denied')),
          reason_code         TEXT,
          request_id          TEXT,
          connection_id       TEXT,
          transport           TEXT,
          source_address_hash TEXT,
          metadata            TEXT,
          severity            TEXT NOT NULL DEFAULT 'info'
            CHECK(severity IN ('info','warn','critical'))
        );`,
        `CREATE INDEX IF NOT EXISTS idx_security_audit_time ON security_audit_events(timestamp DESC);`,
        `CREATE INDEX IF NOT EXISTS idx_security_audit_action ON security_audit_events(action, timestamp DESC);`,
        `CREATE INDEX IF NOT EXISTS idx_security_audit_device ON security_audit_events(actor_device_id, timestamp DESC);`,

        `CREATE TABLE IF NOT EXISTS relay_revoke_outbox (
          id              TEXT PRIMARY KEY,
          relay_binding   TEXT NOT NULL,
          device_id       TEXT NOT NULL,
          enqueued_at     INTEGER NOT NULL,
          attempts        INTEGER NOT NULL DEFAULT 0,
          last_attempt_at INTEGER,
          last_error      TEXT
        );`,
        `CREATE INDEX IF NOT EXISTS idx_relay_revoke_outbox_time ON relay_revoke_outbox(enqueued_at);`,

        `CREATE TABLE IF NOT EXISTS signed_links (
          jti           TEXT PRIMARY KEY,
          resource_type TEXT NOT NULL,
          resource_id   TEXT NOT NULL,
          scopes        TEXT NOT NULL DEFAULT '[]',
          created_at    INTEGER NOT NULL,
          expires_at    INTEGER NOT NULL,
          max_uses      INTEGER NOT NULL DEFAULT 1,
          uses          INTEGER NOT NULL DEFAULT 0,
          revoked_at    INTEGER,
          created_by    TEXT
        );`,

        // Harness instances — multiple isolated accounts of the SAME provider.
        // `credential_refs` holds SecretStore pointers only; never secrets.
        `CREATE TABLE IF NOT EXISTS harness_instances (
          instance_id        TEXT PRIMARY KEY,
          driver_type        TEXT NOT NULL,
          display_name       TEXT NOT NULL,
          config             TEXT NOT NULL DEFAULT '{}',
          credential_refs    TEXT NOT NULL DEFAULT '{}',
          home_directory     TEXT,
          allowed_project_ids TEXT NOT NULL DEFAULT '[]',
          default_model      TEXT,
          permission_profile TEXT NOT NULL DEFAULT 'workspace-write',
          enabled            INTEGER NOT NULL DEFAULT 1,
          created_at         INTEGER NOT NULL,
          updated_at         INTEGER NOT NULL
        );`,
        `CREATE INDEX IF NOT EXISTS idx_harness_instances_driver ON harness_instances(driver_type);`,

        `CREATE TABLE IF NOT EXISTS ssh_targets (
          target_id       TEXT PRIMARY KEY,
          name            TEXT NOT NULL,
          host            TEXT NOT NULL,
          port            INTEGER NOT NULL DEFAULT 22,
          username        TEXT NOT NULL,
          auth_method     TEXT NOT NULL DEFAULT 'agent'
            CHECK(auth_method IN ('agent','key','password')),
          private_key_ref TEXT,
          proxy_jump      TEXT,
          remote_port     INTEGER NOT NULL DEFAULT 3100,
          local_port      INTEGER,
          created_at      INTEGER NOT NULL,
          updated_at      INTEGER NOT NULL
        );`,
        `CREATE TABLE IF NOT EXISTS ssh_host_keys (
          id           TEXT PRIMARY KEY,
          host         TEXT NOT NULL,
          port         INTEGER NOT NULL DEFAULT 22,
          key_type     TEXT NOT NULL,
          fingerprint  TEXT NOT NULL,
          trusted_at   INTEGER NOT NULL,
          trusted_by   TEXT
        );`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_ssh_host_keys_host ON ssh_host_keys(host, port, key_type);`,
      ],
    },

    {
      version: 25,
      name: 'device_push_registry',
      sql: [
        // Push tokens for paired devices.
        //
        // A SEPARATE table rather than a column on `auth_devices`, for three
        // reasons that all bite later otherwise:
        //   1. A token is platform-specific credential material with its own
        //      lifecycle — it rotates independently of the device and can be
        //      invalidated by the OS at any time.
        //   2. Revoking a device must delete the token, and a cascade makes
        //      that structural rather than something a service must remember.
        //   3. `auth_devices.relay_binding` already means something else
        //      entirely (relay stream revocation); overloading it would break
        //      revocation propagation in a way no test would catch.
        `CREATE TABLE IF NOT EXISTS device_push_tokens (
          device_id     TEXT PRIMARY KEY
                        REFERENCES auth_devices(device_id) ON DELETE CASCADE,
          provider      TEXT NOT NULL CHECK(provider IN ('expo','apns','fcm')),
          token         TEXT NOT NULL,
          platform      TEXT NOT NULL,
          created_at    INTEGER NOT NULL,
          updated_at    INTEGER NOT NULL,
          -- Consecutive delivery failures. A token the push service has
          -- rejected repeatedly is dead; retrying it forever wastes quota and
          -- can get the whole sender throttled.
          failure_count INTEGER NOT NULL DEFAULT 0,
          last_error    TEXT,
          -- Per-device mute, so one noisy project cannot make the user turn
          -- off notifications entirely and miss the approval gates.
          muted_until   INTEGER
        );`,
        `CREATE INDEX IF NOT EXISTS idx_device_push_provider ON device_push_tokens(provider);`,
      ],
    },
  ];


  for (const m of migrations) {
    if (m.version <= currentVersion) continue;
    sqlite.exec('BEGIN');
    try {
      for (const stmt of m.sql) sqlite.exec(stmt);
      sqlite
        .prepare(`INSERT INTO _schema_versions (version, applied_at, name) VALUES (?, ?, ?)`)
        .run(m.version, Date.now(), m.name);
      sqlite.exec('COMMIT');
    } catch (err) {
      try { sqlite.exec('ROLLBACK'); } catch { /* best effort */ }
      throw new Error(
        `Migration ${m.version} (${m.name}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
