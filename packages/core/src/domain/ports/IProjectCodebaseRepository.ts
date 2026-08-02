// ────────────────────────────────────────────────────────────────
// IProjectCodebaseRepository — Port for ProjectCodebase persistence
// ────────────────────────────────────────────────────────────────

import type { ProjectCodebase, CodebaseStatus } from '@generatorai/shared';

export interface IProjectCodebaseRepository {
  create(codebase: ProjectCodebase): Promise<ProjectCodebase>;
  getById(id: string): Promise<ProjectCodebase>;
  getByProjectId(projectId: string): Promise<ProjectCodebase[]>;
  getByAlias(projectId: string, alias: string): Promise<ProjectCodebase | undefined>;
  update(id: string, updates: Partial<ProjectCodebase>): Promise<ProjectCodebase>;
  updateStatus(id: string, status: CodebaseStatus, lastError?: string): Promise<void>;
  delete(id: string): Promise<void>;
  deleteByProjectId(projectId: string): Promise<void>;
}
