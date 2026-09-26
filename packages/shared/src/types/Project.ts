// ────────────────────────────────────────────────────────────────
// Project & Codebase Management — Domain types
// ────────────────────────────────────────────────────────────────

import type { HarnessConfig } from './Workflow.js';
import type { WorkflowRunStatus } from './WorkflowRun.js';

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
  /**
   * G-13 — Projects columns + ProjectDetail tab counts. Present only when
   * the request asked for it (`?include=summary`); absent otherwise, and
   * absent (never invented) on the fields a service could not answer
   * (D-36) — `needsYou` / `running` while the attention feed has not
   * finished its first snapshot.
   */
  summary?: ProjectSummary;
}

export type ProjectStatus = 'active' | 'archived';

/** G-13 — `GET /projects?include=summary` / `GET /projects/:id?include=summary`. */
export interface ProjectSummary {
  codebases: number;
  activeChats: number;
  /** Omitted (not `0`) while the attention feed is unavailable (D-36). */
  needsYou?: number;
  running?: number;
  worktrees: { active: number; orphaned: number };
  /** Total workflow runs across every definition in this project. */
  runs: number;
  lastRun?: {
    runId: string;
    definitionId: string;
    name: string;
    status: WorkflowRunStatus;
    /** ISO timestamp: the run's `completedAt`, else `startedAt`, else `createdAt`. */
    at: string;
  };
}

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

// ── Codebase fetch/clone jobs (G-16) ──

export type CodebaseJobKind = 'clone' | 'fetch';
export type CodebaseJobStatus = 'running' | 'succeeded' | 'failed';

/** One background clone/fetch job. Tracked in memory only (process lifetime). */
export interface CodebaseJob {
  id: string;
  kind: CodebaseJobKind;
  status: CodebaseJobStatus;
  startedAt: string;
  endedAt?: string;
  error?: string;
}

export interface CodebaseLogLine {
  ts: string;
  stream: 'stdout' | 'stderr';
  text: string;
}

/** `GET /projects/:id/codebases/:cid/logs` — a ring buffer of the last N lines. */
export interface CodebaseLogsResponse {
  lines: CodebaseLogLine[];
  /** The job that produced (or is still producing) these lines, if any ran this process lifetime. */
  job?: CodebaseJob;
}

/** `POST /projects/:id/codebases/:cid/fetch` — 202, the fetch runs in the background. */
export interface FetchCodebaseResult {
  jobId: string;
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

// ── Worktree enrichment (G-17) ──

/** What a worktree is checked out for — a chat (mount) or a workflow/automation run. */
export type WorktreeLinkEntity = 'chat' | 'workflow_run';

export interface WorktreeLink {
  entity: WorktreeLinkEntity;
  id: string;
  title: string;
  /** The chat's lifecycle status, or the run's status — whichever `entity` says. */
  status: string;
}

/**
 * `WorktreeInfo` plus what `?include=usage,link` asked for. Every added field
 * is OMITTED (never a fake `0`/placeholder) until it is actually known:
 * `sizeBytes` before the async directory walk has completed, `link` when the
 * owning chat/run no longer exists, `expiresAt` under manual retention.
 */
export interface WorktreeListItem extends WorktreeInfo {
  sizeBytes?: number;
  link?: WorktreeLink;
  expiresAt?: string;
}

/** `GET /projects/:id/codebases/:cid/worktrees?include=usage,link`. */
export interface WorktreeListEnriched {
  items: WorktreeListItem[];
  /** Sum of every item's `sizeBytes` that has been measured so far. Omitted when none have. */
  totalBytes?: number;
  /** Sum of `sizeBytes` for items eligible for cleanup (non-active, or active-orphaned). */
  reclaimableBytes?: number;
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
