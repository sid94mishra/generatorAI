// ────────────────────────────────────────────────────────────────
// IProjectConfigRepository — Port for ProjectConfig persistence
// ────────────────────────────────────────────────────────────────

import type { ProjectConfig, ConfigType } from '@generatorai/shared';

export interface IProjectConfigRepository {
  create(config: ProjectConfig): Promise<ProjectConfig>;
  getById(id: string): Promise<ProjectConfig>;
  getByProjectId(projectId: string, type?: ConfigType): Promise<ProjectConfig[]>;
  update(id: string, updates: Partial<ProjectConfig>): Promise<ProjectConfig>;
  delete(id: string): Promise<void>;
  deleteByProjectId(projectId: string): Promise<void>;
}
