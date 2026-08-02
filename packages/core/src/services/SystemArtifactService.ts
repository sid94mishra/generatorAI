// ────────────────────────────────────────────────────────────────
// SystemArtifactService — Manages system-level skills/prompts/agents
// Loads from templates/system/artifacts/ at boot and persists to DB
// ────────────────────────────────────────────────────────────────

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, basename, extname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ConfigType, SystemConfig, ArtifactWithSource, ProjectConfig, ILogger } from '@generatorai/shared';

export interface ISystemConfigRepository {
  upsert(config: SystemConfig): Promise<SystemConfig>;
  getById(id: string): Promise<SystemConfig>;
  getAll(type?: ConfigType): Promise<SystemConfig[]>;
  deleteAll(): Promise<void>;
}

export class SystemArtifactService {
  constructor(
    private systemConfigRepo: ISystemConfigRepository,
    private systemArtifactsDir: string,
    private logger: ILogger,
  ) {}

  /**
   * Scan the system artifacts directory and upsert into DB.
   * Called at boot time.
   */
  async loadSystemArtifacts(): Promise<void> {
    const categories: ConfigType[] = ['skill', 'prompt', 'agent'];
    let total = 0;

    for (const type of categories) {
      const dir = join(this.systemArtifactsDir, `${type}s`);
      try {
        const dirStat = await stat(dir).catch(() => null);
        if (!dirStat?.isDirectory()) continue;

        const files = await readdir(dir, { recursive: true });
        for (const file of files) {
          const filePath = join(dir, file);
          const fileStat = await stat(filePath);
          if (!fileStat.isFile()) continue;

          const name = basename(file, extname(file));
          const id = `system-${type}-${name}`;
          const now = new Date();

          await this.systemConfigRepo.upsert({
            id,
            type,
            name,
            description: `System ${type}: ${name}`,
            filePath: resolve(filePath),
            version: '1.0.0',
            metadata: {},
            createdAt: now,
            updatedAt: now,
          });
          total++;
        }
      } catch (err) {
        this.logger.warn(`[SystemArtifact] Error scanning ${dir}: ${err}`);
      }
    }

    this.logger.info(`[SystemArtifact] Loaded ${total} system artifacts from ${this.systemArtifactsDir}`);
  }

  async listSystemArtifacts(type?: ConfigType): Promise<SystemConfig[]> {
    return this.systemConfigRepo.getAll(type);
  }

  async getSystemArtifactContent(id: string): Promise<string> {
    const config = await this.systemConfigRepo.getById(id);
    return readFile(config.filePath, 'utf-8');
  }

  /**
   * Get merged list: system + project artifacts with source indicator.
   */
  async getAvailableArtifacts(
    projectConfigs: ProjectConfig[],
    type?: ConfigType,
  ): Promise<ArtifactWithSource[]> {
    const systemArtifacts = await this.listSystemArtifacts(type);
    const result: ArtifactWithSource[] = [];

    for (const sa of systemArtifacts) {
      result.push({
        id: sa.id,
        type: sa.type,
        name: sa.name,
        description: sa.description,
        filePath: sa.filePath,
        source: 'system',
        metadata: sa.metadata,
      });
    }

    const filteredProjectConfigs = type
      ? projectConfigs.filter((c) => c.type === type)
      : projectConfigs;

    for (const pc of filteredProjectConfigs) {
      result.push({
        id: pc.id,
        type: pc.type,
        name: pc.name,
        description: pc.description,
        filePath: pc.filePath,
        source: 'project',
        metadata: pc.metadata,
      });
    }

    return result;
  }
}
