// ────────────────────────────────────────────────────────────────
// Migration v59 — control_flow (workflow overhaul P05 WP-5A.4).
//
//   1. `loop_iterations` (created): one row per finished loop iteration.
//   2. `stage_runs.item_key` (added): a map item's stable key (5B).
//   3. `workflow_run_events` (created): events a `wait` consumes (5B).
//   4. `stage_definitions.parent_key` and `kind` (added, backfilled from
//      `spec`) and the index `(workflow_definition_id, parent_key)`.
//
// Additive only: nothing is dropped or rebuilt, and no chat table is
// touched. Idempotent (a column or table that exists is left as it is).
// The DDL is frozen in `./v59/ddl.ts` (RV-33).
// ────────────────────────────────────────────────────────────────

import type Database from 'better-sqlite3';
import {
  LOOP_ITERATIONS_DDL,
  STAGE_DEFINITIONS_BACKFILL_SQL,
  STAGE_DEFINITIONS_COLUMNS_SQL,
  STAGE_DEFINITIONS_PARENT_INDEX,
  STAGE_RUNS_ITEM_KEY_SQL,
  WORKFLOW_RUN_EVENTS_DDL,
  WORKFLOW_RUN_EVENTS_INDEXES,
} from './v59/ddl.js';

/** Files whose content `migrations.lock.json` pins for v59 (relative to this folder). */
export const V59_LOCK_FILES = ['v59_control_flow.ts', 'v59/ddl.ts'] as const;

function columnsOf(sqlite: Database.Database, table: string): Set<string> {
  return new Set((sqlite.pragma(`table_info("${table}")`) as Array<{ name: string }>).map((c) => c.name));
}

function tableExists(sqlite: Database.Database, table: string): boolean {
  return !!sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
}

export function runV59(sqlite: Database.Database): void {
  // 1.
  if (!tableExists(sqlite, 'loop_iterations')) sqlite.exec(LOOP_ITERATIONS_DDL);

  // 2.
  if (!columnsOf(sqlite, 'stage_runs').has('item_key')) sqlite.exec(STAGE_RUNS_ITEM_KEY_SQL);

  // 3.
  if (!tableExists(sqlite, 'workflow_run_events')) {
    sqlite.exec(WORKFLOW_RUN_EVENTS_DDL);
    for (const idx of WORKFLOW_RUN_EVENTS_INDEXES) sqlite.exec(idx);
  }

  // 4.
  const defCols = columnsOf(sqlite, 'stage_definitions');
  if (!defCols.has('parent_key') || !defCols.has('kind')) {
    for (const sql of STAGE_DEFINITIONS_COLUMNS_SQL) {
      const col = /ADD COLUMN (\w+)/.exec(sql)![1]!;
      if (!defCols.has(col)) sqlite.exec(sql);
    }
    sqlite.exec(STAGE_DEFINITIONS_BACKFILL_SQL);
  }
  if (!sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_stage_defs_parent'`).get()) {
    sqlite.exec(STAGE_DEFINITIONS_PARENT_INDEX);
  }
}
