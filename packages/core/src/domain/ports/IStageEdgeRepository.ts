// ────────────────────────────────────────────────────────────────
// IStageEdgeRepository — Port for StageEdge persistence
// ────────────────────────────────────────────────────────────────

import type { StageEdge } from '@generatorai/shared';

export interface IStageEdgeRepository {
  create(edge: StageEdge): Promise<StageEdge>;
  getById(id: string): Promise<StageEdge>;
  getByDefinitionId(workflowDefinitionId: string): Promise<StageEdge[]>;
  getByStageId(stageId: string): Promise<StageEdge[]>;
  delete(id: string): Promise<void>;
  deleteByDefinitionId(workflowDefinitionId: string): Promise<void>;
}
