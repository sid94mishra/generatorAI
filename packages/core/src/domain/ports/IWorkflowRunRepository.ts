// ────────────────────────────────────────────────────────────────
// IWorkflowRunRepository — Port for WorkflowRun persistence
// ────────────────────────────────────────────────────────────────

import type { StageRun, WorkflowRun, WorkflowRunStatus } from '@generatorai/shared';

export interface IWorkflowRunRepository {
  create(run: WorkflowRun): Promise<WorkflowRun>;
  /** Insert a run and its stage runs in ONE synchronous transaction. */
  createWithStages(run: WorkflowRun, stageRuns: StageRun[]): Promise<void>;
  getById(id: string): Promise<WorkflowRun>;
  getAll(): Promise<WorkflowRun[]>;
  getByDefinitionId(definitionId: string): Promise<WorkflowRun[]>;
  getByStatus(statuses: WorkflowRunStatus[]): Promise<WorkflowRun[]>;
  /** `COUNT(*)` of runs whose status is in `statuses`. */
  countByStatus(statuses: WorkflowRunStatus[]): Promise<number>;
  update(id: string, updates: Partial<WorkflowRun>): Promise<WorkflowRun>;
  updateStatus(id: string, status: WorkflowRunStatus): Promise<void>;
  delete(id: string): Promise<void>;
}
