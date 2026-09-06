// ────────────────────────────────────────────────────────────────
// DrizzleProjectConfigRepository — IProjectConfigRepository impl
// ────────────────────────────────────────────────────────────────

import { eq, and } from 'drizzle-orm';
import type { IProjectConfigRepository } from '@generatorai/core';
import type { ProjectConfig, ConfigType } from '@generatorai/shared';
import { NotFoundError, StorageError } from '@generatorai/shared';
import { projectConfigs } from '../schema.js';
import type { AppDatabase } from '../index.js';
import { safeJsonColumn } from '../utils/safeJsonColumn.js';
import { validateJsonColumn } from '../utils/validateJsonColumn.js';
import { jsonRecord } from '../utils/jsonColumnSchemas.js';

export class DrizzleProjectConfigRepository implements IProjectConfigRepository {
  constructor(private db: AppDatabase) {}

  async create(config: ProjectConfig): Promise<ProjectConfig> {
    try {
      validateJsonColumn(config.metadata, jsonRecord, { column: 'metadata', table: 'project_configs' });
      await this.db.insert(projectConfigs).values({
        id: config.id,
        projectId: config.projectId,
        type: config.type as 'agent' | 'prompt' | 'skill',
        name: config.name,
        description: config.description ?? null,
        filePath: config.filePath,
        metadata: config.metadata ?? {},
        credentialRefs: config.credentialRefs ?? null,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
      });
      return config;
    } catch (err) {
      throw new StorageError(
        `Failed to create project config: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  async getById(id: string): Promise<ProjectConfig> {
    const rows = await this.db
      .select()
      .from(projectConfigs)
      .where(eq(projectConfigs.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('ProjectConfig', id);
    return this.mapRow(row);
  }

  async getByProjectId(projectId: string, type?: ConfigType): Promise<ProjectConfig[]> {
    if (type) {
      const rows = await this.db
        .select()
        .from(projectConfigs)
        .where(and(
          eq(projectConfigs.projectId, projectId),
          eq(projectConfigs.type, type as 'agent' | 'prompt' | 'skill'),
        ))
        .orderBy(projectConfigs.createdAt);
      return rows.map((r) => this.mapRow(r));
    }
    const rows = await this.db
      .select()
      .from(projectConfigs)
      .where(eq(projectConfigs.projectId, projectId))
      .orderBy(projectConfigs.createdAt);
    return rows.map((r) => this.mapRow(r));
  }

  async update(id: string, updates: Partial<ProjectConfig>): Promise<ProjectConfig> {
    const values: Record<string, unknown> = {};
    if (updates.name !== undefined) values['name'] = updates.name;
    if (updates.description !== undefined) values['description'] = updates.description;
    if (updates.filePath !== undefined) values['filePath'] = updates.filePath;
    if (updates.metadata !== undefined) values['metadata'] = updates.metadata;
    if (updates.credentialRefs !== undefined) values['credentialRefs'] = updates.credentialRefs;
    values['updatedAt'] = new Date();

    await this.db.update(projectConfigs).set(values).where(eq(projectConfigs.id, id));
    return this.getById(id);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(projectConfigs).where(eq(projectConfigs.id, id));
  }

  async deleteByProjectId(projectId: string): Promise<void> {
    await this.db.delete(projectConfigs).where(eq(projectConfigs.projectId, projectId));
  }

  private mapRow(row: typeof projectConfigs.$inferSelect): ProjectConfig {
    return {
      id: row.id,
      projectId: row.projectId,
      type: row.type as ConfigType,
      name: row.name,
      description: row.description ?? undefined,
      filePath: row.filePath,
      metadata: safeJsonColumn(row.metadata, jsonRecord, { fallback: {} }) ?? {},
      ...(row.credentialRefs ? { credentialRefs: row.credentialRefs } : {}),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
