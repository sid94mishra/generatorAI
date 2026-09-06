-- Schema dump of the v11 distribution template (packages/db/data/template.db, built 2026-06-21)
-- Captured verbatim from sqlite_master before the template was regenerated at v45.
-- Used by SchemaConvergence.test.ts as the "old install" an upgrade path starts from.
-- DO NOT regenerate this file from a newer database: its value is that it is OLD.

CREATE TABLE sessions (
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
    , conversation_id TEXT, owner_type TEXT, owner_id TEXT, closed_at INTEGER);

CREATE TABLE workflows (
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
    , harness_config_overrides TEXT);

CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      sequence_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      data TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    , workflow_run_id TEXT, stage_run_id TEXT);

CREATE TABLE event_sequences (
      session_id TEXT PRIMARY KEY,
      next_sequence INTEGER NOT NULL DEFAULT 1
    );

CREATE TABLE chat_messages (
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
    , metadata TEXT, chat_id TEXT);

CREATE TABLE artifacts (
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
    , workflow_run_id TEXT, stage_run_id TEXT);

CREATE TABLE webhook_registrations (
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

CREATE TABLE webhook_deliveries (
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

CREATE TABLE chats (
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
    , git_repositories TEXT, project_id TEXT, workspace_id TEXT, use_worktree INTEGER NOT NULL DEFAULT 1, codebase_ids TEXT, harness_config TEXT);

CREATE TABLE workflow_definitions (
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
    , scope TEXT DEFAULT 'global', project_id TEXT, selected_artifacts TEXT DEFAULT '{}', use_worktree INTEGER NOT NULL DEFAULT 1, hooks TEXT DEFAULT '[]', hooks_file TEXT, harness_config TEXT);

CREATE TABLE stage_definitions (
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
    , context_filter TEXT DEFAULT 'summary-only', agent_name TEXT, result_validation TEXT, expected_output TEXT, output_schema TEXT, iteration_config TEXT, context_sources TEXT, output_format TEXT DEFAULT 'text', harness_config_overrides TEXT);

CREATE TABLE stage_edges (
      id                       TEXT PRIMARY KEY,
      workflow_definition_id   TEXT NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
      from_stage_id            TEXT NOT NULL REFERENCES stage_definitions(id) ON DELETE CASCADE,
      to_stage_id              TEXT NOT NULL REFERENCES stage_definitions(id) ON DELETE CASCADE,
      edge_type                TEXT NOT NULL DEFAULT 'on_success'
    );

CREATE TABLE workflow_runs (
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
    , master_session_id TEXT, permission_mode TEXT, project_id TEXT, workspace_id TEXT, parent_stage_run_id TEXT);

CREATE TABLE stage_runs (
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
    , summary TEXT, version INTEGER NOT NULL DEFAULT 0, wake_at INTEGER, slept_since INTEGER, interrupt_data TEXT, output_data TEXT, artifact_manifest TEXT, iteration_index INTEGER DEFAULT 0, parent_stage_run_id TEXT);

CREATE TABLE automations (
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
    , batch_data_format TEXT, batch_data TEXT, batch_columns TEXT DEFAULT '[]', batch_column_mapping TEXT DEFAULT '{}', data_source_config TEXT, locked_until INTEGER, locked_by_process TEXT, scope TEXT DEFAULT 'global', project_id TEXT, use_worktree INTEGER NOT NULL DEFAULT 1);

CREATE TABLE automation_executions (
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
    , workspace_id TEXT);

CREATE TABLE automation_execution_runs (
      id                      TEXT PRIMARY KEY,
      execution_id            TEXT NOT NULL REFERENCES automation_executions(id) ON DELETE CASCADE,
      workflow_run_id         TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE SET NULL,
      workflow_definition_id  TEXT NOT NULL REFERENCES workflow_definitions(id),
      iteration_index         INTEGER NOT NULL DEFAULT 0,
      status                  TEXT NOT NULL DEFAULT 'pending',
      created_at              INTEGER NOT NULL
    , iteration_variables TEXT, iteration_label TEXT);

CREATE TABLE _schema_versions (
      version    INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL,
      name       TEXT NOT NULL
    );

CREATE TABLE session_allocations (
          id                TEXT PRIMARY KEY,
          workflow_run_id   TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
          mode              TEXT NOT NULL,
          shared_session_id TEXT,
          shared_ref_count  INTEGER NOT NULL DEFAULT 0,
          created_at        INTEGER NOT NULL
        );

CREATE TABLE stage_session_maps (
          id            TEXT PRIMARY KEY,
          allocation_id TEXT NOT NULL REFERENCES session_allocations(id) ON DELETE CASCADE,
          stage_run_id  TEXT NOT NULL,
          session_id    TEXT NOT NULL
        );

CREATE TABLE stream_cursors (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          scope      TEXT    NOT NULL,
          scope_id   TEXT    NOT NULL,
          seq        INTEGER NOT NULL,
          kind       TEXT    NOT NULL,
          payload    TEXT    NOT NULL,
          ts         INTEGER NOT NULL
        );

CREATE TABLE stream_sequences (
          scope     TEXT    NOT NULL,
          scope_id  TEXT    NOT NULL,
          last_seq  INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (scope, scope_id)
        );

CREATE TABLE projects (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          description TEXT,
          settings    TEXT DEFAULT '{}',
          root_path   TEXT NOT NULL,
          status      TEXT NOT NULL DEFAULT 'active',
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL
        );

CREATE TABLE project_codebases (
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

CREATE TABLE project_configs (
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

CREATE TABLE worktrees (
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

CREATE TABLE system_configs (
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

CREATE TABLE execution_workspaces (
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

CREATE TABLE workspace_worktrees (
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

CREATE TABLE workspace_artifacts (
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

CREATE INDEX idx_sessions_status ON sessions(status);

CREATE INDEX idx_sessions_created_at ON sessions(created_at);

CREATE INDEX idx_workflows_session_id ON workflows(session_id);

CREATE INDEX idx_workflows_status ON workflows(status);

CREATE INDEX idx_workflows_order ON workflows(session_id, "order");

CREATE UNIQUE INDEX idx_events_session_seq ON events(session_id, sequence_id);

CREATE INDEX idx_events_session_kind ON events(session_id, kind);

CREATE INDEX idx_events_timestamp ON events(timestamp);

CREATE INDEX idx_chat_session_id ON chat_messages(session_id);

CREATE INDEX idx_chat_session_time ON chat_messages(session_id, timestamp);

CREATE INDEX idx_artifacts_session_id ON artifacts(session_id);

CREATE INDEX idx_chats_status ON chats(status);

CREATE INDEX idx_chats_session_id ON chats(session_id);

CREATE INDEX idx_chats_created_at ON chats(created_at);

CREATE INDEX idx_workflow_defs_created_at ON workflow_definitions(created_at);

CREATE INDEX idx_stage_defs_workflow ON stage_definitions(workflow_definition_id);

CREATE INDEX idx_stage_defs_order ON stage_definitions(workflow_definition_id, "order");

CREATE INDEX idx_stage_edges_workflow ON stage_edges(workflow_definition_id);

CREATE INDEX idx_stage_edges_from ON stage_edges(from_stage_id);

CREATE INDEX idx_stage_edges_to ON stage_edges(to_stage_id);

CREATE UNIQUE INDEX idx_stage_edges_unique ON stage_edges(from_stage_id, to_stage_id);

CREATE INDEX idx_workflow_runs_definition ON workflow_runs(workflow_definition_id);

CREATE INDEX idx_workflow_runs_status ON workflow_runs(status);

CREATE INDEX idx_workflow_runs_created_at ON workflow_runs(created_at);

CREATE INDEX idx_stage_runs_workflow_run ON stage_runs(workflow_run_id);

CREATE INDEX idx_stage_runs_session ON stage_runs(session_id);

CREATE INDEX idx_stage_runs_status ON stage_runs(status);

CREATE INDEX idx_automations_enabled ON automations(enabled);

CREATE INDEX idx_automations_trigger_type ON automations(trigger_type);

CREATE INDEX idx_automations_created_at ON automations(created_at);

CREATE INDEX idx_automation_executions_automation ON automation_executions(automation_id);

CREATE INDEX idx_automation_executions_status ON automation_executions(status);

CREATE INDEX idx_automation_executions_created_at ON automation_executions(created_at);

CREATE INDEX idx_automation_exec_runs_execution ON automation_execution_runs(execution_id);

CREATE INDEX idx_automation_exec_runs_workflow_run ON automation_execution_runs(workflow_run_id);

CREATE INDEX idx_automation_exec_runs_status ON automation_execution_runs(status);

CREATE INDEX idx_automation_exec_runs_iteration ON automation_execution_runs(iteration_index);

CREATE INDEX idx_chat_messages_chat_id ON chat_messages(chat_id);

CREATE INDEX idx_webhook_deliveries_registration ON webhook_deliveries(registration_id);

CREATE INDEX idx_webhook_deliveries_status ON webhook_deliveries(status);

CREATE INDEX idx_workflow_runs_status_created ON workflow_runs(status, created_at);

CREATE INDEX idx_stage_runs_status_created ON stage_runs(status, created_at);

CREATE UNIQUE INDEX idx_webhook_deliveries_delivery_id ON webhook_deliveries(delivery_id);

CREATE UNIQUE INDEX idx_session_allocations_run ON session_allocations(workflow_run_id);

CREATE INDEX idx_stage_session_maps_allocation ON stage_session_maps(allocation_id);

CREATE UNIQUE INDEX idx_stage_session_maps_stage_run ON stage_session_maps(stage_run_id);

CREATE INDEX idx_automations_lock ON automations(locked_until);

CREATE UNIQUE INDEX idx_stream_cursors_scope_id_seq ON stream_cursors(scope, scope_id, seq);

CREATE INDEX idx_stream_cursors_ts ON stream_cursors(ts);

CREATE INDEX idx_stage_runs_wake_at ON stage_runs(wake_at);

CREATE INDEX idx_projects_status ON projects(status);

CREATE INDEX idx_projects_created_at ON projects(created_at);

CREATE INDEX idx_projects_name ON projects(name);

CREATE INDEX idx_project_codebases_project ON project_codebases(project_id);

CREATE UNIQUE INDEX idx_project_codebases_alias ON project_codebases(project_id, alias);

CREATE INDEX idx_project_codebases_status ON project_codebases(status);

CREATE INDEX idx_project_configs_project ON project_configs(project_id);

CREATE INDEX idx_project_configs_type ON project_configs(project_id, type);

CREATE UNIQUE INDEX idx_project_configs_unique_name ON project_configs(project_id, type, name);

CREATE INDEX idx_worktrees_project ON worktrees(project_id);

CREATE INDEX idx_worktrees_codebase ON worktrees(codebase_id);

CREATE INDEX idx_worktrees_run ON worktrees(run_id);

CREATE INDEX idx_worktrees_status ON worktrees(status);

CREATE INDEX idx_system_configs_type ON system_configs(type);

CREATE UNIQUE INDEX idx_system_configs_unique ON system_configs(type, name);

CREATE INDEX idx_workflow_defs_project ON workflow_definitions(project_id);

CREATE INDEX idx_automations_project ON automations(project_id);

CREATE UNIQUE INDEX idx_execution_workspaces_owner_unique ON execution_workspaces(owner_type, owner_id);

CREATE INDEX idx_execution_workspaces_owner ON execution_workspaces(owner_type, owner_id);

CREATE INDEX idx_execution_workspaces_project ON execution_workspaces(project_id);

CREATE INDEX idx_execution_workspaces_status ON execution_workspaces(status);

CREATE INDEX idx_workspace_worktrees_workspace ON workspace_worktrees(workspace_id);

CREATE INDEX idx_workspace_worktrees_codebase ON workspace_worktrees(codebase_id);

CREATE UNIQUE INDEX idx_workspace_worktrees_alias ON workspace_worktrees(workspace_id, alias);

CREATE INDEX idx_workspace_artifacts_workspace ON workspace_artifacts(workspace_id);

CREATE INDEX idx_workspace_artifacts_stage ON workspace_artifacts(stage_run_id);

CREATE INDEX idx_stage_runs_parent ON stage_runs(parent_stage_run_id);

CREATE INDEX idx_workflow_runs_parent_stage ON workflow_runs(parent_stage_run_id);

-- _schema_versions as recorded in the template
INSERT INTO _schema_versions (version, applied_at, name) VALUES (1, 0, 'phase1_schema_and_indexes');
INSERT INTO _schema_versions (version, applied_at, name) VALUES (2, 0, 'phase1_session_allocations');
INSERT INTO _schema_versions (version, applied_at, name) VALUES (3, 0, 'phase1_cron_lease');
INSERT INTO _schema_versions (version, applied_at, name) VALUES (4, 0, 'phase4_stream_cursors');
INSERT INTO _schema_versions (version, applied_at, name) VALUES (5, 0, 'dur05_stage_run_wake_at_index');
INSERT INTO _schema_versions (version, applied_at, name) VALUES (6, 0, 'project_codebase_management');
INSERT INTO _schema_versions (version, applied_at, name) VALUES (7, 0, 'system_configs_and_project_scoping');
INSERT INTO _schema_versions (version, applied_at, name) VALUES (8, 0, 'workspace_management');
INSERT INTO _schema_versions (version, applied_at, name) VALUES (9, 0, 'structured_outputs_and_iterations');
INSERT INTO _schema_versions (version, applied_at, name) VALUES (10, 0, 'workflow_level_hooks');
INSERT INTO _schema_versions (version, applied_at, name) VALUES (11, 0, 'harness_config_rename_backfill');
