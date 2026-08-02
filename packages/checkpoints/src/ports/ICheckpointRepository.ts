// ────────────────────────────────────────────────────────────────
// ICheckpointRepository — persistence port for checkpoint metadata
// ────────────────────────────────────────────────────────────────

import type { CheckpointFilters, CheckpointRecord } from '@generatorai/shared';

export interface ICheckpointRepository {
  create(record: CheckpointRecord): Promise<void>;
  findById(id: string): Promise<CheckpointRecord | null>;
  list(filters: CheckpointFilters): Promise<CheckpointRecord[]>;
  /** Most recent checkpoint for a (workspace, alias) pair, or null. */
  findLatest(workspaceId: string, repoAlias: string): Promise<CheckpointRecord | null>;
  /** Highest `seq` currently allocated for a (workspace, alias) pair. */
  maxSeq(workspaceId: string, repoAlias: string): Promise<number>;
  /** Most recent checkpoint of a given kind matching a provenance id. */
  findByTurn(workspaceId: string, turnId: string): Promise<CheckpointRecord[]>;
  findByStageRun(workspaceId: string, stageRunId: string): Promise<CheckpointRecord[]>;
  delete(id: string): Promise<void>;
  deleteByWorkspace(workspaceId: string): Promise<void>;
}
