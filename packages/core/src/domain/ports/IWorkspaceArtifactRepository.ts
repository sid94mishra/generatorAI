// ────────────────────────────────────────────────────────────────
// IWorkspaceArtifactRepository — Port for Workspace Artifact persistence
// ────────────────────────────────────────────────────────────────

import type { WorkspaceArtifactRecord } from '@generatorai/shared';

export interface IWorkspaceArtifactRepository {
  create(artifact: WorkspaceArtifactRecord): Promise<void>;
  /** P1-31: Direct lookup by artifact id — avoids loading all workspace rows. */
  findById(id: string): Promise<WorkspaceArtifactRecord | null>;
  findByWorkspace(workspaceId: string): Promise<WorkspaceArtifactRecord[]>;
  findByStageRun(stageRunId: string): Promise<WorkspaceArtifactRecord[]>;
  delete(id: string): Promise<void>;
  deleteByWorkspace(workspaceId: string): Promise<void>;
}
