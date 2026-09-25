// ────────────────────────────────────────────────────────────────
// IWorkflowRunRepository — Port for WorkflowRun persistence
//
// A run's STATUS changes only through the engine's compare-and-set
// (`IWorkflowRunCas.transition`); `update` writes everything else.
// ────────────────────────────────────────────────────────────────

import type { WorkflowRun, WorkflowRunStatus } from '@generatorai/shared';

/**
 * An instance a fork copies from its source run (G5 §3.8): terminal, with
 * its result, never re-validated (B-6).
 */
export interface MemoizedInstance {
  id: string;
  /** The source run's instance (`copied_from_stage_run_id`). */
  copiedFromStageRunId: string;
  stageKey: string;
  kind: string;
  name: string;
  instancePath: string;
  status: 'completed' | 'skipped' | 'failed';
  statusReason: string | null;
  skipReason: string | null;
  gateAs: 'completed' | 'skipped' | null;
  outputData: unknown;
  outputText: string | null;
  summary: string | null;
  artifactManifest: unknown[] | null;
  error: string | null;
  errorClass: string | null;
  errorCode: string | null;
  usage: Record<string, unknown>;
  startedAt: Date | null;
  completedAt: Date | null;
}

/** Everything about a run but its status (which only the engine's CAS writes). */
export type WorkflowRunUpdate = Partial<Omit<WorkflowRun, 'id' | 'status' | 'statusReason' | 'outcome' | 'version' | 'createdAt'>>;

export interface IWorkflowRunRepository {
  /** Insert a `created` run (the engine creates its instances when it starts). */
  create(run: WorkflowRun): Promise<WorkflowRun>;
  /** A fork: the `created` run and its memoized instances in ONE transaction. */
  createFork(run: WorkflowRun, memoized: readonly MemoizedInstance[]): Promise<void>;
  getById(id: string): Promise<WorkflowRun>;
  /** The run an idempotency key already created, if any. */
  findByIdempotencyKey(key: string): Promise<WorkflowRun | null>;
  getAll(): Promise<WorkflowRun[]>;
  getByDefinitionId(definitionId: string): Promise<WorkflowRun[]>;
  getByStatus(statuses: WorkflowRunStatus[]): Promise<WorkflowRun[]>;
  /** `COUNT(*)` of runs whose status is in `statuses`. */
  countByStatus(statuses: WorkflowRunStatus[]): Promise<number>;
  update(id: string, updates: WorkflowRunUpdate): Promise<WorkflowRun>;
  delete(id: string): Promise<void>;
}
