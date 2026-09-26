// ────────────────────────────────────────────────────────────────
// Frozen schema of migration v59 `control_flow` (RV-33).
//
// The tables and columns v59 adds, as the DDL it runs. Migration code never
// imports `schema.ts`: this file is the migration's own copy and is pinned
// by `migrations.lock.json` (one of v59's `lockFiles`). Never edit it; a
// later schema change is a new migration.
// ────────────────────────────────────────────────────────────────

/**
 * One finished iteration of a loop instance (P05 §2.6): the carried state,
 * the exit-rule values and streaks, the signals, the score, the iteration's
 * checkpoint and usage. Written in the same transaction as the next scope's
 * instances. Timestamps in ms.
 */
export const LOOP_ITERATIONS_DDL = `CREATE TABLE loop_iterations (
  stage_run_id TEXT NOT NULL REFERENCES stage_runs(id) ON DELETE CASCADE,
  k INTEGER NOT NULL,
  carry TEXT,
  exit_values TEXT,
  streaks TEXT,
  signals TEXT,
  score REAL,
  checkpoint_turn_id TEXT,
  usage TEXT NOT NULL DEFAULT '{}',
  outcome TEXT,
  started_at INTEGER,
  ended_at INTEGER,
  PRIMARY KEY (stage_run_id, k)
)`;

/** A map item's stable key (5B): the instance path uses the index, forks accept either. */
export const STAGE_RUNS_ITEM_KEY_SQL = `ALTER TABLE stage_runs ADD COLUMN item_key TEXT`;

/**
 * External events a `wait` stage consumes (5B, P05 §4.3). A key may arrive
 * many times (a wait inside a loop consumes one per instance); the
 * idempotency key deduplicates deliveries.
 */
export const WORKFLOW_RUN_EVENTS_DDL = `CREATE TABLE workflow_run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  data TEXT,
  received_at INTEGER NOT NULL,
  consumed_by_stage_run_id TEXT,
  UNIQUE (run_id, event_key, idempotency_key)
)`;

export const WORKFLOW_RUN_EVENTS_INDEXES = [
  `CREATE INDEX idx_workflow_run_events_pending ON workflow_run_events(run_id, event_key, received_at) WHERE consumed_by_stage_run_id IS NULL`,
] as const;

/** The stage kind and its container, as columns (the document keeps them in `spec` too). */
export const STAGE_DEFINITIONS_COLUMNS_SQL = [
  `ALTER TABLE stage_definitions ADD COLUMN parent_key TEXT`,
  `ALTER TABLE stage_definitions ADD COLUMN kind TEXT NOT NULL DEFAULT 'agent'`,
] as const;

/** Backfill both from the stored spec (every row written so far is a v2 stage document). */
export const STAGE_DEFINITIONS_BACKFILL_SQL = `UPDATE stage_definitions
   SET kind = COALESCE(json_extract(spec, '$.kind'), 'agent'),
       parent_key = json_extract(spec, '$.parentKey')
 WHERE json_valid(spec)`;

export const STAGE_DEFINITIONS_PARENT_INDEX = `CREATE INDEX idx_stage_defs_parent ON stage_definitions(workflow_definition_id, parent_key)`;
