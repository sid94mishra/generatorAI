// ────────────────────────────────────────────────────────────────
// DrizzleWorkflowRunRepository — workflow runs (`workflow_runs`, v57).
//
// The engine's compare-and-set (`transition`, checked against
// WORKFLOW_RUN_TRANSITIONS and fenced on `owner_epoch`) is the only status
// writer. The run row's permission layer: `run_overrides.permissionMode` is
// the operator's explicit run-level mode (optional: unset lets the stage,
// workflow and trigger layers decide, re-read every turn), next to the
// invocation's run-wide session overrides; the NOT NULL `permission_mode`
// column holds the run's effective mode as resolved when it was created or
// last changed. `system_vars` holds the engine-owned values (workspace
// paths, codebases, uploads, the lifecycle journal); callers never write it.
// ────────────────────────────────────────────────────────────────

import { count, eq, inArray } from 'drizzle-orm';
import type {
  IWorkflowRunCas,
  IWorkflowRunRepository,
  MemoizedInstance,
  MemoizedIteration,
  RunTransitionOptions,
  TransitionResult,
  WorkflowRunRow,
  WorkflowRunUpdate,
} from '@generatorai/core';
import type { WorkflowRunState } from '@generatorai/workflow-spec';
import type { WorkflowRun, WorkflowRunStatus, WorkflowRunPermissionMode } from '@generatorai/shared';
import { StorageError, NotFoundError } from '@generatorai/shared';
import { loopIterations, stageRuns, workflowRuns } from '../schema.js';
import type { AppDatabase } from '../index.js';
import { sqliteHandle } from './AuthRepositories.js';
import { claimRunOwnership, getRunRow, renewRunOwnership, runTransition } from './engineCas.js';
import { safeJsonColumn } from '../utils/safeJsonColumn.js';
import { validateJsonColumn } from '../utils/validateJsonColumn.js';
import { jsonRecord } from '../utils/jsonColumnSchemas.js';

/** `run_overrides`: the operator's explicit run mode plus the invocation's run-wide session overrides. */
type RunOverrides = { permissionMode?: WorkflowRunPermissionMode; model?: string; harnessType?: string; reasoningEffort?: string };

function overrides(mode: WorkflowRunPermissionMode | null | undefined, session?: WorkflowRun['runOverrides']): RunOverrides {
  return { ...(session ?? {}), ...(mode ? { permissionMode: mode } : {}) };
}

function runInsertValues(run: WorkflowRun): typeof workflowRuns.$inferInsert {
  return {
    id: run.id,
    workflowDefinitionId: run.workflowDefinitionId,
    definitionVersionId: run.definitionVersionId,
    name: run.name,
    status: 'created',
    variables: run.variables,
    error: run.error ?? null,
    permissionMode: run.effectivePermissionMode ?? run.permissionMode ?? 'default',
    runOverrides: overrides(run.permissionMode, run.runOverrides),
    stageOverrides: run.stageOverrides ?? null,
    projectId: run.projectId ?? null,
    trigger: run.trigger ?? null,
    invocationId: run.invocationId ?? null,
    idempotencyKey: run.idempotencyKey ?? null,
    forkSpec: run.forkSpec ?? null,
    codebaseSelection: run.codebaseSelection ?? null,
    systemVars: (run.systemVars as Record<string, unknown> | undefined) ?? null,
    budget: run.budget ?? null,
    parentRunId: run.parentRunId ?? null,
    parentStageRunId: run.parentStageRunId ?? null,
    rootRunId: run.rootRunId ?? run.id,
    depth: run.depth ?? 0,
    workspaceId: run.workspaceId ?? null,
    ancestorRunId: run.ancestorRunId ?? null,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function memoizedValues(runId: string, m: MemoizedInstance, now: Date): typeof stageRuns.$inferInsert {
  return {
    id: m.id,
    workflowRunId: runId,
    stageKey: m.stageKey,
    kind: m.kind,
    name: m.name,
    instancePath: m.instancePath,
    status: m.status,
    statusReason: m.statusReason,
    skipReason: m.skipReason,
    gateAs: m.gateAs,
    outputData: m.outputData ?? null,
    outputText: m.outputText,
    summary: m.summary,
    artifactManifest: m.artifactManifest,
    error: m.error,
    errorClass: m.errorClass,
    errorCode: m.errorCode,
    usage: m.usage,
    copiedFromStageRunId: m.copiedFromStageRunId,
    ...(m.scopeId ? { scopeId: m.scopeId } : {}),
    ...(m.iterationIndex !== undefined && m.iterationIndex !== null ? { iterationIndex: m.iterationIndex } : {}),
    ...(m.itemIndex !== undefined && m.itemIndex !== null ? { itemIndex: m.itemIndex } : {}),
    ...(m.itemKey ? { itemKey: m.itemKey } : {}),
    ...(m.containerState !== undefined ? { loopState: m.containerState } : {}),
    createdAt: now,
    updatedAt: now,
    startedAt: m.startedAt,
    completedAt: m.completedAt,
  };
}

export class DrizzleWorkflowRunRepository implements IWorkflowRunRepository, IWorkflowRunCas {
  constructor(private db: AppDatabase) {}

  // ── compare-and-set and ownership (G5 §5.4, RV-27) ─────────────

  /** The run's CAS, checked against WORKFLOW_RUN_TRANSITIONS; `ownerEpoch` fences it (RV-27). */
  transition(id: string, from: readonly WorkflowRunState[], to: WorkflowRunState, opts?: RunTransitionOptions): TransitionResult<WorkflowRunRow> {
    return runTransition(sqliteHandle(this.db), id, from, to, opts);
  }

  claimOwnership(id: string, ownerId: string, ttlMs: number, now?: number, opts?: { force?: boolean }): number | null {
    return claimRunOwnership(sqliteHandle(this.db), id, ownerId, ttlMs, now, opts);
  }

  renewOwnership(id: string, ownerId: string, epoch: number, ttlMs: number, now?: number): boolean {
    return renewRunOwnership(sqliteHandle(this.db), id, ownerId, epoch, ttlMs, now);
  }

  getRunRow(id: string): WorkflowRunRow | null {
    return getRunRow(sqliteHandle(this.db), id);
  }

  // ── rows ────────────────────────────────────────────────────────

  async create(run: WorkflowRun): Promise<WorkflowRun> {
    validateJsonColumn(run.variables, jsonRecord, { column: 'variables', table: 'workflow_runs' });
    try {
      await this.db.insert(workflowRuns).values(runInsertValues(run));
      return run;
    } catch (err) {
      throw new StorageError(`Failed to create workflow run: ${err instanceof Error ? err.message : String(err)}`, err instanceof Error ? err : undefined);
    }
  }

  /** A fork and its memoized instances in ONE synchronous transaction (A-34). */
  async createFork(run: WorkflowRun, memoized: readonly MemoizedInstance[], iterations: readonly MemoizedIteration[] = []): Promise<void> {
    validateJsonColumn(run.variables, jsonRecord, { column: 'variables', table: 'workflow_runs' });
    // A container before its body (scope_id references it): shorter paths first.
    const ordered = [...memoized].sort((a, b) => a.instancePath.split('/').length - b.instancePath.split('/').length || (a.instancePath < b.instancePath ? -1 : 1));
    try {
      this.db.transaction((tx) => {
        tx.insert(workflowRuns).values(runInsertValues(run)).run();
        for (const m of ordered) tx.insert(stageRuns).values(memoizedValues(run.id, m, run.createdAt)).run();
        for (const r of iterations) {
          tx.insert(loopIterations)
            .values({
              stageRunId: r.stageRunId,
              k: r.k,
              carry: r.carry,
              exitValues: r.exitValues,
              streaks: r.streaks,
              signals: r.signals,
              score: r.score,
              checkpointTurnId: r.checkpointTurnId,
              usage: r.usage,
              outcome: r.outcome,
              startedAt: r.startedAt !== null ? new Date(r.startedAt) : null,
              endedAt: r.endedAt !== null ? new Date(r.endedAt) : null,
            })
            .run();
        }
      });
    } catch (err) {
      throw new StorageError(`Failed to create the fork: ${err instanceof Error ? err.message : String(err)}`, err instanceof Error ? err : undefined);
    }
  }

  async getById(id: string): Promise<WorkflowRun> {
    const row = (await this.db.select().from(workflowRuns).where(eq(workflowRuns.id, id)).limit(1))[0];
    if (!row) throw new NotFoundError('WorkflowRun', id);
    return this.mapRow(row);
  }

  async findByIdempotencyKey(key: string): Promise<WorkflowRun | null> {
    const row = (await this.db.select().from(workflowRuns).where(eq(workflowRuns.idempotencyKey, key)).limit(1))[0];
    return row ? this.mapRow(row) : null;
  }

  async getAll(): Promise<WorkflowRun[]> {
    const rows = await this.db.select().from(workflowRuns).orderBy(workflowRuns.createdAt);
    return rows.map((r) => this.mapRow(r));
  }

  async getByDefinitionId(definitionId: string): Promise<WorkflowRun[]> {
    const rows = await this.db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowDefinitionId, definitionId))
      .orderBy(workflowRuns.createdAt);
    return rows.map((r) => this.mapRow(r));
  }

  async getByStatus(statuses: WorkflowRunStatus[]): Promise<WorkflowRun[]> {
    const rows = await this.db.select().from(workflowRuns).where(inArray(workflowRuns.status, statuses));
    return rows.map((r) => this.mapRow(r));
  }

  async countByStatus(statuses: WorkflowRunStatus[]): Promise<number> {
    if (statuses.length === 0) return 0;
    const [row] = await this.db.select({ value: count() }).from(workflowRuns).where(inArray(workflowRuns.status, statuses));
    return row?.value ?? 0;
  }

  async update(id: string, updates: WorkflowRunUpdate): Promise<WorkflowRun> {
    if (updates.variables !== undefined) {
      validateJsonColumn(updates.variables, jsonRecord, { column: 'variables', table: 'workflow_runs' });
    }
    const values: Record<string, unknown> = {};
    if (updates.name !== undefined) values['name'] = updates.name;
    if (updates.variables !== undefined) values['variables'] = updates.variables;
    if (updates.error !== undefined) values['error'] = updates.error;
    if (updates.permissionMode !== undefined) {
      const current = (await this.db.select({ o: workflowRuns.runOverrides }).from(workflowRuns).where(eq(workflowRuns.id, id)).limit(1))[0];
      const { permissionMode: _previous, ...session } = (current?.o as RunOverrides | null) ?? {};
      values['runOverrides'] = overrides(updates.permissionMode, session);
    }
    if (updates.systemVars !== undefined) values['systemVars'] = updates.systemVars;
    if (updates.effectivePermissionMode !== undefined) values['permissionMode'] = updates.effectivePermissionMode;
    if (updates.projectId !== undefined) values['projectId'] = updates.projectId;
    if (updates.workspaceId !== undefined) values['workspaceId'] = updates.workspaceId;
    if (updates.startedAt !== undefined) values['startedAt'] = updates.startedAt;
    if (updates.completedAt !== undefined) values['completedAt'] = updates.completedAt;
    values['updatedAt'] = new Date();
    await this.db.update(workflowRuns).set(values).where(eq(workflowRuns.id, id));
    return this.getById(id);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(workflowRuns).where(eq(workflowRuns.id, id));
  }

  private mapRow(row: typeof workflowRuns.$inferSelect): WorkflowRun {
    const trigger = row.trigger as WorkflowRun['trigger'] | null;
    const stageOverrides = row.stageOverrides as WorkflowRun['stageOverrides'] | null;
    const forkSpec = row.forkSpec as Record<string, unknown> | null;
    const { permissionMode, ...sessionOverrides } = (row.runOverrides as RunOverrides | null) ?? {};
    const systemVars = row.systemVars as WorkflowRun['systemVars'] | null;
    const budget = row.budget as Record<string, unknown> | null;
    return {
      id: row.id,
      workflowDefinitionId: row.workflowDefinitionId,
      definitionVersionId: row.definitionVersionId,
      name: row.name,
      status: row.status,
      ...(row.statusReason ? { statusReason: row.statusReason } : {}),
      ...(row.outcome ? { outcome: row.outcome } : {}),
      version: row.version,
      variables: safeJsonColumn(row.variables, jsonRecord, { fallback: {} }) ?? {},
      error: row.error ?? undefined,
      permissionMode: permissionMode ?? undefined,
      ...(Object.keys(sessionOverrides).length > 0 ? { runOverrides: sessionOverrides } : {}),
      ...(systemVars ? { systemVars } : {}),
      ...(budget ? { budget } : {}),
      ...(row.invocationId ? { invocationId: row.invocationId } : {}),
      ...(row.parentRunId ? { parentRunId: row.parentRunId } : {}),
      ...(row.parentStageRunId ? { parentStageRunId: row.parentStageRunId } : {}),
      rootRunId: row.rootRunId,
      depth: row.depth,
      effectivePermissionMode: row.permissionMode,
      ...(row.projectId ? { projectId: row.projectId } : {}),
      ...(trigger ? { trigger } : {}),
      ...(stageOverrides ? { stageOverrides } : {}),
      ...(forkSpec ? { forkSpec } : {}),
      ...(row.idempotencyKey ? { idempotencyKey: row.idempotencyKey } : {}),
      ...(row.codebaseSelection !== null && row.codebaseSelection !== undefined
        ? { codebaseSelection: row.codebaseSelection as NonNullable<WorkflowRun['codebaseSelection']> }
        : {}),
      workspaceId: row.workspaceId ?? undefined,
      ancestorRunId: row.ancestorRunId ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      startedAt: row.startedAt ?? undefined,
      completedAt: row.completedAt ?? undefined,
    };
  }
}
