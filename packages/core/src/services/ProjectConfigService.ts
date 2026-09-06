// ────────────────────────────────────────────────────────────────
// ProjectConfigService — Upload/manage agents, prompts, skills
// ────────────────────────────────────────────────────────────────

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { IProjectConfigRepository } from '../domain/ports/index.js';
import type {
  ProjectConfig,
  ConfigType,
  CreateProjectConfigParams,
  ILogger,
} from '@generatorai/shared';
import { ValidationError } from '@generatorai/shared';
import type { ProjectService } from './ProjectService.js';

export class ProjectConfigService {
  constructor(
    private readonly configRepo: IProjectConfigRepository,
    private readonly projectService: ProjectService,
    private readonly logger: ILogger,
  ) {}

  /**
   * Upload/create a config file (agent, prompt, or skill).
   */
  async uploadConfig(
    projectId: string,
    params: CreateProjectConfigParams,
    content: string | Buffer,
  ): Promise<ProjectConfig> {
    // Validate project exists
    await this.projectService.getProject(projectId);

    const configDir = this.projectService.getProjectConfigTypeDir(projectId, params.type);
    const fullPath = path.join(configDir, params.filePath);

    // Validate path is within config dir (prevent traversal). Compare against
    // the dir WITH a trailing separator so a sibling path that merely shares
    // the prefix (e.g. "<configDir>-evil/x") cannot slip past startsWith.
    const resolved = path.resolve(fullPath);
    const resolvedDir = path.resolve(configDir);
    if (resolved !== resolvedDir && !resolved.startsWith(resolvedDir + path.sep)) {
      throw new ValidationError('Invalid file path: path traversal detected');
    }

    // Write file to disk
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);

    const id = randomUUID();
    const now = new Date();
    const config: ProjectConfig = {
      id,
      projectId,
      type: params.type,
      name: params.name,
      description: params.description,
      filePath: params.filePath,
      metadata: params.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };

    await this.configRepo.create(config);
    this.logger.info(`[ProjectConfig] Uploaded ${params.type} "${params.name}" for project ${projectId}`);
    return config;
  }

  async deleteConfig(configId: string): Promise<void> {
    const config = await this.configRepo.getById(configId);

    // Remove from filesystem
    const configDir = this.projectService.getProjectConfigTypeDir(config.projectId, config.type);
    const fullPath = path.join(configDir, config.filePath);
    try {
      await fs.rm(fullPath, { force: true });
    } catch {
      // Best effort
    }

    await this.configRepo.delete(configId);
    this.logger.info(`[ProjectConfig] Deleted config ${configId}`);
  }

  async listConfigs(projectId: string, type?: ConfigType): Promise<ProjectConfig[]> {
    return this.configRepo.getByProjectId(projectId, type);
  }

  async getConfigContent(configId: string): Promise<string> {
    const config = await this.configRepo.getById(configId);
    const configDir = this.projectService.getProjectConfigTypeDir(config.projectId, config.type);
    const fullPath = path.join(configDir, config.filePath);
    return fs.readFile(fullPath, 'utf-8');
  }

  async updateConfigContent(configId: string, content: string): Promise<void> {
    const config = await this.configRepo.getById(configId);
    const configDir = this.projectService.getProjectConfigTypeDir(config.projectId, config.type);
    const fullPath = path.join(configDir, config.filePath);

    // Validate path is within config dir (prevent traversal). Compare against
    // the dir WITH a trailing separator so a sibling path that merely shares
    // the prefix (e.g. "<configDir>-evil/x") cannot slip past startsWith.
    const resolved = path.resolve(fullPath);
    const resolvedDir = path.resolve(configDir);
    if (resolved !== resolvedDir && !resolved.startsWith(resolvedDir + path.sep)) {
      throw new ValidationError('Invalid file path: path traversal detected');
    }

    await fs.writeFile(fullPath, content, 'utf-8');
    await this.configRepo.update(configId, { updatedAt: new Date() });
    this.logger.info(`[ProjectConfig] Updated content for config ${configId}`);
  }

  /**
   * Create a config from a JSON/text body (no file upload) — used for MCP server configs.
   */
  async createJsonConfig(
    projectId: string,
    params: CreateProjectConfigParams,
    content: string,
  ): Promise<ProjectConfig> {
    return this.uploadConfig(projectId, params, Buffer.from(content, 'utf-8'));
  }

  async patchConfigMeta(configId: string, updates: { name?: string; description?: string }): Promise<void> {
    const patch: Partial<ProjectConfig> = { updatedAt: new Date() };
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.description !== undefined) patch.description = updates.description;
    await this.configRepo.update(configId, patch);
  }

  /** Raw row read — used by the MCP routes to see the current `credentialRefs`. */
  async getConfig(configId: string): Promise<ProjectConfig> {
    return this.configRepo.getById(configId);
  }

  /**
   * MCP configs only — persist the credential NAMES a `McpCredentialVault.save()`
   * returned. Never called with values; the vault is the only thing that ever
   * writes a value, and it writes to the secrets store, not here.
   */
  async setCredentialRefs(
    configId: string,
    credentialRefs: { headers?: string[]; env?: string[] },
  ): Promise<void> {
    await this.configRepo.update(configId, { credentialRefs });
  }

  /**
   * Scan a project's config directory and sync DB metadata.
   */
  async scanProjectConfigs(projectId: string): Promise<ProjectConfig[]> {
    const project = await this.projectService.getProject(projectId);
    const results: ProjectConfig[] = [];

    const types: ConfigType[] = ['agent', 'prompt', 'skill'];
    for (const type of types) {
      const typeDir = this.projectService.getProjectConfigTypeDir(projectId, type);
      try {
        const files = await this.walkDir(typeDir);
        for (const file of files) {
          const relativePath = path.relative(typeDir, file);
          const name = path.basename(file, path.extname(file));

          // Check if already tracked
          const existing = await this.configRepo.getByProjectId(projectId, type);
          const alreadyTracked = existing.find((c) => c.filePath === relativePath);
          if (alreadyTracked) {
            results.push(alreadyTracked);
            continue;
          }

          // Create DB entry
          const config: ProjectConfig = {
            id: randomUUID(),
            projectId,
            type,
            name,
            filePath: relativePath,
            metadata: {},
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          await this.configRepo.create(config);
          results.push(config);
        }
      } catch {
        // Directory might not exist
      }
    }

    return results;
  }

  private async walkDir(dir: string): Promise<string[]> {
    const results: string[] = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...await this.walkDir(fullPath));
        } else {
          results.push(fullPath);
        }
      }
    } catch {
      // Directory doesn't exist
    }
    return results;
  }
}
