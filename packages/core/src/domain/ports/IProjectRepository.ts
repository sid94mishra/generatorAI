// ────────────────────────────────────────────────────────────────
// IProjectRepository — Port for Project entity persistence
// ────────────────────────────────────────────────────────────────

import type { Project, ProjectStatus } from '@generatorai/shared';

export interface IProjectRepository {
  create(project: Project): Promise<Project>;
  getById(id: string): Promise<Project>;
  getAll(filter?: { status?: ProjectStatus }): Promise<Project[]>;
  update(id: string, updates: Partial<Project>): Promise<Project>;
  delete(id: string): Promise<void>;
}
