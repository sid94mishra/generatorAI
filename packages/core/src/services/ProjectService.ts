// ────────────────────────────────────────────────────────────────
// ProjectService — CRUD + filesystem management for Projects
// ────────────────────────────────────────────────────────────────

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { IProjectRepository, IProjectCodebaseRepository, IProjectConfigRepository } from '../domain/ports/index.js';
import type {
  Project,
  ProjectStatus,
  CreateProjectParams,
  UpdateProjectParams,
  ProjectSettings,
  ProjectWithCodebases,
  ProjectConfig,
  ConfigType,
  ILogger,
} from '@generatorai/shared';

export class ProjectService {
  constructor(
    private readonly projectRepo: IProjectRepository,
    private readonly codebaseRepo: IProjectCodebaseRepository,
    private readonly configRepo: IProjectConfigRepository,
    private readonly artifactsDir: string,
    private readonly logger: ILogger,
  ) {}

  /** Get the projects root directory */
  private getProjectsRoot(): string {
    return path.join(this.artifactsDir, 'projects');
  }

  /** Get a project's filesystem root */
  getProjectRoot(projectId: string): string {
    return path.join(this.getProjectsRoot(), projectId);
  }

  /** Get a project's repos directory */
  getProjectReposDir(projectId: string): string {
    return path.join(this.getProjectRoot(projectId), 'repos');
  }

  /** Get a project's worktrees directory (legacy — retained for cleanup of existing worktrees) */
  getProjectWorktreesDir(projectId: string): string {
    return path.join(this.getProjectRoot(projectId), 'worktrees');
  }

  /** Get a project's config directory */
  getProjectConfigDir(projectId: string): string {
    return path.join(this.getProjectRoot(projectId), 'config');
  }

  /** Get project config subdirectory for a type */
  getProjectConfigTypeDir(projectId: string, type: ConfigType): string {
    return path.join(this.getProjectConfigDir(projectId), `${type}s`);
  }

  async createProject(params: CreateProjectParams): Promise<Project> {
    const id = randomUUID();
    const rootPath = this.getProjectRoot(id);
    const now = new Date();

    const defaultSettings: ProjectSettings = {
      maxCodebases: 10,
      worktreeRetention: 'hours-24',
      autoFetchInterval: 0,
      ...params.settings,
    };

    const project: Project = {
      id,
      name: params.name,
      description: params.description,
      settings: defaultSettings,
      rootPath,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    // Create filesystem structure
    await fs.mkdir(rootPath, { recursive: true });
    await fs.mkdir(path.join(rootPath, 'repos'), { recursive: true });
    await fs.mkdir(path.join(rootPath, 'config', 'agents'), { recursive: true });
    await fs.mkdir(path.join(rootPath, 'config', 'prompts'), { recursive: true });
    await fs.mkdir(path.join(rootPath, 'config', 'skills'), { recursive: true });
    await fs.mkdir(path.join(rootPath, 'artifacts'), { recursive: true });

    await this.projectRepo.create(project);
    this.logger.info(`[Project] Created project "${params.name}" (${id})`);
    return project;
  }

  async getProject(id: string): Promise<Project> {
    return this.projectRepo.getById(id);
  }

  async listProjects(filter?: { status?: ProjectStatus }): Promise<Project[]> {
    return this.projectRepo.getAll(filter);
  }

  async updateProject(id: string, updates: UpdateProjectParams): Promise<Project> {
    const existing = await this.projectRepo.getById(id);

    const merged: Partial<Project> = {};
    if (updates.name !== undefined) merged.name = updates.name;
    if (updates.description !== undefined) merged.description = updates.description;
    if (updates.status !== undefined) merged.status = updates.status;
    if (updates.settings !== undefined) {
      merged.settings = { ...existing.settings, ...updates.settings };
    }

    const updated = await this.projectRepo.update(id, merged);
    this.logger.info(`[Project] Updated project ${id}`);
    return updated;
  }

  async archiveProject(id: string): Promise<Project> {
    const updated = await this.projectRepo.update(id, { status: 'archived' });
    this.logger.info(`[Project] Archived project ${id}`);
    return updated;
  }

  async deleteProject(id: string): Promise<void> {
    const project = await this.projectRepo.getById(id);

    // Delete from DB (cascades to codebases, configs, worktrees)
    await this.projectRepo.delete(id);

    // Clean up filesystem
    try {
      await fs.rm(project.rootPath, { recursive: true, force: true });
    } catch (err) {
      this.logger.warn(`[Project] Failed to clean up filesystem for ${id}: ${err}`);
    }

    this.logger.info(`[Project] Deleted project ${id}`);
  }

  async getProjectWithCodebases(id: string): Promise<ProjectWithCodebases> {
    const project = await this.projectRepo.getById(id);
    const codebases = await this.codebaseRepo.getByProjectId(id);
    return { ...project, codebases };
  }

  async getProjectConfigs(id: string, type?: ConfigType): Promise<ProjectConfig[]> {
    return this.configRepo.getByProjectId(id, type);
  }
}
