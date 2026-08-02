// ────────────────────────────────────────────────────────────────
// IWorkflowDefinitionRepository — Port for WorkflowDefinition persistence
// ────────────────────────────────────────────────────────────────

import type { WorkflowDefinition } from '@generatorai/shared';

export interface IWorkflowDefinitionRepository {
  create(definition: WorkflowDefinition): Promise<WorkflowDefinition>;
  getById(id: string): Promise<WorkflowDefinition>;
  getAll(): Promise<WorkflowDefinition[]>;
  getByProjectId(projectId: string): Promise<WorkflowDefinition[]>;
  update(id: string, updates: Partial<WorkflowDefinition>): Promise<WorkflowDefinition>;
  delete(id: string): Promise<void>;
}
