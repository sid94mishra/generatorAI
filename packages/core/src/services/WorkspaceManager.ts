// ────────────────────────────────────────────────────────────────
// WorkspaceManager — Central workspace lifecycle service
// ────────────────────────────────────────────────────────────────

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { ILogger } from '@generatorai/shared';
import type {
  ExecutionWorkspace,
  CreateWorkspaceParams,
  WorkspaceInfo,
  WorkspaceFilters,
  TrackArtifactParams,
  WorkspaceRetentionPolicy,
  WorkspaceManifest,
  WorktreeDetail,
  WorkspaceWorktreeRecord,
  WorkspaceArtifactRecord,
} from '@generatorai/shared';
import type { IExecutionWorkspaceRepository } from '../domain/ports/IExecutionWorkspaceRepository.js';
import type { IWorkspaceWorktreeRepository } from '../domain/ports/IWorkspaceWorktreeRepository.js';
import type { IWorkspaceArtifactRepository } from '../domain/ports/IWorkspaceArtifactRepository.js';
import type { IWorktreeRepository } from '../domain/ports/IWorktreeRepository.js';
import { PathResolver } from './PathResolver.js';
import type { IGitClient } from '@generatorai/git';

export interface WorkspaceManagerConfig {
  workspacesDir: string;
  defaultGitEnabled: boolean;
}

/**
 * Ordered teardown phases (W25).
 *
 * `native` listeners own OS-level handles that hold the workspace tree open —
 * Chromium profiles, PTYs, a CUA driver session. They must all be released
 * before anything starts deleting files, or the delete either fails outright
 * (Windows EBUSY) or succeeds out from under a live process.
 *
 * `storage` listeners only own rows and files derived from the workspace
 * (review threads, checkpoints, staged skill bodies) and run afterwards.
 *
 * The phase is what fixes the ordering, not the registration order: teardown
 * ran in push order before, so a listener registered early (`agentStaging`,
 * which `fs.rm`s a directory) ran ahead of the browser/CUA/terminal teardown
 * registered later in the composition root.
 */
export type WorkspaceTeardownPhase = 'native' | 'storage';

/** Phase execution order. `deleteWorkspace` walks this array. */
const TEARDOWN_PHASES: readonly WorkspaceTeardownPhase[] = ['native', 'storage'];

/**
 * Thrown when a workspace directory could not be removed and its DB rows were
 * therefore deliberately kept.
 *
 * The workspace row is the ONLY record of `rootPath` — nothing scans
 * `workspacesDir` looking for strays. Deleting the row while the directory
 * survives (which is what a bare `fs.rm` + warn did) orphans that tree
 * permanently. Keeping the row leaves the workspace listable and re-deletable
 * once whatever held the handle exits, and lets the retention sweep pick it up
 * again on its next pass.
 */
export class WorkspaceTreeBusyError extends Error {
  constructor(
    public readonly workspaceId: string,
    public readonly rootPath: string,
    public readonly cause: unknown,
  ) {
    super(
      `Workspace ${workspaceId} directory could not be removed (${rootPath}): ` +
        `${cause instanceof Error ? cause.message : String(cause)}. ` +
        'Database rows were kept so the directory remains findable — retry the delete.',
    );
    this.name = 'WorkspaceTreeBusyError';
  }
}

interface BeforeDeleteListener {
  phase: WorkspaceTeardownPhase;
  cb: (workspaceId: string) => Promise<void> | void;
}

/** One worktree directory that must be unregistered from its parent clone. */
interface WorktreeTarget {
  /** Absolute path of the linked worktree. */
  worktreePath: string;
  /** Row id in the authoritative `worktrees` table, when it came from there. */
  runWorktreeId?: string;
}

/**
 * Central service for workspace lifecycle management.
 * This is the ONLY entry point for workspace creation.
 */
export class WorkspaceManager {
  private readonly pathResolver: PathResolver;
  /**
   * Listeners invoked before `deleteWorkspace` tears down a workspace, and —
   * for the `native` phase only — before `archiveWorkspace` parks one.
   * Used by TerminalService / BrowserService / ComputerService (and other
   * workspace-scoped resources) to release native handles before the row
   * disappears.
   */
  private readonly beforeDeleteListeners: BeforeDeleteListener[] = [];
  /**
   * F3-fix: Per-ownerId in-flight create promises.
   * Guards against two concurrent callers for the same owner racing through the
   * `forceCleanup → create` path and producing two workspace rows with the same
   * `ownerType+ownerId`.  A second caller with the same key awaits the first
   * call's result rather than starting a new create.
   */
  private readonly createInFlight = new Map<string, Promise<ExecutionWorkspace>>();

  constructor(
    private readonly workspaceRepo: IExecutionWorkspaceRepository,
    private readonly worktreeRepo: IWorkspaceWorktreeRepository,
    private readonly artifactRepo: IWorkspaceArtifactRepository,
    private readonly config: WorkspaceManagerConfig,
    private readonly logger: ILogger,
    /** Optional git client — when provided, commits go through it. */
    private readonly gitClient?: IGitClient,
    /**
     * The AUTHORITATIVE worktree table (`worktrees`), keyed by runId.
     *
     * P0-e: `deleteWorkspace` used to consult only `workspace_worktrees`, the
     * table `trackWorktree` writes — and `trackWorktree` has no callers, so
     * that table is always empty and the whole removal path was dead. Real
     * worktrees are written here by `WorktreeService.createWorktree` under
     * `runId = workspace.ownerId`. Optional so embedders that never create
     * worktrees can omit it.
     */
    private readonly runWorktreeRepo?: IWorktreeRepository,
  ) {
    this.pathResolver = new PathResolver();
  }

  /**
   * Register a listener that fires just before a workspace is torn down.
   * Returns an unregister function. Errors thrown by listeners are logged
   * and swallowed so a hostile listener can't block deletion.
   *
   * `phase` defaults to `'native'` — the conservative choice, since a native
   * listener only releases handles. Anything that deletes files or rows MUST
   * declare `'storage'` so it cannot run ahead of handle release.
   */
  registerBeforeDelete(
    cb: (workspaceId: string) => Promise<void> | void,
    phase: WorkspaceTeardownPhase = 'native',
  ): () => void {
    const entry: BeforeDeleteListener = { phase, cb };
    this.beforeDeleteListeners.push(entry);
    return () => {
      const idx = this.beforeDeleteListeners.indexOf(entry);
      if (idx >= 0) this.beforeDeleteListeners.splice(idx, 1);
    };
  }

  /**
   * Run every listener registered for `phase`, in registration order within
   * the phase. Listener failures are warned and swallowed — one broken
   * consumer must not wedge teardown for the rest.
   */
  private async runTeardownPhase(
    workspaceId: string,
    phase: WorkspaceTeardownPhase,
  ): Promise<void> {
    for (const listener of this.beforeDeleteListeners) {
      if (listener.phase !== phase) continue;
      try {
        await listener.cb(workspaceId);
      } catch (err) {
        this.logger.warn(
          `[WorkspaceManager] beforeDelete(${phase}) listener failed for ${workspaceId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * Create a fully-initialized workspace for any execution type.
   * Idempotent: returns existing workspace if one exists for this owner.
   */
  async createWorkspace(params: CreateWorkspaceParams): Promise<ExecutionWorkspace> {
    // F3-fix: Serialize concurrent creates for the same owner so two callers
    // racing through the `forceCleanup → create` path don't produce duplicate rows.
    const ownerKey = `${params.ownerType}:${params.ownerId}`;
    const inflight = this.createInFlight.get(ownerKey);
    if (inflight) {
      // The key is deliberately owner-only: one workspace row per owner is the
      // invariant this guard exists to protect, and widening the key would
      // simply produce two rows instead of one.
      //
      // But collapsing onto the first caller silently handed the second caller
      // a workspace rooted at a DIFFERENT tree than the one it asked for — it
      // would then run the agent against someone else's code root. Fail loudly
      // instead: a second, conflicting request for the same owner is a caller
      // bug, not something to paper over.
      const shared = await inflight;
      const requested = params.codeRootOverride?.trim() || undefined;
      if (requested && shared.codeRoot !== requested) {
        throw new Error(
          `[WorkspaceManager] Concurrent createWorkspace for ${ownerKey} requested codeRoot ` +
            `"${requested}" but an in-flight create is using "${shared.codeRoot ?? shared.rootPath}". ` +
            'One owner has exactly one workspace; resolve the code root before creating.',
        );
      }
      return shared;
    }

    const doCreate = this._doCreateWorkspace(params);
    this.createInFlight.set(ownerKey, doCreate);
    try {
      return await doCreate;
    } finally {
      this.createInFlight.delete(ownerKey);
    }
  }

  private async _doCreateWorkspace(params: CreateWorkspaceParams): Promise<ExecutionWorkspace> {
    // Check if workspace already exists for this owner (idempotent)
    const existing = await this.workspaceRepo.findByOwner(params.ownerType, params.ownerId);
    if (existing) {
      if (existing.status === 'active' || existing.status === 'completed') {
        return existing;
      }
      if (existing.status === 'creating' || existing.status === 'failed') {
        // Previous attempt failed or stuck; cleanup and recreate
        await this.forceCleanup(existing.id);
      }
      // 'archived' status: workspace was previously archived, recreate fresh
      if (existing.status === 'archived') {
        await this.forceCleanup(existing.id);
      }
    }

    const id = randomUUID();
    // The workspace root is ALWAYS managed: plans, artifacts, orchestrator state
    // and task scratch live here and must never be written into a user's repo.
    const rootPath = path.join(this.config.workspacesDir, 'executions', params.ownerId);
    const codeRoot = params.codeRootOverride?.trim() || undefined;
    const now = new Date();

    const workspace: ExecutionWorkspace = {
      id,
      ownerType: params.ownerType,
      ownerId: params.ownerId,
      projectId: params.projectId,
      rootPath,
      ...(codeRoot ? { codeRoot } : {}),
      status: 'creating',
      gitEnabled: params.gitEnabled ?? this.config.defaultGitEnabled,
      useWorktree: params.useWorktree ?? true,
      metadata: {},
      // Seed the workspace's browserConfig from the creator (chat / workflow)
      // so the built-in browser tools honour visibility, evalAllowed, and
      // allowedHosts declared at chat/workflow definition time.
      ...(params.browserConfig ? { browserConfig: params.browserConfig } : {}),
      createdAt: now,
      updatedAt: now,
    };

    // Persist workspace record (status=creating)
    await this.workspaceRepo.create(workspace);

    try {
      // Create directory structure
      await this.setupDirectories(rootPath);

      // Initialize git repository if enabled
      if (workspace.gitEnabled) {
        await this.initGitRepo(rootPath);
        // The code root needs its own repo or nothing can diff it — and repo
        // discovery would otherwise auto-init each code-bearing subdirectory
        // (src/, test/, …) as a separate repo and drop a .gitignore in each.
        // `git init` is a no-op on an existing repository.
        if (codeRoot && codeRoot !== rootPath) {
          await this.initCodeRootRepo(codeRoot);
        }
      }

      // Write workspace manifest
      await this.writeManifest(workspace, params);

      // Mark as active
      await this.workspaceRepo.updateStatus(id, 'active', { updatedAt: new Date() });
      workspace.status = 'active';

      this.logger.info(`[WorkspaceManager] Created workspace ${id} for ${params.ownerType}:${params.ownerId} at ${rootPath}`);
      return workspace;
    } catch (error) {
      await this.workspaceRepo.updateStatus(id, 'failed', { updatedAt: new Date() });
      this.logger.error(`[WorkspaceManager] Failed to create workspace ${id}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get the resolved SDK working directory for a workspace.
   * Uses rootPath directly so the SDK's tool path resolution (glob, view, grep)
   * is consistent — the Copilot SDK resolves absolute paths from cwd, and
   * using a subdirectory causes view/edit tools to fail when the model
   * constructs absolute paths from relative glob results.
   *
   * `codeRoot` wins when set: that is the tree the user asked the agent to
   * work in, and it is what diff and checkpoints track.
   */
  getWorkingDirectory(workspace: ExecutionWorkspace): string {
    return workspace.codeRoot ?? workspace.rootPath;
  }

  /**
   * Find an existing workspace by its owner ID (runId / chatId).
   * Returns null if no workspace exists for this owner.
   */
  async findWorkspaceByOwner(ownerId: string): Promise<ExecutionWorkspace | null> {
    // Try all owner types since we only have the ownerId
    for (const ownerType of ['workflow_run', 'chat', 'automation_execution'] as const) {
      const ws = await this.workspaceRepo.findByOwner(ownerType, ownerId);
      if (ws) return ws;
    }
    return null;
  }

  /**
   * Get the working directory for a workspace with worktree (source/<alias>/).
   */
  getWorktreeWorkingDirectory(workspace: ExecutionWorkspace, alias: string): string {
    return path.join(workspace.rootPath, 'source', alias);
  }

  /**
   * Register a file written by the agent/stage in the workspace.
   */
  async trackArtifact(params: TrackArtifactParams): Promise<void> {
    const artifact: WorkspaceArtifactRecord = {
      id: randomUUID(),
      workspaceId: params.workspaceId,
      stageRunId: params.stageRunId,
      artifactType: params.artifactType,
      relativePath: params.relativePath,
      fileSize: params.fileSize,
      mimeType: params.mimeType,
      metadata: params.metadata,
      createdAt: new Date(),
    };

    await this.artifactRepo.create(artifact);
  }

  /**
   * Register a worktree in the workspace.
   */
  async trackWorktree(
    workspaceId: string,
    codebaseId: string,
    alias: string,
    branchName: string,
    baseBranch: string,
    relativePath: string,
  ): Promise<WorkspaceWorktreeRecord> {
    const record: WorkspaceWorktreeRecord = {
      id: randomUUID(),
      workspaceId,
      codebaseId,
      alias,
      branchName,
      baseBranch,
      relativePath,
      status: 'active',
      hasUncommittedChanges: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.worktreeRepo.create(record);
    return record;
  }

  /**
   * Mark a workspace as completed (auto-commits if git enabled).
   */
  async completeWorkspace(workspaceId: string): Promise<void> {
    // Auto-commit before completing
    await this.commitWorkspace(workspaceId, 'Final workspace state on completion');

    await this.workspaceRepo.updateStatus(workspaceId, 'completed', {
      completedAt: new Date(),
      updatedAt: new Date(),
    });
    this.logger.info(`[WorkspaceManager] Workspace ${workspaceId} marked as completed`);
  }

  /**
   * Archive a workspace (marks as archived; physical archival is optional).
   *
   * INV-7 ("a session dies when the workspace is deleted **or archived** —
   * never orphans a Chromium process") makes native teardown part of the
   * archive contract, not just the delete contract: an archived workspace is
   * by definition no longer being worked in, so its Chromium, its PTYs and its
   * CUA session must go. Flipping the status column alone left all three
   * running against a tree nobody was looking at.
   *
   * The `storage` phase deliberately does NOT run — archiving keeps the files,
   * the review threads and the checkpoints; that is the whole difference
   * between archive and delete.
   */
  async archiveWorkspace(workspaceId: string): Promise<string | null> {
    const workspace = await this.workspaceRepo.findById(workspaceId);
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);

    await this.runTeardownPhase(workspaceId, 'native');

    await this.workspaceRepo.updateStatus(workspaceId, 'archived', {
      archivedAt: new Date(),
      updatedAt: new Date(),
    });

    this.logger.info(`[WorkspaceManager] Workspace ${workspaceId} archived`);
    return null; // Physical archival (tar.gz) deferred to Phase 6
  }

  /**
   * Delete a workspace and all its contents.
   *
   * Ordering is critical (P0-35, P0-36, W25):
   *  1. `native` teardown phase  — release OS handles: PTYs, Chromium, CUA.
   *  2. `storage` teardown phase — drop derived rows/files (review threads,
   *                                checkpoints, staged skills). Ordered by
   *                                PHASE, not by registration order.
   *  3. git worktree remove      — while the worktree dirs still exist, tell
   *                                the codebase clone about the removal so it
   *                                doesn't permanently accumulate orphaned
   *                                worktree refs.
   *  4. git worktree prune       — sweep stale metadata from the clone's git dir.
   *  5. fs.rm                    — destroy the physical tree (with retries).
   *  6. DB rows                  — ONLY if step 5 actually succeeded; the row
   *                                is the sole record of `rootPath`.
   *
   * Throws {@link WorkspaceTreeBusyError} when step 5 fails, leaving every row
   * intact so the directory stays findable and the delete can be retried.
   */
  async deleteWorkspace(workspaceId: string): Promise<void> {
    const workspace = await this.workspaceRepo.findById(workspaceId);
    if (!workspace) return;

    // Step 1 & 2: Give registered listeners a chance to release native handles
    // before anything starts deleting, then let storage consumers clean up.
    for (const phase of TEARDOWN_PHASES) {
      await this.runTeardownPhase(workspaceId, phase);
    }

    // Step 3 & 4: Remove git worktrees BEFORE touching the filesystem or DB,
    // so git can follow each worktree's `.git` file back to the parent clone
    // and unregister the entry while the directory still exists.
    const targets = await this.collectWorktreeTargets(workspace);
    for (const target of targets) {
      await this.unregisterWorktree(target.worktreePath);
    }

    // Step 5: Remove from filesystem.
    try {
      await this.rmTree(workspace.rootPath);
    } catch (err) {
      // Step 6 is deliberately skipped: see WorkspaceTreeBusyError.
      this.logger.error(
        `[WorkspaceManager] Failed to remove workspace directory ${workspace.rootPath}; ` +
          `keeping DB rows for ${workspaceId} so it is not orphaned: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      throw new WorkspaceTreeBusyError(workspaceId, workspace.rootPath, err);
    }

    // Step 6: Remove DB records — after git + filesystem cleanup succeeded.
    //
    // Worktree rows are dropped one at a time and only when their directory is
    // really gone. A worktree living OUTSIDE the workspace root (the legacy
    // project-worktrees layout) is not covered by the `rmTree` above, so if
    // `git worktree remove` failed for it the directory is still there — and
    // its row is the only thing that will ever lead anyone back to it.
    for (const target of targets) {
      if (!target.runWorktreeId) continue;
      if (await this.pathExists(target.worktreePath)) {
        this.logger.warn(
          `[WorkspaceManager] Keeping worktree row ${target.runWorktreeId}: ` +
            `${target.worktreePath} still exists after teardown`,
        );
        continue;
      }
      try {
        await this.runWorktreeRepo?.delete(target.runWorktreeId);
      } catch (err) {
        this.logger.warn(
          `[WorkspaceManager] Failed to delete worktree row ${target.runWorktreeId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    await this.artifactRepo.deleteByWorkspace(workspaceId);
    await this.worktreeRepo.deleteByWorkspace(workspaceId);
    await this.workspaceRepo.delete(workspaceId);

    this.logger.info(`[WorkspaceManager] Workspace ${workspaceId} deleted`);
  }

  /**
   * Every worktree directory that has to be unregistered before this
   * workspace's tree is destroyed, de-duplicated by resolved path.
   *
   * Two sources, deliberately both:
   *
   *  - `runWorktreeRepo` (the `worktrees` table) is the AUTHORITATIVE record.
   *    It is what `WorktreeService.createWorktree` actually writes, keyed by
   *    `runId` — which for every workspace-backed run *is* `workspace.ownerId`
   *    (chats pass `chatId`, workflow runs pass `runId`). It stores absolute
   *    paths, so it also covers legacy worktrees placed outside the workspace
   *    root in the project worktrees dir.
   *  - `worktreeRepo` (the `workspace_worktrees` tracking table) is what
   *    `trackWorktree` writes. It has no production writers today, but it is
   *    kept in the union so that any caller which does populate it still gets
   *    its worktrees cleaned up.
   *
   * P0-e: consulting only the tracking table made this whole path dead code —
   * the table was always empty while real worktrees accumulated in the parent
   * clone forever.
   */
  private async collectWorktreeTargets(
    workspace: ExecutionWorkspace,
  ): Promise<WorktreeTarget[]> {
    const byPath = new Map<string, WorktreeTarget>();

    if (this.runWorktreeRepo) {
      try {
        const rows = await this.runWorktreeRepo.getByRunId(workspace.ownerId);
        for (const row of rows) {
          const abs = row.worktreePath?.trim();
          if (!abs) continue;
          byPath.set(path.resolve(abs), {
            worktreePath: path.resolve(abs),
            runWorktreeId: row.id,
          });
        }
      } catch (err) {
        this.logger.warn(
          `[WorkspaceManager] Could not list worktrees for run ${workspace.ownerId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const tracked = await this.worktreeRepo.findByWorkspace(workspace.id);
    for (const record of tracked) {
      // `relativePath` comes from a DB column and is interpolated straight into
      // `git worktree remove --force`. Force it through the workspace boundary
      // check first: a row carrying `../../..` (or an absolute path) would
      // otherwise aim a forced removal at an arbitrary directory.
      let resolved: string;
      try {
        resolved = await this.pathResolver.resolveWithinWorkspace(
          workspace.rootPath,
          record.relativePath,
        );
      } catch (err) {
        this.logger.warn(
          `[WorkspaceManager] Skipping worktree record ${record.id}: relativePath ` +
            `"${record.relativePath}" escapes workspace ${workspace.id} ` +
            `(${err instanceof Error ? err.message : String(err)})`,
        );
        continue;
      }
      if (!byPath.has(resolved)) byPath.set(resolved, { worktreePath: resolved });
    }

    return [...byPath.values()];
  }

  /**
   * Unregister one linked worktree from its parent clone and delete its
   * directory.
   *
   * Best effort by design — a worktree whose parent clone has already been
   * deleted, or which was never a real git worktree (`local-dir` codebases are
   * plain copies), simply falls through to the caller's `fs.rm`. The caller
   * decides what to do about a directory that survives, by re-checking it once
   * the workspace tree itself has been removed.
   */
  private async unregisterWorktree(worktreePath: string): Promise<void> {
    // Read the `.git` file BEFORE removing anything: afterwards the directory
    // is gone and there is no way left to find the parent clone (F4-fix).
    const parentClonePath = await this.resolveParentClone(worktreePath);

    if (parentClonePath && this.gitClient) {
      try {
        await this.gitClient.removeWorktree(parentClonePath, worktreePath);
        // Sweeping the parent clone is what stops `git worktree list` growing
        // without bound across thousands of runs. `pruneWorktrees` existed
        // with zero callers before this (P0-e).
        await this.gitClient.pruneWorktrees(parentClonePath);
        return;
      } catch (err) {
        this.logger.warn(
          `[WorkspaceManager] git worktree remove failed for ${worktreePath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // No git client (or the client path failed): drive git directly. `-C
    // <worktreePath>` makes git start inside the linked worktree and follow
    // the .git file back to the parent clone.
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);

    try {
      await execFileAsync(
        'git',
        ['-C', worktreePath, 'worktree', 'remove', '--force', worktreePath],
        { timeout: 15_000 },
      );
      this.logger.debug?.(`[WorkspaceManager] git worktree remove: ${worktreePath}`);
    } catch (err) {
      this.logger.warn(
        `[WorkspaceManager] git worktree remove failed for ${worktreePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (parentClonePath) {
      try {
        // Must run from the parent clone — not from the now-deleted worktree
        // path (F4-fix).
        await execFileAsync('git', ['-C', parentClonePath, 'worktree', 'prune'], {
          timeout: 15_000,
        });
      } catch {
        // Best effort.
      }
    }
  }

  /**
   * Resolve the parent clone of a linked worktree from its `.git` file.
   *
   * Linked worktrees have a `.git` *file* containing
   * `gitdir: /path/to/parent/.git/worktrees/<name>`; the clone root is three
   * levels up. Returns `undefined` when the file is missing or unreadable
   * (already cleaned up, or not a linked worktree at all).
   */
  private async resolveParentClone(worktreePath: string): Promise<string | undefined> {
    try {
      const gitFileContent = await fs.readFile(path.join(worktreePath, '.git'), 'utf-8');
      const match = /gitdir:\s*(.+)/.exec(gitFileContent.trim());
      const matchedGroup = match?.[1];
      if (!matchedGroup) return undefined;
      const gitdirPath = path.resolve(worktreePath, matchedGroup.trim());
      return path.resolve(gitdirPath, '..', '..', '..');
    } catch {
      return undefined;
    }
  }

  private async pathExists(target: string): Promise<boolean> {
    try {
      await fs.stat(target);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * `fs.rm` with a short retry ladder.
   *
   * On Windows a directory is undeletable (EBUSY / EPERM / ENOTEMPTY) while
   * ANY handle into it is open, and handles close asynchronously — the
   * Chromium we just stopped, the PTY we just killed and the indexer that
   * walked the tree all release theirs some milliseconds later. A single
   * attempt therefore fails routinely on a workspace that is perfectly safe to
   * remove. Retrying converts nearly all of those into a clean removal; the
   * caller decides what to do with the ones that survive, and the answer is
   * never "delete the row anyway".
   */
  private async rmTree(target: string, attempts = 4): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        await fs.rm(target, { recursive: true, force: true });
        return;
      } catch (err) {
        lastError = err;
        if (attempt < attempts - 1) {
          await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
        }
      }
    }
    throw lastError;
  }

  /**
   * List workspaces with filtering.
   */
  async listWorkspaces(filters: WorkspaceFilters): Promise<WorkspaceInfo[]> {
    const workspaces = await this.workspaceRepo.list(filters);
    const results: WorkspaceInfo[] = [];

    for (const ws of workspaces) {
      const worktreeRecords = await this.worktreeRepo.findByWorkspace(ws.id);
      const worktreeDetails: WorktreeDetail[] = worktreeRecords.map(r => ({
        codebaseId: r.codebaseId,
        alias: r.alias,
        branchName: r.branchName,
        baseBranch: r.baseBranch,
        worktreePath: r.relativePath,
        status: r.status,
      }));

      results.push({
        id: ws.id,
        ownerType: ws.ownerType,
        ownerId: ws.ownerId,
        projectId: ws.projectId,
        rootPath: ws.rootPath,
        workingDirectory: this.getWorkingDirectory(ws),
        sourcePaths: worktreeDetails.map(w => path.join(ws.rootPath, w.worktreePath)),
        artifactsPath: path.join(ws.rootPath, 'artifacts'),
        status: ws.status,
        worktrees: worktreeDetails,
        createdAt: ws.createdAt,
      });
    }

    return results;
  }

  /**
   * Get the raw ExecutionWorkspace domain entity by id. Returns `null` if
   * no such workspace exists.
   *
   * Callers that need the enriched DTO (with worktree details, source paths,
   * etc.) should use `getWorkspaceInfo` instead. This raw accessor is used
   * by services that need direct access to persisted columns such as
   * `browserConfig` / `browserStatus` (the Integrated Browser feature).
   */
  async getExecutionWorkspace(workspaceId: string): Promise<ExecutionWorkspace | null> {
    return this.workspaceRepo.findById(workspaceId);
  }

  /**
   * Get detailed info about a workspace.
   */
  async getWorkspaceInfo(workspaceId: string): Promise<WorkspaceInfo | null> {
    const ws = await this.workspaceRepo.findById(workspaceId);
    if (!ws) return null;

    const worktreeRecords = await this.worktreeRepo.findByWorkspace(ws.id);
    const worktreeDetails: WorktreeDetail[] = worktreeRecords.map(r => ({
      codebaseId: r.codebaseId,
      alias: r.alias,
      branchName: r.branchName,
      baseBranch: r.baseBranch,
      worktreePath: r.relativePath,
      status: r.status,
    }));

    return {
      id: ws.id,
      ownerType: ws.ownerType,
      ownerId: ws.ownerId,
      projectId: ws.projectId,
      rootPath: ws.rootPath,
      workingDirectory: this.getWorkingDirectory(ws),
      sourcePaths: worktreeDetails.map(w => path.join(ws.rootPath, w.worktreePath)),
      artifactsPath: path.join(ws.rootPath, 'artifacts'),
      status: ws.status,
      worktrees: worktreeDetails,
      createdAt: ws.createdAt,
    };
  }

  /**
   * Cleanup old workspaces based on retention policy.
   */
  async cleanupExpiredWorkspaces(policy: WorkspaceRetentionPolicy): Promise<number> {
    const allWorkspaces = await this.workspaceRepo.list({ status: 'completed' });
    // `includeStaleActive`: chat-owned workspaces never reach `completed`
    // (only WorkflowRunService calls completeWorkspace), so considering just
    // that status exempts the bulk of what accumulates for ever. These are
    // judged on `updatedAt` — untouched for the retention period — because
    // they have no `completedAt` to judge them by.
    if (policy.includeStaleActive) {
      allWorkspaces.push(...(await this.workspaceRepo.list({ status: 'active' })));
    }
    const cutoff = Date.now() - (policy.completedRetentionHours * 60 * 60 * 1000);
    let deleted = 0;

    for (const ws of allWorkspaces) {
      const expiredAt = ws.completedAt ?? (policy.includeStaleActive ? ws.updatedAt : undefined);
      if (expiredAt && expiredAt.getTime() < cutoff) {
        if (policy.protectUnpushed) {
          const worktrees = await this.worktreeRepo.findByWorkspace(ws.id);
          const hasUnpushed = worktrees.some(w => w.status === 'active' && w.hasUncommittedChanges);
          if (hasUnpushed) {
            if (policy.archiveIfDirty) {
              await this.archiveWorkspace(ws.id);
            }
            continue;
          }
        }
        try {
          await this.deleteWorkspace(ws.id);
          deleted++;
        } catch (err) {
          // A workspace whose tree is still held open (WorkspaceTreeBusyError)
          // keeps its rows, so it stays `completed` and past the cutoff — the
          // next sweep retries it. Never let one stuck workspace abort the
          // whole retention pass.
          this.logger.warn(
            `[WorkspaceManager] Retention delete failed for ${ws.id}, will retry next sweep: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    if (deleted > 0) {
      this.logger.info(`[WorkspaceManager] Cleaned up ${deleted} expired workspaces`);
    }
    return deleted;
  }

  /**
   * Resolve a path within a workspace boundary (security enforcement).
   */
  async resolvePathInWorkspace(workspaceId: string, relativePath: string): Promise<string> {
    const ws = await this.workspaceRepo.findById(workspaceId);
    if (!ws) throw new Error(`Workspace not found: ${workspaceId}`);
    return this.pathResolver.resolveWithinWorkspace(ws.rootPath, relativePath);
  }

  /**
   * Commit all changes in a workspace (for snapshot/audit).
   */
  async commitWorkspace(workspaceId: string, message?: string): Promise<boolean> {
    const ws = await this.workspaceRepo.findById(workspaceId);
    if (!ws || !ws.gitEnabled) return false;

    const commitMsg = message ?? `Workspace snapshot at ${new Date().toISOString()}`;

    // Prefer the centralized git client when available.
    if (this.gitClient) {
      try {
        return await this.gitClient.commit(ws.rootPath, commitMsg);
      } catch (err) {
        this.logger.warn(
          `[WorkspaceManager] Git commit failed for workspace ${workspaceId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return false;
      }
    }

    // Legacy fallback (no git client injected).
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(execFile);
      const opts = { cwd: ws.rootPath, timeout: 30_000 };

      await execFileAsync('git', ['add', '-A'], opts);
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], opts);
      if (!stdout.trim()) return false; // Nothing to commit

      await execFileAsync('git', ['commit', '-m', commitMsg, '--allow-empty-message'], opts);
      return true;
    } catch (err) {
      this.logger.warn(`[WorkspaceManager] Git commit failed for workspace ${workspaceId}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /**
   * Force-cleanup a workspace (for failed/orphaned state). Idempotent.
   *
   * Unlike the old best-effort version this refuses to drop the rows when the
   * directory survives. `rootPath` is derived from `ownerId`, so a recreate for
   * the same owner lands on the SAME directory: forgetting a tree we could not
   * delete would silently graft the previous attempt's files into the new
   * workspace, on top of orphaning them.
   */
  private async forceCleanup(workspaceId: string): Promise<void> {
    const ws = await this.workspaceRepo.findById(workspaceId);
    if (!ws) return;

    try {
      await this.rmTree(ws.rootPath);
    } catch (err) {
      this.logger.error(
        `[WorkspaceManager] forceCleanup could not remove ${ws.rootPath}; keeping rows for ${workspaceId}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      throw new WorkspaceTreeBusyError(workspaceId, ws.rootPath, err);
    }

    try {
      await this.artifactRepo.deleteByWorkspace(workspaceId);
    } catch {
      // Best effort — may not exist
    }
    try {
      await this.worktreeRepo.deleteByWorkspace(workspaceId);
    } catch {
      // Best effort — may not exist
    }
    try {
      await this.workspaceRepo.delete(workspaceId);
    } catch {
      // Best effort — may already be deleted
    }
  }

  /**
   * Create workspace directory structure.
   */
  private async setupDirectories(rootPath: string): Promise<void> {
    const dirs = [
      rootPath,
      path.join(rootPath, 'source'),
      path.join(rootPath, 'output'),
      path.join(rootPath, 'artifacts'),
      path.join(rootPath, 'artifacts', 'stage-responses'),
      path.join(rootPath, 'artifacts', 'attachments'),
      path.join(rootPath, 'scripts'),
      path.join(rootPath, 'config'),
      path.join(rootPath, 'config', 'agents'),
      path.join(rootPath, 'config', 'prompts'),
      path.join(rootPath, 'config', 'skills'),
      path.join(rootPath, 'config', 'mcp'),
    ];

    // P2-46: Create all directories in parallel — they are independent and
    // the sequential loop was blocking 11 mkdir calls serially on the HTTP path.
    await Promise.all(dirs.map((dir) => fs.mkdir(dir, { recursive: true })));
  }

  /**
   * Write workspace manifest (.workspace.json).
   */
  private async writeManifest(workspace: ExecutionWorkspace, params: CreateWorkspaceParams): Promise<void> {
    const manifest: WorkspaceManifest = {
      version: 1,
      id: workspace.id,
      ownerType: workspace.ownerType,
      ownerId: workspace.ownerId,
      projectId: workspace.projectId,
      createdAt: workspace.createdAt.toISOString(),
      config: {
        useWorktree: workspace.useWorktree,
        gitEnabled: workspace.gitEnabled,
        sdkWorkingDirectory: '.',
      },
      worktrees: [],
      scripts: params.scriptPaths,
    };

    await fs.writeFile(
      path.join(workspace.rootPath, '.workspace.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8',
    );
  }

  /**
   * Ensure the agent's code root is a repository, without touching its contents.
   *
   * Unlike `initGitRepo` this writes no `.gitignore`: the code root is the
   * user's own folder and may already have one.
   */
  private async initCodeRootRepo(codeRoot: string): Promise<void> {
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(execFile);
      const opts = { cwd: codeRoot, timeout: 15_000 };
      await execFileAsync('git', ['init'], opts);
      await execFileAsync('git', ['config', 'user.email', 'generatorai@local'], opts);
      await execFileAsync('git', ['config', 'user.name', 'GeneratorAI'], opts);

      // A repo with no commits has no baseline, so every diff comes back empty.
      // Only seed one when the history is genuinely empty — never rewrite a
      // user's existing repository.
      try {
        await execFileAsync('git', ['rev-parse', '--verify', 'HEAD'], opts);
      } catch {
        await execFileAsync('git', ['add', '-A'], opts);
        await execFileAsync(
          'git',
          ['commit', '-m', 'GeneratorAI baseline', '--allow-empty', '--allow-empty-message'],
          opts,
        );
      }
    } catch (err) {
      this.logger.warn(
        `[WorkspaceManager] Could not initialise git in code root ${codeRoot}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Initialize a git repository in the workspace directory.
   */
  private async initGitRepo(rootPath: string): Promise<void> {
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(execFile);
      const opts = { cwd: rootPath, timeout: 15_000 };

      await execFileAsync('git', ['init'], opts);
      await execFileAsync('git', ['config', 'user.email', 'generatorai@local'], opts);
      await execFileAsync('git', ['config', 'user.name', 'GeneratorAI'], opts);

      // Create .gitignore that excludes workflow-runtime metadata so the
      // diff view only shows real source-code changes, not the agent's
      // response artifacts / scratch state.
      const gitignore = [
        '# GeneratorAI workspace',
        '# Workflow runtime metadata (agent responses, scratch state, etc.)',
        'artifacts/',
        'uploads/',
        '.workspace.json',
        'scratchpad.json',
        'stream-log.jsonl',
        '',
        '# Integrated browser: persistent Chromium profile (cache, cookies,',
        '# service-worker state). Hundreds of binary files that churn on every',
        '# page load and drowned the Changes tab in "binary A" rows.',
        'browser/',
        '',
        '# Standard vendored / build output',
        'node_modules/',
        'dist/',
        'build/',
        'coverage/',
        '.next/',
        '.turbo/',
        '.cache/',
        '',
        '# Env / logs / OS junk',
        '.env',
        '.env.local',
        '.env.*.local',
        '*.log',
        '*.tmp',
        '# SQLite WAL sidecars',
        '*.db-shm',
        '*.db-wal',
        '*.db-journal',
        '.DS_Store',
        'Thumbs.db',
        '',
      ].join('\n');
      await fs.writeFile(path.join(rootPath, '.gitignore'), gitignore, 'utf-8');

      // Initial commit
      await execFileAsync('git', ['add', '-A'], opts);
      await execFileAsync('git', ['commit', '-m', 'Initial workspace setup', '--allow-empty-message'], opts);
    } catch (err) {
      // Non-fatal — workspace still works without git
      this.logger.warn(`[WorkspaceManager] Git init failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
