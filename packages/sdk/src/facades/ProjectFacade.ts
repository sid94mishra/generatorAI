// ────────────────────────────────────────────────────────────────
// ProjectFacade — ai.projects.*
//
// Covers Project CRUD, Codebase linking/cloning, Worktrees,
// and ProjectConfig management.
// ────────────────────────────────────────────────────────────────

import type {
  ProjectService,
  CodebaseService,
  WorktreeService,
  ProjectConfigService,
} from '@generatorai/core';

// Re-export domain types for SDK consumers
export interface CreateProjectInput {
  name: string;
  description?: string;
  tags?: string[];
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  tags?: string[];
}

export interface LinkCodebaseInput {
  name: string;
  sourceType: 'git_remote' | 'local_repo' | 'local_dir';
  url?: string;
  localPath?: string;
  defaultBranch?: string;
  autoClone?: boolean;
}

export interface CreateWorktreeOptions {
  baseBranch?: string;
  targetDir?: string;
}

export interface UploadConfigInput {
  name: string;
  type: string;
  description?: string;
}

export class ProjectFacade {
  constructor(
    private projectService: ProjectService,
    private codebaseService: CodebaseService,
    private worktreeService: WorktreeService,
    private projectConfigService: ProjectConfigService,
  ) {}

  // ── Project CRUD ──

  /** Create a new project */
  async create(input: CreateProjectInput) {
    return this.projectService.createProject(input);
  }

  /** Get a project by ID */
  async get(projectId: string) {
    return this.projectService.getProject(projectId);
  }

  /** Get a project with all linked codebases */
  async getWithCodebases(projectId: string) {
    return this.projectService.getProjectWithCodebases(projectId);
  }

  /** List all projects */
  async list(filter?: { status?: string }) {
    return this.projectService.listProjects(filter as never);
  }

  /** Update a project */
  async update(projectId: string, updates: UpdateProjectInput) {
    return this.projectService.updateProject(projectId, updates);
  }

  /** Archive a project */
  async archive(projectId: string) {
    return this.projectService.archiveProject(projectId);
  }

  /** Delete a project */
  async delete(projectId: string) {
    return this.projectService.deleteProject(projectId);
  }

  // ── Codebase Management ──

  /** Link a codebase (git repo or local dir) to a project */
  async linkCodebase(projectId: string, input: LinkCodebaseInput) {
    return this.codebaseService.linkCodebase(projectId, input as never);
  }

  /** Unlink a codebase from a project */
  async unlinkCodebase(codebaseId: string) {
    return this.codebaseService.unlinkCodebase(codebaseId);
  }

  /** Fetch latest changes for a codebase */
  async fetchCodebase(codebaseId: string) {
    return this.codebaseService.fetchCodebase(codebaseId);
  }

  /** Fetch all codebases for a project */
  async fetchAllCodebases(projectId: string) {
    return this.codebaseService.fetchAllCodebases(projectId);
  }

  /** List branches for a codebase */
  async listBranches(codebaseId: string) {
    return this.codebaseService.listBranches(codebaseId);
  }

  /** List codebases for a project */
  async listCodebases(projectId: string) {
    return this.codebaseService.getByProjectId(projectId);
  }

  /** List files in a codebase */
  async listCodebaseFiles(codebaseId: string, subPath?: string) {
    return this.codebaseService.listCodebaseFiles(codebaseId, subPath);
  }

  /** Get file content from a codebase */
  async getFileContent(codebaseId: string, filePath: string) {
    return this.codebaseService.getCodebaseFileContent(codebaseId, filePath);
  }

  // ── Worktree Management ──

  /** Create a worktree for a run */
  async createWorktree(codebaseId: string, runId: string, options?: CreateWorktreeOptions) {
    return this.worktreeService.createWorktree(codebaseId, runId, options as never);
  }

  /** Create worktrees for multiple codebases at once */
  async createRunWorktrees(projectId: string, runId: string, selectedAliases: string[], targetDir?: string) {
    return this.worktreeService.createRunWorktrees(projectId, runId, selectedAliases, undefined, targetDir);
  }

  /** Remove a worktree */
  async removeWorktree(worktreeId: string) {
    return this.worktreeService.removeWorktree(worktreeId);
  }

  /** List worktrees (optionally filter by project or run) */
  async listWorktrees(projectId?: string, runId?: string) {
    return this.worktreeService.listWorktrees(projectId, runId);
  }

  // ── Config Management ──

  /** Upload a config file to a project */
  async uploadConfig(projectId: string, input: UploadConfigInput, content: string) {
    return this.projectConfigService.uploadConfig(projectId, input as never, content);
  }

  /** List configs for a project */
  async listConfigs(projectId: string, type?: string) {
    return this.projectConfigService.listConfigs(projectId, type as never);
  }

  /** Get config file content */
  async getConfigContent(configId: string) {
    return this.projectConfigService.getConfigContent(configId);
  }

  /** Update config content */
  async updateConfigContent(configId: string, content: string) {
    return this.projectConfigService.updateConfigContent(configId, content);
  }

  /** Delete a config */
  async deleteConfig(configId: string) {
    return this.projectConfigService.deleteConfig(configId);
  }
}
