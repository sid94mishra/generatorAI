// ────────────────────────────────────────────────────────────────
// IWorkflowRunRepository — Port for WorkflowRun persistence
// ────────────────────────────────────────────────────────────────

import type { WorkflowRun, WorkflowRunStatus } from '@generatorai/shared';

export interface IWorkflowRunRepository {
  create(run: WorkflowRun): Promise<WorkflowRun>;
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
