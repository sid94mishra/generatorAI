// ────────────────────────────────────────────────────────────────
// DrizzleProjectCodebaseRepository — IProjectCodebaseRepository impl
// ────────────────────────────────────────────────────────────────

import { eq, and } from 'drizzle-orm';
import type { IProjectCodebaseRepository } from '@generatorai/core';
import type { ProjectCodebase, CodebaseStatus } from '@generatorai/shared';
import { NotFoundError, StorageError } from '@generatorai/shared';
import { projectCodebases } from '../schema.js';
import type { AppDatabase } from '../index.js';
import { safeJsonColumn } from '../utils/safeJsonColumn.js';
import { jsonRecord } from '../utils/jsonColumnSchemas.js';

export class DrizzleProjectCodebaseRepository implements IProjectCodebaseRepository {
  constructor(private db: AppDatabase) {}

  async create(codebase: ProjectCodebase): Promise<ProjectCodebase> {
    try {
      await this.db.insert(projectCodebases).values({
        id: codebase.id,
        projectId: codebase.projectId,
        alias: codebase.alias,
        type: codebase.type,
        url: codebase.url ?? null,
        localPath: codebase.localPath ?? null,
        defaultBranch: codebase.defaultBranch ?? null,
        subdirectory: codebase.subdirectory ?? null,
        clonePath: codebase.clonePath ?? null,
        status: codebase.status,
        lastFetchedAt: codebase.lastFetchedAt ?? null,
        lastError: codebase.lastError ?? null,
        settings: codebase.settings ?? {},
        createdAt: codebase.createdAt,
        updatedAt: codebase.updatedAt,
      });
      return codebase;
    } catch (err) {
      throw new StorageError(
        `Failed to create project codebase: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  async getById(id: string): Promise<ProjectCodebase> {
    const rows = await this.db
      .select()
      .from(projectCodebases)
      .where(eq(projectCodebases.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('ProjectCodebase', id);
    return this.mapRow(row);
  }

  async getByProjectId(projectId: string): Promise<ProjectCodebase[]> {
    const rows = await this.db
      .select()
      .from(projectCodebases)
      .where(eq(projectCodebases.projectId, projectId))
      .orderBy(projectCodebases.createdAt);
    return rows.map((r) => this.mapRow(r));
  }

  async getByAlias(projectId: string, alias: string): Promise<ProjectCodebase | undefined> {
    const rows = await this.db
      .select()
      .from(projectCodebases)
      .where(and(
        eq(projectCodebases.projectId, projectId),
        eq(projectCodebases.alias, alias),
      ))
      .limit(1);
    const row = rows[0];
    return row ? this.mapRow(row) : undefined;
  }

  async update(
    id: string,
    updates: Omit<Partial<ProjectCodebase>, 'lastError'> & { lastError?: string | null },
  ): Promise<ProjectCodebase> {
    const values: Record<string, unknown> = {};
    if (updates.alias !== undefined) values['alias'] = updates.alias;
    if (updates.type !== undefined) values['type'] = updates.type;
    if (updates.url !== undefined) values['url'] = updates.url;
    if (updates.localPath !== undefined) values['localPath'] = updates.localPath;
    if (updates.defaultBranch !== undefined) values['defaultBranch'] = updates.defaultBranch;
    if (updates.subdirectory !== undefined) values['subdirectory'] = updates.subdirectory;
    if (updates.clonePath !== undefined) values['clonePath'] = updates.clonePath;
    if (updates.status !== undefined) values['status'] = updates.status;
    if (updates.lastFetchedAt !== undefined) values['lastFetchedAt'] = updates.lastFetchedAt;
    if (updates.lastError !== undefined) values['lastError'] = updates.lastError;
    if (updates.settings !== undefined) values['settings'] = updates.settings;
    values['updatedAt'] = new Date();

    await this.db.update(projectCodebases).set(values).where(eq(projectCodebases.id, id));
    return this.getById(id);
  }

  async updateStatus(id: string, status: CodebaseStatus, lastError?: string): Promise<void> {
    const values: Record<string, unknown> = { status, updatedAt: new Date() };
    if (lastError !== undefined) values['lastError'] = lastError;
    if (status === 'ready') values['lastFetchedAt'] = new Date();
    await this.db.update(projectCodebases).set(values).where(eq(projectCodebases.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(projectCodebases).where(eq(projectCodebases.id, id));
  }

  async deleteByProjectId(projectId: string): Promise<void> {
    await this.db.delete(projectCodebases).where(eq(projectCodebases.projectId, projectId));
  }

  private mapRow(row: typeof projectCodebases.$inferSelect): ProjectCodebase {
    return {
      id: row.id,
      projectId: row.projectId,
      alias: row.alias,
      type: row.type as ProjectCodebase['type'],
      url: row.url ?? undefined,
      localPath: row.localPath ?? undefined,
      defaultBranch: row.defaultBranch ?? undefined,
      subdirectory: row.subdirectory ?? undefined,
      clonePath: row.clonePath ?? undefined,
      status: row.status as ProjectCodebase['status'],
      lastFetchedAt: row.lastFetchedAt ?? undefined,
      lastError: row.lastError ?? undefined,
      settings: safeJsonColumn(row.settings, jsonRecord, { fallback: {} }) ?? {},
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
