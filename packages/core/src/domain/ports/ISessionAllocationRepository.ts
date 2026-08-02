// ────────────────────────────────────────────────────────────────
// ISessionAllocationRepository — persisted tracking of SessionAllocator
// state (Phase 1, finding 1.6).
//
// Before Phase 1, `SessionAllocator.allocations` was an in-memory Map.
// A process crash left SDK conversations orphaned (no record of which
// stage_run owned which session) and a restart could re-allocate
// duplicates. This port persists allocation state so StartupRecovery
// can rehydrate the in-memory Map on boot.
// ────────────────────────────────────────────────────────────────

import type { WorkflowSessionMode } from '@generatorai/shared';

export interface SessionAllocationRow {
  id: string;
  workflowRunId: string;
  mode: WorkflowSessionMode;
  sharedSessionId?: string | null;
  sharedRefCount: number;
  createdAt: Date;
}

export interface StageSessionMapRow {
  id: string;
  allocationId: string;
  stageRunId: string;
  sessionId: string;
}

export interface ISessionAllocationRepository {
  /** Insert a new per-run allocation; returns the stored row. */
  createAllocation(row: SessionAllocationRow): Promise<SessionAllocationRow>;

  /** Load the allocation for a given run, if any. */
  getByRunId(workflowRunId: string): Promise<SessionAllocationRow | null>;

  /** Load every allocation (used by StartupRecovery to rehydrate). */
  listAllocations(): Promise<SessionAllocationRow[]>;

  /** Update mutable allocation fields. */
  updateAllocation(
    id: string,
    updates: Partial<Pick<SessionAllocationRow, 'sharedSessionId' | 'sharedRefCount'>>,
  ): Promise<void>;

  /** Delete a per-run allocation (cascades stage_session_maps via FK). */
  deleteAllocation(id: string): Promise<void>;

  /** Upsert a stage_run -> session mapping. */
  putStageSession(row: StageSessionMapRow): Promise<void>;

  /** Return all stage_run -> session mappings for an allocation. */
  listStageSessions(allocationId: string): Promise<StageSessionMapRow[]>;

  /** Remove a stage_run's mapping (called on per-stage release). */
  deleteStageSession(stageRunId: string): Promise<void>;
}
