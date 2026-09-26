// ────────────────────────────────────────────────────────────────
// Compare-and-set on the v2 engine's state tables (P03 WP-3.1, G5 §5.4).
//
// The only status writers of the v2 engine (R-4). Synchronous
// (better-sqlite3), so `RunStore.apply` composes them inside one
// transaction. Legal `(from, to)` pairs come from the state tables of
// `@generatorai/workflow-spec`: development and test builds throw on an
// illegal pair (a programming error), production rejects it and logs.
// `DrizzleStageRunRepository` and `DrizzleWorkflowRunRepository` expose
// these as their `transition` methods.
// ────────────────────────────────────────────────────────────────

import type BetterSqlite3 from 'better-sqlite3';
import {
  isLegalStageRunTransition,
  isLegalWorkflowRunTransition,
  type StageRunState,
  type WorkflowRunState,
} from '@generatorai/workflow-spec';
import type {
  RunTransitionOptions,
  StageAmendPatch,
  StageInstanceRow,
  StageRunCasPatch,
  StageTransitionOptions,
  TransitionResult,
  WorkflowRunRow,
} from '@generatorai/core';

export class IllegalTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalTransitionError';
  }
}

/** Throw in development and test; in production log and report a rejected CAS. */
function illegal(message: string): false {
  if (process.env['NODE_ENV'] === 'production') {
    process.emitWarning(`[engine-cas] rejected: ${message}`, 'IllegalTransitionWarning');
    return false;
  }
  throw new IllegalTransitionError(message);
}

const ATTEMPT_STATES: readonly StageRunState[] = ['starting', 'running', 'validating'];
const TERMINAL_STAGE: readonly StageRunState[] = ['completed', 'failed', 'skipped', 'cancelled'];
const TERMINAL_RUN: readonly WorkflowRunState[] = ['completed', 'failed', 'cancelled'];

export const json = (v: unknown): string | null => (v === undefined || v === null ? null : JSON.stringify(v));

// ── stage_runs ───────────────────────────────────────────────────

type Row = Record<string, unknown>;

export function mapInstanceRow(r: Row): StageInstanceRow {
  return {
    id: r['id'] as string,
    workflowRunId: r['workflow_run_id'] as string,
    stageKey: r['stage_key'] as string,
    kind: r['kind'] as string,
    name: r['name'] as string,
    instancePath: r['instance_path'] as string,
    scopeId: (r['scope_id'] as string | null) ?? null,
    status: r['status'] as StageRunState,
    statusReason: (r['status_reason'] as string | null) ?? null,
    version: r['version'] as number,
    currentAttempt: r['current_attempt'] as number,
    epoch: r['epoch'] as number,
    sessionKey: (r['session_key'] as string | null) ?? null,
    sessionId: (r['session_id'] as string | null) ?? null,
    leaseOwner: (r['lease_owner'] as string | null) ?? null,
    leaseExpiresAt: (r['lease_expires_at'] as number | null) ?? null,
    heartbeatAt: (r['heartbeat_at'] as number | null) ?? null,
    lastProgressAt: (r['last_progress_at'] as number | null) ?? null,
    startedAt: (r['started_at'] as number | null) ?? null,
    completedAt: (r['completed_at'] as number | null) ?? null,
    updatedAt: r['updated_at'] as number,
  };
}

const STAGE_PATCH_COLUMNS: ReadonlyArray<[keyof StageRunCasPatch, string, boolean]> = [
  ['statusReason', 'status_reason', false],
  ['skipReason', 'skip_reason', false],
  ['skipCauseId', 'skip_cause_id', false],
  ['gateAs', 'gate_as', false],
  ['outputData', 'output_data', true],
  ['outputText', 'output_text', false],
  ['summary', 'summary', false],
  ['artifactManifest', 'artifact_manifest', true],
  ['interruptData', 'interrupt_data', true],
  ['error', 'error', false],
  ['errorClass', 'error_class', false],
  ['errorCode', 'error_code', false],
  ['sessionId', 'session_id', false],
  ['sessionKey', 'session_key', false],
  ['amendedAt', 'amended_at', false],
  ['loopState', 'loop_state', true],
  // A map's or a sub-workflow's state lives in the same container-state column (P05).
  ['containerState', 'loop_state', true],
];

/** SET clauses of a patch without a status change (a loop's state, P05). */
export function stagePatchSets(patch: StageRunCasPatch): { sets: string[]; args: unknown[] } {
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const [key, column, isJson] of STAGE_PATCH_COLUMNS) {
    const v = patch[key];
    if (v === undefined) continue;
    sets.push(`${column} = ?`);
    args.push(isJson ? json(v) : v);
  }
  return { sets, args };
}

export function stageTransition(
  sqlite: BetterSqlite3.Database,
  id: string,
  from: readonly StageRunState[],
  to: StageRunState,
  opts: StageTransitionOptions = {},
): TransitionResult<StageInstanceRow> {
  const current = () => {
    const r = sqlite.prepare(`SELECT * FROM stage_runs WHERE id = ?`).get(id) as Row | undefined;
    return r ? mapInstanceRow(r) : null;
  };
  if (from.length === 0) return { ok: false, current: current() };
  for (const f of from) {
    if (!isLegalStageRunTransition(f, to) && !illegal(`stage run ${id}: ${f} → ${to} is not in STAGE_RUN_TRANSITIONS`)) {
      return { ok: false, current: current() };
    }
  }
  const entersAttempt = to === 'starting' || to === 'running';
  if (entersAttempt && (opts.lease === undefined || opts.lease === 'clear')) {
    if (!illegal(`stage run ${id}: entering ${to} needs a lease (or 'none' for a container)`)) return { ok: false, current: current() };
  }

  const now = opts.now ?? Date.now();
  const sets = ['status = ?', 'version = version + 1', 'updated_at = ?'];
  const args: unknown[] = [to, now];
  for (const [key, column, isJson] of STAGE_PATCH_COLUMNS) {
    const v = opts.patch?.[key];
    if (v === undefined) continue;
    sets.push(`${column} = ?`);
    args.push(isJson ? json(v) : v);
  }
  if (typeof opts.lease === 'object') {
    sets.push('lease_owner = ?', 'lease_expires_at = ?', 'heartbeat_at = ?', 'last_progress_at = ?');
    args.push(opts.lease.owner, now + opts.lease.ttlMs, now, now);
  } else if (opts.lease === 'clear' || !ATTEMPT_STATES.includes(to)) {
    sets.push('lease_owner = NULL', 'lease_expires_at = NULL');
  }
  if (entersAttempt) {
    sets.push('started_at = COALESCE(started_at, ?)');
    args.push(now);
  }
  if (TERMINAL_STAGE.includes(to)) {
    sets.push('completed_at = COALESCE(completed_at, ?)');
    args.push(now);
  }
  const where = [`id = ?`, `status IN (${from.map(() => '?').join(', ')})`];
  args.push(id, ...from);
  if (opts.expectedVersion !== undefined) {
    where.push('version = ?');
    args.push(opts.expectedVersion);
  }
  if (opts.runId !== undefined) {
    where.push('workflow_run_id = ?');
    args.push(opts.runId);
  }
  const row = sqlite.prepare(`UPDATE stage_runs SET ${sets.join(', ')} WHERE ${where.join(' AND ')} RETURNING *`).get(...args) as Row | undefined;
  return row ? { ok: true, row: mapInstanceRow(row) } : { ok: false, current: current() };
}

export function renewStageLease(sqlite: BetterSqlite3.Database, id: string, owner: string, ttlMs: number, now = Date.now()): boolean {
  return (
    sqlite
      .prepare(
        `UPDATE stage_runs SET lease_expires_at = ?, heartbeat_at = ?
          WHERE id = ? AND lease_owner = ? AND status IN ('starting', 'running', 'validating')`,
      )
      .run(now + ttlMs, now, id, owner).changes > 0
  );
}

export function markStageProgress(sqlite: BetterSqlite3.Database, id: string, owner: string, at: number): boolean {
  return (
    sqlite
      .prepare(`UPDATE stage_runs SET last_progress_at = ?, heartbeat_at = ? WHERE id = ? AND lease_owner = ?`)
      .run(at, at, id, owner).changes > 0
  );
}

/** Rewrite a completed instance's output (PD-4 amend); the status stays `completed`. */
export function amendStageOutput(sqlite: BetterSqlite3.Database, id: string, patch: StageAmendPatch, now = Date.now()): boolean {
  const sets = ['output_text = ?', 'amended_at = ?', 'version = version + 1', 'updated_at = ?'];
  const args: unknown[] = [patch.outputText, now, now];
  if (patch.outputData !== undefined) {
    sets.push('output_data = ?');
    args.push(json(patch.outputData));
  }
  if (patch.summary !== undefined) {
    sets.push('summary = ?');
    args.push(patch.summary);
  }
  args.push(id);
  return sqlite.prepare(`UPDATE stage_runs SET ${sets.join(', ')} WHERE id = ? AND status = 'completed'`).run(...args).changes > 0;
}

export function getInstanceRow(sqlite: BetterSqlite3.Database, id: string): StageInstanceRow | null {
  const r = sqlite.prepare(`SELECT * FROM stage_runs WHERE id = ?`).get(id) as Row | undefined;
  return r ? mapInstanceRow(r) : null;
}

// ── workflow_runs ────────────────────────────────────────────────

export function mapRunRow(r: Row): WorkflowRunRow {
  return {
    id: r['id'] as string,
    status: r['status'] as WorkflowRunState,
    statusReason: (r['status_reason'] as string | null) ?? null,
    outcome: (r['outcome'] as WorkflowRunRow['outcome']) ?? null,
    version: r['version'] as number,
    ownerId: (r['owner_id'] as string | null) ?? null,
    ownerEpoch: r['owner_epoch'] as number,
    ownerExpiresAt: (r['owner_expires_at'] as number | null) ?? null,
    runSeq: r['run_seq'] as number,
    startedAt: (r['started_at'] as number | null) ?? null,
    completedAt: (r['completed_at'] as number | null) ?? null,
    updatedAt: r['updated_at'] as number,
  };
}

const RUN_PATCH_COLUMNS: ReadonlyArray<[keyof NonNullable<RunTransitionOptions['patch']>, string]> = [
  ['statusReason', 'status_reason'],
  ['outcome', 'outcome'],
  ['error', 'error'],
  ['errorCode', 'error_code'],
];

/** `SET` fragments and arguments for a run patch. */
export function runPatchSets(patch: RunTransitionOptions['patch']): { sets: string[]; args: unknown[] } {
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const [key, column] of RUN_PATCH_COLUMNS) {
    const v = patch?.[key];
    if (v === undefined) continue;
    sets.push(`${column} = ?`);
    args.push(v);
  }
  // The run budget is JSON (a run-level raise_budget, P07 WP-7.3).
  if (patch?.budget !== undefined) {
    sets.push('budget = ?');
    args.push(patch.budget === null ? null : JSON.stringify(patch.budget));
  }
  return { sets, args };
}

export function runTransition(
  sqlite: BetterSqlite3.Database,
  id: string,
  from: readonly WorkflowRunState[],
  to: WorkflowRunState,
  opts: RunTransitionOptions = {},
): TransitionResult<WorkflowRunRow> {
  const current = () => getRunRow(sqlite, id);
  if (from.length === 0) return { ok: false, current: current() };
  for (const f of from) {
    if (!isLegalWorkflowRunTransition(f, to) && !illegal(`run ${id}: ${f} → ${to} is not in WORKFLOW_RUN_TRANSITIONS`)) {
      return { ok: false, current: current() };
    }
  }
  const now = opts.now ?? Date.now();
  const patch = runPatchSets(opts.patch);
  const sets = ['status = ?', 'version = version + 1', 'updated_at = ?', ...patch.sets];
  const args: unknown[] = [to, now, ...patch.args];
  if (to === 'running') {
    sets.push('started_at = COALESCE(started_at, ?)');
    args.push(now);
  }
  if (TERMINAL_RUN.includes(to)) {
    sets.push('completed_at = COALESCE(completed_at, ?)');
    args.push(now);
  }
  const where = ['id = ?', `status IN (${from.map(() => '?').join(', ')})`];
  args.push(id, ...from);
  if (opts.expectedVersion !== undefined) {
    where.push('version = ?');
    args.push(opts.expectedVersion);
  }
  if (opts.ownerEpoch !== undefined) {
    where.push('owner_epoch = ?');
    args.push(opts.ownerEpoch);
  }
  const row = sqlite.prepare(`UPDATE workflow_runs SET ${sets.join(', ')} WHERE ${where.join(' AND ')} RETURNING *`).get(...args) as Row | undefined;
  return row ? { ok: true, row: mapRunRow(row) } : { ok: false, current: current() };
}

export function claimRunOwnership(
  sqlite: BetterSqlite3.Database,
  id: string,
  ownerId: string,
  ttlMs: number,
  now = Date.now(),
  opts: { force?: boolean } = {},
): number | null {
  // `force`: the caller holds the single-engine lock, so any other owner is dead.
  const row = opts.force
    ? (sqlite
        .prepare(`UPDATE workflow_runs SET owner_id = ?, owner_epoch = owner_epoch + 1, owner_expires_at = ? WHERE id = ? RETURNING owner_epoch`)
        .get(ownerId, now + ttlMs, id) as { owner_epoch: number } | undefined)
    : (sqlite
        .prepare(
          `UPDATE workflow_runs SET owner_id = ?, owner_epoch = owner_epoch + 1, owner_expires_at = ?
            WHERE id = ? AND (owner_id IS NULL OR owner_id = ? OR owner_expires_at IS NULL OR owner_expires_at < ?)
            RETURNING owner_epoch`,
        )
        .get(ownerId, now + ttlMs, id, ownerId, now) as { owner_epoch: number } | undefined);
  return row ? row.owner_epoch : null;
}

/** Extend an owner's hold at the same epoch; false once another owner fenced it. */
export function renewRunOwnership(sqlite: BetterSqlite3.Database, id: string, ownerId: string, epoch: number, ttlMs: number, now = Date.now()): boolean {
  return (
    sqlite
      .prepare(`UPDATE workflow_runs SET owner_expires_at = ? WHERE id = ? AND owner_id = ? AND owner_epoch = ?`)
      .run(now + ttlMs, id, ownerId, epoch).changes > 0
  );
}

export function getRunRow(sqlite: BetterSqlite3.Database, id: string): WorkflowRunRow | null {
  const r = sqlite.prepare(`SELECT * FROM workflow_runs WHERE id = ?`).get(id) as Row | undefined;
  return r ? mapRunRow(r) : null;
}
