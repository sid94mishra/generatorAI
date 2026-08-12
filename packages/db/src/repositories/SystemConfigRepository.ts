// ────────────────────────────────────────────────────────────────
// DrizzleSystemConfigRepository — System-level artifact persistence
// ────────────────────────────────────────────────────────────────

import { eq } from 'drizzle-orm';
import type { SystemConfig, ConfigType } from '@generatorai/shared';
import { NotFoundError, StorageError } from '@generatorai/shared';
import { systemConfigs } from '../schema.js';
import type { AppDatabase } from '../index.js';
import { safeJsonColumn } from '../utils/safeJsonColumn.js';
import { validateJsonColumn } from '../utils/validateJsonColumn.js';
import { jsonRecord } from '../utils/jsonColumnSchemas.js';

export class DrizzleSystemConfigRepository {
  constructor(private db: AppDatabase) {}

  async upsert(config: SystemConfig): Promise<SystemConfig> {
    try {
      validateJsonColumn(config.metadata, jsonRecord, { column: 'metadata', table: 'system_configs' });
      // Try insert first; on conflict update
      await this.db
        .insert(systemConfigs)
        .values({
          id: config.id,
          type: config.type as 'agent' | 'prompt' | 'skill',
          name: config.name,
          description: config.description ?? null,
          filePath: config.filePath,
          version: config.version ?? '1.0.0',
          metadata: config.metadata ?? {},
          createdAt: config.createdAt,
          updatedAt: config.updatedAt,
        })
        .onConflictDoUpdate({
          target: systemConfigs.id,
          set: {
            name: config.name,
            description: config.description ?? null,
            filePath: config.filePath,
            version: config.version ?? '1.0.0',
            metadata: config.metadata ?? {},
            updatedAt: config.updatedAt,
          },
        });
      return config;
    } catch (err) {
      throw new StorageError(
        `Failed to upsert system config: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  async getById(id: string): Promise<SystemConfig> {
    const rows = await this.db
      .select()
      .from(systemConfigs)
      .where(eq(systemConfigs.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('SystemConfig', id);
    return this.mapRow(row);
  }

  async getAll(type?: ConfigType): Promise<SystemConfig[]> {
    if (type) {
      const rows = await this.db
        .select()
        .from(systemConfigs)
        .where(eq(systemConfigs.type, type as 'agent' | 'prompt' | 'skill'))
        .orderBy(systemConfigs.name);
      return rows.map((r) => this.mapRow(r));
    }
    const rows = await this.db
      .select()
      .from(systemConfigs)
      .orderBy(systemConfigs.name);
    return rows.map((r) => this.mapRow(r));
  }

  async deleteAll(): Promise<void> {
    await this.db.delete(systemConfigs);
  }

  private mapRow(row: typeof systemConfigs.$inferSelect): SystemConfig {
    return {
      id: row.id,
      type: row.type as ConfigType,
      name: row.name,
      description: row.description ?? undefined,
      filePath: row.filePath,
      version: row.version ?? '1.0.0',
      metadata: safeJsonColumn(row.metadata, jsonRecord, { fallback: {} }) ?? {},
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
