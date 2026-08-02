// ────────────────────────────────────────────────────────────────
// IStageDefinitionRepository — Port for StageDefinition persistence
// ────────────────────────────────────────────────────────────────

import type { StageDefinition } from '@generatorai/shared';

export interface IStageDefinitionRepository {
  create(stage: StageDefinition): Promise<StageDefinition>;
  getById(id: string): Promise<StageDefinition>;
  getByDefinitionId(workflowDefinitionId: string): Promise<StageDefinition[]>;
  update(id: string, updates: Partial<StageDefinition>): Promise<StageDefinition>;
  reorder(workflowDefinitionId: string, orderedIds: string[]): Promise<void>;
  delete(id: string): Promise<void>;
  deleteByDefinitionId(workflowDefinitionId: string): Promise<void>;
}
