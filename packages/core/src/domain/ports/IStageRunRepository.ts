// ────────────────────────────────────────────────────────────────
// IStageRunRepository — the read side of stage instances (`stage_runs`).
//
// Status writes go through the v2 engine's compare-and-set only
// (`IStageRunCas.transition`, applied by `RunStore`); this port reads.
// ────────────────────────────────────────────────────────────────

import type { StageRun, StageRunStatus } from '@generatorai/shared';

export interface IStageRunRepository {
  getById(id: string): Promise<StageRun>;
  /** Every instance of the run. */
  getByRunId(workflowRunId: string): Promise<StageRun[]>;
  getByStatus(workflowRunId: string, statuses: StageRunStatus[]): Promise<StageRun[]>;
  deleteByRunId(workflowRunId: string): Promise<void>;
}
