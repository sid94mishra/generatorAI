// ────────────────────────────────────────────────────────────────
// IStageRunRepository — the read side of stage instances (`stage_runs`).
//
// Status writes go through the v2 engine's compare-and-set only
// (`IStageRunCas.transition`, applied by `RunStore`); this port reads.
// ────────────────────────────────────────────────────────────────

import type { LoopIteration, StageRun, StageRunStatus, WorkflowRunStatus } from '@generatorai/shared';

/** One execution of a stage in a run of its definition (the stage's history across runs). */
export interface StageHistoryEntry {
  stageRun: StageRun;
  run: { id: string; name: string; status: WorkflowRunStatus; createdAt: Date };
}

export interface IStageRunRepository {
  getById(id: string): Promise<StageRun>;
  /** Every instance of the run. */
  getByRunId(workflowRunId: string): Promise<StageRun[]>;
  getByStatus(workflowRunId: string, statuses: StageRunStatus[]): Promise<StageRun[]>;
  deleteByRunId(workflowRunId: string): Promise<void>;
  /** A loop instance's finished iterations, oldest first (P05 §2.6). */
  getLoopIterations(stageRunId: string): Promise<LoopIteration[]>;
  /** The newest `limit` instances of `stageKey` across the definition's runs, newest first. */
  getStageHistory(definitionId: string, stageKey: string, limit: number): Promise<StageHistoryEntry[]>;
}
