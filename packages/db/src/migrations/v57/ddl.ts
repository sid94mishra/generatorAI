// ────────────────────────────────────────────────────────────────
// Frozen schema of migration v57 `workflow_engine_v2` (RV-33).
//
// The run-side tables of the v2 engine (G5 §6.2 plus the PHASE-03 WP-3.2
// column additions), as the DDL v57 creates. Migration code never imports
// `schema.ts`: this file is the migration's own copy and is pinned by
// `migrations.lock.json` (it is one of v57's `lockFiles`). Never edit it;
// a later schema change is a new migration.
//
// Timestamps in every table below are epoch MILLISECONDS (the v1 tables
// stored seconds; one-second heartbeats reaped healthy stages, STATUS.md
// P00 timing notes).
// ────────────────────────────────────────────────────────────────

export const WORKFLOW_RUN_STATES_SQL = `'created', 'starting', 'running', 'waiting', 'paused', 'finalizing', 'cancelling', 'completed', 'failed', 'cancelled'`;

export const STAGE_RUN_STATES_SQL = `'pending', 'ready', 'starting', 'running', 'validating', 'awaiting_input', 'waiting', 'retry_wait', 'paused', 'completed', 'failed', 'skipped', 'cancelled'`;

export const WORKFLOW_RUNS_DDL = `CREATE TABLE workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_definition_id TEXT NOT NULL REFERENCES workflow_definitions(id),
  definition_version_id TEXT NOT NULL REFERENCES workflow_definition_versions(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN (${WORKFLOW_RUN_STATES_SQL})),
  status_reason TEXT,
  outcome TEXT CHECK (outcome IN ('completed', 'failed', 'cancelled')),
  version INTEGER NOT NULL DEFAULT 0,
  variables TEXT NOT NULL DEFAULT '{}',
  permission_mode TEXT NOT NULL,
  project_id TEXT,
  workspace_id TEXT,
  trigger TEXT,
  invocation_id TEXT,
  idempotency_key TEXT,
  parent_run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
  parent_stage_run_id TEXT REFERENCES stage_runs(id) ON DELETE SET NULL,
  root_run_id TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0,
  ancestor_run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
  fork_spec TEXT,
  run_overrides TEXT,
  stage_overrides TEXT,
  codebase_selection TEXT,
  system_vars TEXT,
  budget TEXT,
  usage TEXT NOT NULL DEFAULT '{}',
  owner_id TEXT,
  owner_epoch INTEGER NOT NULL DEFAULT 0,
  owner_expires_at INTEGER,
  run_seq INTEGER NOT NULL DEFAULT 0,
  agent_snapshot TEXT,
  error TEXT,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER
)`;

export const WORKFLOW_RUNS_INDEXES = [
  'CREATE INDEX idx_workflow_runs_definition ON workflow_runs(workflow_definition_id)',
  'CREATE INDEX idx_workflow_runs_version ON workflow_runs(definition_version_id)',
  'CREATE INDEX idx_workflow_runs_project ON workflow_runs(project_id)',
  'CREATE INDEX idx_workflow_runs_status ON workflow_runs(status)',
  'CREATE INDEX idx_workflow_runs_created_at ON workflow_runs(created_at)',
  'CREATE INDEX idx_workflow_runs_status_created ON workflow_runs(status, created_at)',
  'CREATE INDEX idx_workflow_runs_ancestor ON workflow_runs(ancestor_run_id) WHERE ancestor_run_id IS NOT NULL',
  'CREATE INDEX idx_workflow_runs_parent_stage ON workflow_runs(parent_stage_run_id) WHERE parent_stage_run_id IS NOT NULL',
  'CREATE INDEX idx_workflow_runs_parent_run ON workflow_runs(parent_run_id) WHERE parent_run_id IS NOT NULL',
  'CREATE UNIQUE INDEX idx_workflow_runs_idempotency ON workflow_runs(idempotency_key) WHERE idempotency_key IS NOT NULL',
];

export const STAGE_RUNS_DDL = `CREATE TABLE stage_runs (
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'agent',
  name TEXT NOT NULL,
  instance_path TEXT NOT NULL,
  scope_id TEXT REFERENCES stage_runs(id) ON DELETE CASCADE,
  iteration_index INTEGER,
  item_index INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (${STAGE_RUN_STATES_SQL})),
  status_reason TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  current_attempt INTEGER NOT NULL DEFAULT 0,
  epoch INTEGER NOT NULL DEFAULT 1,
  session_key TEXT,
  session_id TEXT REFERENCES sessions(id),
  skip_reason TEXT,
  skip_cause_id TEXT,
  gate_as TEXT CHECK (gate_as IN ('completed', 'skipped')),
  output_data TEXT,
  output_text TEXT,
  summary TEXT,
  artifact_manifest TEXT,
  loop_state TEXT,
  expansion TEXT,
  interrupt_data TEXT,
  usage TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  error_class TEXT,
  error_code TEXT,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  heartbeat_at INTEGER,
  last_progress_at INTEGER,
  copied_from_stage_run_id TEXT,
  amended_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER
)`;

export const STAGE_RUNS_INDEXES = [
  'CREATE UNIQUE INDEX idx_stage_runs_instance ON stage_runs(workflow_run_id, instance_path)',
  'CREATE INDEX idx_stage_runs_workflow_run ON stage_runs(workflow_run_id)',
  'CREATE INDEX idx_stage_runs_run_status ON stage_runs(workflow_run_id, status)',
  'CREATE INDEX idx_stage_runs_session ON stage_runs(session_id)',
  'CREATE INDEX idx_stage_runs_status ON stage_runs(status)',
  'CREATE INDEX idx_stage_runs_status_created ON stage_runs(status, created_at)',
  'CREATE INDEX idx_stage_runs_scope ON stage_runs(scope_id)',
  'CREATE INDEX idx_stage_runs_lease ON stage_runs(status, lease_expires_at) WHERE lease_expires_at IS NOT NULL',
  `CREATE INDEX idx_stage_runs_attention ON stage_runs(status) WHERE status IN ('awaiting_input', 'paused')`,
];

export const STAGE_ATTEMPTS_DDL = `CREATE TABLE stage_attempts (
  id TEXT PRIMARY KEY,
  stage_run_id TEXT NOT NULL REFERENCES stage_runs(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('fresh', 'resume', 'restart')),
  epoch INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'aborted', 'interrupted')),
  session_id TEXT,
  repair_count INTEGER NOT NULL DEFAULT 0,
  structured_output TEXT,
  agent_snapshot TEXT,
  judge TEXT,
  error TEXT,
  error_class TEXT,
  error_code TEXT,
  error_details TEXT,
  overrides TEXT,
  checkpoint_before_id TEXT,
  usage TEXT NOT NULL DEFAULT '{}',
  started_at INTEGER NOT NULL,
  ended_at INTEGER
)`;

export const STAGE_ATTEMPTS_INDEXES = [
  'CREATE UNIQUE INDEX idx_stage_attempts_no ON stage_attempts(stage_run_id, attempt_no)',
];

export const RUN_SESSIONS_DDL = `CREATE TABLE run_sessions (
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  session_key TEXT NOT NULL,
  session_id TEXT NOT NULL,
  owner_scope_id TEXT,
  config_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released')),
  created_at INTEGER NOT NULL,
  released_at INTEGER
)`;

export const RUN_SESSIONS_INDEXES = [
  'CREATE UNIQUE INDEX idx_run_sessions_key ON run_sessions(workflow_run_id, session_key)',
];

export const WORKFLOW_TIMERS_DDL = `CREATE TABLE workflow_timers (
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  stage_run_id TEXT REFERENCES stage_runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  fire_at INTEGER NOT NULL,
  fired_at INTEGER,
  cancelled_at INTEGER,
  payload TEXT
)`;

export const WORKFLOW_TIMERS_INDEXES = [
  'CREATE INDEX idx_workflow_timers_due ON workflow_timers(fire_at) WHERE fired_at IS NULL AND cancelled_at IS NULL',
  `CREATE UNIQUE INDEX idx_workflow_timers_live_kind ON workflow_timers(workflow_run_id, IFNULL(stage_run_id, ''), kind) WHERE fired_at IS NULL AND cancelled_at IS NULL`,
];

export const WORKFLOW_OUTBOX_DDL = `CREATE TABLE workflow_outbox (
  workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  run_seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  dispatched_at INTEGER,
  PRIMARY KEY (workflow_run_id, run_seq)
)`;

export const WORKFLOW_OUTBOX_INDEXES = [
  'CREATE INDEX idx_workflow_outbox_pending ON workflow_outbox(dispatched_at) WHERE dispatched_at IS NULL',
];

export const SCHEDULER_JOURNAL_DDL = `CREATE TABLE scheduler_journal (
  workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  message TEXT NOT NULL,
  decisions TEXT NOT NULL,
  state_hash TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (workflow_run_id, seq)
)`;

export const ENGINE_LOCK_DDL = `CREATE TABLE engine_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  owner_id TEXT,
  boot_id TEXT,
  heartbeat_at INTEGER
)`;

/** Unchanged from v55; recreated so its FK binds to the new `workflow_runs`. */
export const AUTOMATION_EXECUTION_RUNS_DDL = `CREATE TABLE automation_execution_runs (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES automation_executions(id) ON DELETE CASCADE,
  workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
  workflow_definition_id TEXT NOT NULL REFERENCES workflow_definitions(id),
  iteration_index INTEGER NOT NULL DEFAULT 0,
  iteration_variables TEXT,
  iteration_label TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
)`;

export const AUTOMATION_EXECUTION_RUNS_INDEXES = [
  'CREATE INDEX idx_automation_exec_runs_execution ON automation_execution_runs(execution_id)',
  'CREATE INDEX idx_automation_exec_runs_workflow_run ON automation_execution_runs(workflow_run_id)',
  'CREATE INDEX idx_automation_exec_runs_status ON automation_execution_runs(status)',
  'CREATE INDEX idx_automation_exec_runs_iteration ON automation_execution_runs(iteration_index)',
];
