// ────────────────────────────────────────────────────────────────
// Project & Codebase Management — Domain types
// ────────────────────────────────────────────────────────────────

import type { HarnessConfig } from './Workflow.js';

// ── Project ──

export interface Project {
  id: string;
  name: string;
  description?: string;
  settings: ProjectSettings;
  rootPath: string;
  status: ProjectStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type ProjectStatus = 'active' | 'archived';

export interface ProjectSettings {
  defaultModel?: string;
  defaultSessionMode?: 'single' | 'per-stage' | 'auto';
  maxCodebases?: number;
  worktreeRetention?: WorktreeRetentionPolicy;
  autoFetchInterval?: number;
  harnessConfig?: Partial<HarnessConfig>;
}

export type WorktreeRetentionPolicy = 'immediate' | 'hours-24' | 'hours-72' | 'manual';

export interface CreateProjectParams {
  name: string;
  description?: string;
  settings?: Partial<ProjectSettings>;
}

export interface UpdateProjectParams {
  name?: string;
  description?: string;
  settings?: Partial<ProjectSettings>;
  status?: ProjectStatus;
}

// ── Project Codebase ──

export type CodebaseType = 'git-remote' | 'git-local' | 'local-dir';
export type CodebaseStatus = 'pending' | 'cloning' | 'ready' | 'error' | 'stale';

export interface ProjectCodebase {
  id: string;
  projectId: string;
  alias: string;
  type: CodebaseType;
  url?: string;
  localPath?: string;
  defaultBranch?: string;
  subdirectory?: string;
  clonePath?: string;
  status: CodebaseStatus;
  lastFetchedAt?: Date;
  lastError?: string;
  settings: CodebaseSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface CodebaseSettings {
  autoFetchEnabled?: boolean;
  autoFetchIntervalMinutes?: number;
  shallowClone?: boolean;
  worktreeInclude?: string[];
}

export interface CreateCodebaseParams {
  alias: string;
  type: CodebaseType;
  url?: string;
  localPath?: string;
  defaultBranch?: string;
  subdirectory?: string;
  settings?: Partial<CodebaseSettings>;
}

export interface UpdateCodebaseParams {
  alias?: string;
  defaultBranch?: string;
  subdirectory?: string;
  settings?: Partial<CodebaseSettings>;
  /**
   * Where the code lives. These were previously not updatable, so a codebase
   * linked with a typo'd URL or path was stuck in `status: 'error'` forever —
   * the only remedy was to delete it and add it again, losing its worktrees.
   */
  url?: string;
  localPath?: string;
}

// ── Project Config ──

export type ConfigType = 'agent' | 'prompt' | 'skill' | 'mcp';

export interface ProjectConfig {
  id: string;
  projectId: string;
  type: ConfigType;
  name: string;
  description?: string;
  filePath: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProjectConfigParams {
  type: ConfigType;
  name: string;
  description?: string;
  filePath: string;
  metadata?: Record<string, unknown>;
}

// ── Worktree ──

export type WorktreeRunType = 'workflow' | 'automation' | 'manual';
export type WorktreeStatus = 'active' | 'completed' | 'orphaned' | 'cleanup-pending';

export interface WorktreeInfo {
  id: string;
  projectId: string;
  codebaseId: string;
  runId?: string;
  runType?: WorktreeRunType;
  worktreePath: string;
  branchName: string;
  status: WorktreeStatus;
  createdAt: Date;
  cleanedUpAt?: Date;
}

// ── Scope ──

export type EntityScope = 'global' | string[];

// ── System Config ──

export interface SystemConfig {
  id: string;
  type: ConfigType;
  name: string;
  description?: string;
  filePath: string;
  version: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ── Artifact with Source ──

export type ArtifactSource = 'system' | 'project';
export type ArtifactType = ConfigType;

export interface ArtifactWithSource {
  id: string;
  type: ConfigType;
  name: string;
  description?: string;
  filePath: string;
  source: ArtifactSource;
  metadata: Record<string, unknown>;
}

// ── MCP Server Entry ──

export interface McpServerEntry {
  id: string;
  name: string;
  description?: string;
  serverType: 'http' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
  source: ArtifactSource;
  enabled: boolean;
}

// ── File Entries ──

export interface FileEntry {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
  extension?: string;
}

/**
 * Project with its linked codebases.
 */
export interface ProjectWithCodebases extends Project {
  codebases: ProjectCodebase[];
}
