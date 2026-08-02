// ────────────────────────────────────────────────────────────────
// Workspace Types — Unified Workspace Management
// ────────────────────────────────────────────────────────────────

// ── Owner Types ──

export type WorkspaceOwnerType = 'chat' | 'workflow_run' | 'automation_execution';

// ── Workspace Status ──

export type WorkspaceStatus = 'creating' | 'active' | 'completed' | 'archived' | 'failed';

// ── Worktree Status ──

export type WorkspaceWorktreeStatus = 'active' | 'committed' | 'pushed' | 'deleted' | 'error';

// ── Artifact Type ──

export type WorkspaceArtifactType =
  | 'code_file'
  | 'response_md'
  | 'attachment'
  | 'script_output'
  | 'log'
  | 'snapshot'
  // Integrated Browser artifact types (v13).
  | 'browser_screenshot'
  | 'browser_dom'
  | 'browser_har'
  | 'browser_console_log'
  | 'browser_video'
  | 'browser_selection';

// ── Browser Session Status (attached to workspace) ──

export type BrowserSessionStatus =
  | 'off'
  | 'starting'
  | 'active'
  | 'idle'
  | 'terminated'
  | 'error';

// ── Worktree Detail ──

export interface WorktreeDetail {
  codebaseId: string;
  alias: string;
  branchName: string;
  baseBranch: string;
  worktreePath: string;             // Relative to workspace root (e.g., 'source/frontend')
  status: WorkspaceWorktreeStatus;
}

// ── Execution Workspace (Domain Entity) ──

export interface ExecutionWorkspace {
  id: string;
  ownerType: WorkspaceOwnerType;
  ownerId: string;
  projectId?: string;
  rootPath: string;
  status: WorkspaceStatus;
  gitEnabled: boolean;
  useWorktree: boolean;
  snapshotPath?: string;
  metadata?: Record<string, unknown>;
  /** Integrated Browser config (nullable — browser is opt-in per workspace). */
  browserConfig?: Record<string, unknown>;
  browserStatus?: BrowserSessionStatus;
  browserCurrentUrl?: string;
  /** CDP endpoint URL exposed by the shared Chromium (loopback only). */
  browserCdpEndpoint?: string;
  /** CDP targetId of the top-level page under agent+user control. */
  browserTargetId?: string;
  browserStartedAt?: Date;
  browserLastActivityAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  archivedAt?: Date;
}

// ── Workspace Worktree Record (DB Entity) ──

export interface WorkspaceWorktreeRecord {
  id: string;
  workspaceId: string;
  codebaseId: string;
  alias: string;
  branchName: string;
  baseBranch: string;
  relativePath: string;
  status: WorkspaceWorktreeStatus;
  commitHash?: string;
  hasUncommittedChanges: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ── Workspace Artifact Record (DB Entity) ──

export interface WorkspaceArtifactRecord {
  id: string;
  workspaceId: string;
  stageRunId?: string;
  artifactType: WorkspaceArtifactType;
  relativePath: string;
  fileSize?: number;
  mimeType?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

// ── Workspace Info (API Response DTO) ──

export interface WorkspaceInfo {
  id: string;
  ownerType: WorkspaceOwnerType;
  ownerId: string;
  projectId?: string;
  rootPath: string;
  workingDirectory: string;
  sourcePaths: string[];
  artifactsPath: string;
  status: WorkspaceStatus;
  worktrees: WorktreeDetail[];
  diskUsage?: number;
  createdAt: Date;
}

// ── Create Workspace Params ──

export interface CreateWorkspaceParams {
  ownerType: WorkspaceOwnerType;
  ownerId: string;
  projectId?: string;
  codebaseIds?: string[];
  useWorktree?: boolean;
  gitEnabled?: boolean;
  stageSystemArtifacts?: boolean;
  stageProjectArtifacts?: boolean;
  stageMcpConfig?: boolean;
  scriptPaths?: string[];
  attachments?: Array<{ name: string; path: string; mimeType?: string }>;
  /**
   * Integrated Browser config to seed on the new workspace. Chats + workflow
   * runs pass their definition-level `browserConfig` here so the built-in
   * browser tools inherit `visibility`, `evalAllowed`, `allowedHosts`, etc.
   * from the run/chat's declared config on first tool invocation.
   */
  browserConfig?: Record<string, unknown>;
}

// ── Workspace Filters ──

export interface WorkspaceFilters {
  ownerType?: WorkspaceOwnerType;
  projectId?: string;
  status?: WorkspaceStatus;
  limit?: number;
  offset?: number;
}

// ── Track Artifact Params ──

export interface TrackArtifactParams {
  workspaceId: string;
  stageRunId?: string;
  artifactType: WorkspaceArtifactType;
  relativePath: string;
  fileSize?: number;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

// ── Retention Policy ──

export interface WorkspaceRetentionPolicy {
  completedRetentionHours: number;
  archiveIfDirty: boolean;
  protectUnpushed: boolean;
  maxTotalDiskMB: number;
  respectAutomationRetention: boolean;
}

// ── Workspace Manifest (.workspace.json) ──

export interface WorkspaceManifest {
  version: number;
  id: string;
  ownerType: WorkspaceOwnerType;
  ownerId: string;
  projectId?: string;
  createdAt: string;
  config: {
    useWorktree: boolean;
    gitEnabled: boolean;
    sdkWorkingDirectory: string;
  };
  worktrees: WorktreeDetail[];
  stagedArtifacts?: {
    agents?: string[];
    prompts?: string[];
    skills?: string[];
    mcp?: string[];
  };
  scripts?: string[];
}
