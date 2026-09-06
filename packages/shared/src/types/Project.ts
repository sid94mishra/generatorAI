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
  /**
   * MCP configs only — names of the credentials held in the secrets vault
   * under `mcp/project/<id>` (migration v48, `credential_refs`). Never values.
   */
  credentialRefs?: { headers?: string[]; env?: string[] };
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

/**
 * Wire shape of an MCP server as returned by every list endpoint
 * (`/system/mcp-servers`, `/projects/:id/mcp-servers`).
 *
 * Credential VALUES are never on the wire: `headers` / `env` carry the
 * redaction marker per key, and `hasCredentials` says whether any are stored.
 */
export interface McpServerEntry {
  id: string;
  name: string;
  description?: string;
  serverType: 'http' | 'sse' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
  timeoutMs?: number;
  source: ArtifactSource | 'custom';
  /** Effective on/off: the user's toggle AND fully configured. */
  enabled: boolean;
  /** The user's toggle alone (system/custom scope), before configuration gating. */
  userEnabled?: boolean;
  /** Redacted credential map — every value is the redaction marker. */
  headers?: Record<string, string>;
  env?: Record<string, string>;
  hasCredentials?: boolean;
  /** Present when the server cannot be sent to a harness yet. */
  needsConfiguration?: { missingInputs: string[]; missingCredentials: string[] };
  /** Bundled-catalog metadata the Settings form renders (system scope only). */
  inputs?: Array<{ key: string; label: string; description?: string; kind?: 'path' | 'text' | 'url'; required?: boolean; placeholder?: string }>;
  /** Values the user has supplied for `inputs` (system scope only). */
  inputValues?: Record<string, string>;
  credentials?: {
    env?: Array<{ name: string; label: string; description?: string; required?: boolean }>;
    headers?: Array<{ name: string; label: string; description?: string; required?: boolean }>;
  };
  category?: string;
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
