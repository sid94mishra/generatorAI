// ────────────────────────────────────────────────────────────────
// IProjectCodebaseRepository — Port for ProjectCodebase persistence
// ────────────────────────────────────────────────────────────────

import type { ProjectCodebase, CodebaseStatus } from '@generatorai/shared';

export interface IProjectCodebaseRepository {
  create(codebase: ProjectCodebase): Promise<ProjectCodebase>;
  getById(id: string): Promise<ProjectCodebase>;
  getByProjectId(projectId: string): Promise<ProjectCodebase[]>;
  getByAlias(projectId: string, alias: string): Promise<ProjectCodebase | undefined>;
  /**
   * `lastError: null` clears a stored failure. `undefined` means "leave
   * alone", so without the null form a codebase that once failed kept
   * showing its stale error even after the problem was corrected.
   */
  update(
    id: string,
    updates: Omit<Partial<ProjectCodebase>, 'lastError'> & { lastError?: string | null },
  ): Promise<ProjectCodebase>;
  updateStatus(id: string, status: CodebaseStatus, lastError?: string): Promise<void>;
  delete(id: string): Promise<void>;
  deleteByProjectId(projectId: string): Promise<void>;
}
