// ────────────────────────────────────────────────────────────────
// DrizzleProjectRepository — IProjectRepository impl
// ────────────────────────────────────────────────────────────────

import { eq } from 'drizzle-orm';
import type { IProjectRepository } from '@generatorai/core';
import type { Project, ProjectStatus } from '@generatorai/shared';
import { NotFoundError, StorageError } from '@generatorai/shared';
import { projects, chats, workflowDefinitions } from '../schema.js';
import type { AppDatabase } from '../index.js';
import { safeJsonColumn } from '../utils/safeJsonColumn.js';
import { jsonRecord } from '../utils/jsonColumnSchemas.js';

export class DrizzleProjectRepository implements IProjectRepository {
  constructor(private db: AppDatabase) {}

  async create(project: Project): Promise<Project> {
    try {
      await this.db.insert(projects).values({
        id: project.id,
        name: project.name,
        description: project.description ?? null,
        settings: project.settings ?? {},
        rootPath: project.rootPath,
        status: project.status,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      });
      return project;
    } catch (err) {
      throw new StorageError(
        `Failed to create project: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  async getById(id: string): Promise<Project> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Project', id);
    return this.mapRow(row);
  }

  async getAll(filter?: { status?: ProjectStatus }): Promise<Project[]> {
    if (filter?.status) {
      const rows = await this.db
        .select()
        .from(projects)
        .where(eq(projects.status, filter.status))
        .orderBy(projects.createdAt);
      return rows.map((r) => this.mapRow(r));
    }
    const rows = await this.db
      .select()
      .from(projects)
      .orderBy(projects.createdAt);
    return rows.map((r) => this.mapRow(r));
  }

  async update(id: string, updates: Partial<Project>): Promise<Project> {
    const values: Record<string, unknown> = {};
    if (updates.name !== undefined) values['name'] = updates.name;
    if (updates.description !== undefined) values['description'] = updates.description;
    if (updates.settings !== undefined) values['settings'] = updates.settings;
    if (updates.status !== undefined) values['status'] = updates.status;
    values['updatedAt'] = new Date();

    await this.db.update(projects).set(values).where(eq(projects.id, id));
    return this.getById(id);
  }

  async delete(id: string): Promise<void> {
    // Unlink chats and workflow definitions that reference this project
    await this.db.update(chats).set({ projectId: null }).where(eq(chats.projectId, id));
    await this.db.update(workflowDefinitions).set({ projectId: null }).where(eq(workflowDefinitions.projectId, id));
    // Delete the project (codebases, configs, worktrees cascade via FK)
    await this.db.delete(projects).where(eq(projects.id, id));
  }

  private mapRow(row: typeof projects.$inferSelect): Project {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      settings: safeJsonColumn(row.settings, jsonRecord, { fallback: {} }) ?? {},
      rootPath: row.rootPath,
      status: row.status as ProjectStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
