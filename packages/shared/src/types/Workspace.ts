// ────────────────────────────────────────────────────────────────
// Workspace Types — Unified Workspace Management
// ────────────────────────────────────────────────────────────────

// ── Owner Types ──

export type WorkspaceOwnerType = 'chat' | 'workflow_run' | 'automation_execution';

// ── Workspace Status ──

export type WorkspaceStatus = 'creating' | 'active' | 'completed' | 'archived' | 'failed';

// ── Mounts ──
//
// A mount is one directory the agent is allowed to edit. A workspace has an
// ordered list of them; position 0 is the primary mount (the agent's cwd),
// every other mount is exposed as an additional directory. The managed
// workspace root (plans, scratch, screenshots, staged skills) is never a
// mount — it is the place everything that is NOT a deliverable goes.

/** How the mount directory was materialised. */
export type MountMode =
  /** The user's own folder / repo, edited where it lives. Nothing is copied. */
  | 'in-place'
  /** A `git worktree` carved from the codebase clone or the user's repo. */
  | 'worktree'
  /** An empty, managed directory the agent builds a project in from nothing. */
  | 'generated';

/** Where the mount came from. */
export type MountOriginKind = 'codebase' | 'folder' | 'generated';

export type MountStatus = 'preparing' | 'ready' | 'error' | 'removed';

/** Git state of a mount, recorded when it was prepared. */
export interface MountGitState {
  isRepo: boolean;
  /** Branch checked out in `path` (worktree or in-place). */
  branch?: string;
  /** What the branch started from (worktree) or what HEAD was (in-place). */
  baseRef?: string;
  /** Commit SHA of `baseRef` at prepare time — the "Branch base" diff anchor. */
  baseCommit?: string;
  /** True when GeneratorAI created `branch` for this mount. */
  createdBranch?: boolean;
  /** Immediate sub-directories that are repositories of their own. */
  nested?: string[];
  /**
   * False for mounts backfilled from workspaces that predate shadow stores:
   * their checkpoints live in the mount's own `.git` and stay readable there.
   * New mounts always use a shadow store.
   */
  shadow?: boolean;
}

export interface WorkspaceMount {
  id: string;
  workspaceId: string;
  /** Deterministic order; 0 is the primary mount (the agent's cwd). */
  position: number;
  /** Display name, unique per workspace; the path prefix in the UI. */
  alias: string;
  originKind: MountOriginKind;
  codebaseId?: string;
  projectId?: string;
  /** The user's folder / repo, or the codebase clone (bare for git-remote). */
  originPath?: string;
  mode: MountMode;
  /** Absolute directory the agent edits. */
  path: string;
  git?: MountGitState;
  status: MountStatus;
  error?: string;
  hasUncommittedChanges: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Whether a workspace's mounts are ready for the agent. */
export type WorkspacePrepStatus = 'pending' | 'preparing' | 'ready' | 'error';

/**
 * One source a chat asks to be mounted. Validated at chat creation, resolved
 * into `WorkspaceMount`s by the mount service.
 */
export type ChatSourceSpec =
  | {
      kind: 'codebase';
      codebaseId: string;
      mode?: 'in-place' | 'worktree';
      /** Existing branch to check out / cut the worktree from. */
      branch?: string;
      /** Create this branch (from `baseRef`, or `branch`, or HEAD). */
      newBranch?: string;
      baseRef?: string;
      alias?: string;
    }
  | {
      kind: 'folder';
      path: string;
      mode?: 'in-place' | 'worktree';
      branch?: string;
      newBranch?: string;
      baseRef?: string;
      alias?: string;
    };

/** Everything a harness needs to know about where a chat works. */
export interface WorkspaceExposure {
  rootPath: string;
  scratchDir: string;
  workingDirectory: string;
  additionalDirectories: string[];
  mounts: WorkspaceMount[];
  env: Record<string, string>;
  /** The `[Workspace]` system-prompt block. Byte-identical on create and resume. */
  hint: string;
}

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
  | 'browser_selection'
  // Computer Use artifact types. Always a single-window capture, never the
  // full screen — see ComputerService.
  | 'computer_screenshot';

// ── Browser Session Status (attached to workspace) ──

export type BrowserSessionStatus =
  | 'off'
  | 'starting'
  | 'active'
  | 'idle'
  | 'terminated'
  | 'error';

// ── Worktree Detail (derived from mounts for API compatibility) ──

export interface WorktreeDetail {
  codebaseId: string;
  alias: string;
  branchName: string;
  baseBranch: string;
  worktreePath: string;             // Relative to workspace root (e.g., 'source/frontend') or absolute
  status: 'active' | 'committed' | 'pushed' | 'deleted' | 'error';
}

// ── Execution Workspace (Domain Entity) ──

export interface ExecutionWorkspace {
  id: string;
  ownerType: WorkspaceOwnerType;
  ownerId: string;
  projectId?: string;
  rootPath: string;
  /**
   * Where the AGENT works and where diff / checkpoints / discard look.
   *
   * Defaults to `rootPath`. A chat bound to a local folder points this at that
   * folder while `rootPath` stays managed, so plans, artifacts, orchestrator
   * state and task scratch never land in the user's repository.
   */
  codeRoot?: string;
  status: WorkspaceStatus;
  /** Whether the mounts have been prepared (worktrees created, branches checked out). */
  prepStatus?: WorkspacePrepStatus;
  prepError?: string;
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
  prepStatus: WorkspacePrepStatus;
  prepError?: string;
  /** Ordered mounts; `mounts[0]` is the agent's cwd. */
  mounts: WorkspaceMount[];
  /** Managed scratch directory the agent is told to use for non-deliverables. */
  scratchPath: string;
  /** @deprecated derived from `mounts` — kept for older clients. */
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
  /**
   * Point the agent's working tree at an existing directory while platform
   * artifacts stay in the managed root. Used when a chat is bound to a local
   * folder: diff, checkpoints and the file list follow the code, but plans,
   * artifacts and orchestrator state do not pollute the user's repository.
   */
  codeRootOverride?: string;
  /**
   * Mount plan for the workspace. When set, the workspace row starts in
   * `prepStatus: 'pending'` and the mount service materialises the mounts.
   */
  sources?: ChatSourceSpec[];
  /** Alias of the primary mount; defaults to the first source. */
  primary?: string;
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
  /**
   * Also sweep `active` workspaces untouched for the same period.
   *
   * Retention was written to consider only `completed` workspaces, but
   * `completeWorkspace()` is called from exactly one place —
   * `WorkflowRunService`. Chat-owned workspaces therefore stay `active`
   * for ever and were permanently exempt, which is most of what accumulates.
   *
   * Off by default so the historical contract is unchanged; the nightly
   * sweep turns it on. Eligibility is `updatedAt` age, i.e. "nothing has
   * touched this in N days", which is what a user means by old.
   */
  includeStaleActive?: boolean;
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
