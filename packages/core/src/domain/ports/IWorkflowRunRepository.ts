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
  /**
   * A copied instance keeps its terminal status. A container re-seeded by a
   * fork from inside it (`<loop>#k/…`, `<map>#i/…`, P05 WP-5B.4) is
   * `running`; the body instances it re-runs are `pending`.
   */
  status: 'completed' | 'skipped' | 'failed' | 'cancelled' | 'running' | 'pending';
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
  /** Inside a container (P05): the fork's container instance, and the iteration or item it belongs to. */
  scopeId?: string | null;
  iterationIndex?: number | null;
  itemIndex?: number | null;
  itemKey?: string | null;
  /** A container's state (a loop's `LoopState`, a map's or a sub-workflow's state): `stage_runs.loop_state`. */
  containerState?: unknown;
}

/** A finished loop iteration a fork copies (`loop_iterations`, P05 WP-5B.4). */
export interface MemoizedIteration {
  stageRunId: string;
  k: number;
  carry: unknown;
  exitValues: unknown;
  streaks: unknown;
  signals: unknown;
  score: number | null;
  checkpointTurnId: string | null;
  usage: Record<string, unknown>;
  outcome: string;
  startedAt: number | null;
  endedAt: number | null;
}

/** Everything about a run but its status (which only the engine's CAS writes). */
export type WorkflowRunUpdate = Partial<Omit<WorkflowRun, 'id' | 'status' | 'statusReason' | 'outcome' | 'version' | 'createdAt'>>;

export interface IWorkflowRunRepository {
  /** Insert a `created` run (the engine creates its instances when it starts). */
  create(run: WorkflowRun): Promise<WorkflowRun>;
  /** A fork: the `created` run, its memoized (and re-seeded) instances and the loop iterations it keeps, in ONE transaction. */
  createFork(run: WorkflowRun, memoized: readonly MemoizedInstance[], iterations?: readonly MemoizedIteration[]): Promise<void>;
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
