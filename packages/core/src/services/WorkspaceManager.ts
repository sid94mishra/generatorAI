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
  WorkspaceArtifactRecord,
  WorkspaceMount,
  WorkspaceExposure,
} from '@generatorai/shared';
import type { IExecutionWorkspaceRepository } from '../domain/ports/IExecutionWorkspaceRepository.js';
import type { IWorkspaceMountRepository } from '../domain/ports/IWorkspaceMountRepository.js';
import type { IWorkspaceArtifactRepository } from '../domain/ports/IWorkspaceArtifactRepository.js';
import type { IWorktreeRepository } from '../domain/ports/IWorktreeRepository.js';
import { PathResolver } from './PathResolver.js';
import type { IGitClient } from '@generatorai/git';
import { shadowGitDirFor, type MountRef } from '@generatorai/changes';
import { buildExposure, SCRATCH_DIR } from './MountService.js';

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
    private readonly mountRepo: IWorkspaceMountRepository,
    private readonly artifactRepo: IWorkspaceArtifactRepository,
    private readonly config: WorkspaceManagerConfig,
    private readonly logger: ILogger,
    /** Optional git client — when provided, commits go through it. */
    private readonly gitClient?: IGitClient,
    /**
     * The legacy `worktrees` table, keyed by runId. Still written by
     * `WorktreeService` for workflow runs, and read here to (a) back-fill
     * mounts for workspaces created before mounts existed and (b) unregister
     * those worktrees on delete. Optional for embedders without worktrees.
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
    const rootPath = this.rootPathFor(params.ownerId);
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
      // Mount-backed workspaces start `pending` and the mount service flips
      // them to `ready`; everything else is ready the moment it exists.
      prepStatus: params.sources ? 'pending' : 'ready',
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

      // Initialize git repository if enabled (workflow runs commit the root
      // on completion). Chats pass `gitEnabled: false`: their code lives in
      // mounts and the managed root is scratch. A linked user folder is
      // NEVER initialised, configured or committed — its change tracking
      // runs through a private shadow store.
      if (workspace.gitEnabled) {
        await this.initGitRepo(rootPath);
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

  /** Where a workspace for `ownerId` lives (or would live). Deterministic. */
  rootPathFor(ownerId: string): string {
    return path.join(this.config.workspacesDir, 'executions', ownerId);
  }

  /** Managed scratch directory the agent is told to use for non-deliverables. */
  getScratchDir(workspace: ExecutionWorkspace): string {
    return path.join(workspace.rootPath, SCRATCH_DIR);
  }

  /**
   * The workspace's mounts, in position order.
   *
   * Workspaces created before mounts existed get their rows synthesised on
   * first read from what they had: a bound local folder becomes an in-place
   * mount, legacy worktree rows become worktree mounts, and a workspace with
   * neither becomes one `generated` mount at its root. Those back-filled
   * mounts keep using their own `.git` (`git.shadow === false`) so the
   * checkpoints they already have stay valid.
   */
  async listMounts(workspace: ExecutionWorkspace): Promise<WorkspaceMount[]> {
    const rows = await this.mountRepo.findByWorkspace(workspace.id);
    if (rows.length > 0 || workspace.prepStatus === 'pending' || workspace.prepStatus === 'preparing') {
      return rows;
    }
    const backfilled = await this.backfillMounts(workspace);
    for (const m of backfilled) {
      try {
        await this.mountRepo.create(m);
      } catch (err) {
        this.logger.warn(`[WorkspaceManager] Could not persist back-filled mount ${m.alias}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return backfilled;
  }

  private async backfillMounts(workspace: ExecutionWorkspace): Promise<WorkspaceMount[]> {
    const now = new Date();
    const out: WorkspaceMount[] = [];
    const base = {
      workspaceId: workspace.id,
      status: 'ready' as const,
      hasUncommittedChanges: false,
      createdAt: now,
      updatedAt: now,
    };

    if (this.runWorktreeRepo) {
      try {
        const rows = await this.runWorktreeRepo.getByRunId(workspace.ownerId);
        for (const row of rows) {
          const abs = row.worktreePath?.trim();
          if (!abs) continue;
          if (row.status === 'orphaned' || row.status === 'cleanup-pending') continue;
          if (!(await this.pathExists(abs))) continue;
          const resolved = path.resolve(abs);
          out.push({
            ...base,
            id: randomUUID(),
            position: out.length,
            alias: path.basename(resolved),
            originKind: 'codebase',
            codebaseId: row.codebaseId,
            projectId: row.projectId,
            mode: 'worktree',
            path: resolved,
            git: { isRepo: true, branch: row.branchName, shadow: false },
          });
        }
      } catch (err) {
        this.logger.warn(`[WorkspaceManager] Could not list legacy worktrees for ${workspace.ownerId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (workspace.codeRoot && workspace.codeRoot !== workspace.rootPath) {
      const isRepo = await this.pathExists(path.join(workspace.codeRoot, '.git'));
      out.push({
        ...base,
        id: randomUUID(),
        position: out.length,
        alias: '.',
        originKind: 'folder',
        originPath: workspace.codeRoot,
        mode: 'in-place',
        path: workspace.codeRoot,
        git: { isRepo, shadow: false },
      });
    } else if (out.length === 0) {
      out.push({
        ...base,
        id: randomUUID(),
        position: 0,
        alias: '.',
        originKind: 'generated',
        mode: 'generated',
        path: workspace.rootPath,
        git: { isRepo: await this.pathExists(path.join(workspace.rootPath, '.git')), shadow: false },
      });
    }
    return out;
  }

  /** Mounts as the change/checkpoint engines see them (with shadow dirs). */
  async toMountRefs(workspace: ExecutionWorkspace): Promise<MountRef[]> {
    const mounts = await this.listMounts(workspace);
    return mounts
      .filter((m) => m.status === 'ready' || m.status === 'preparing')
      .map((m) => {
        const shadow = m.git?.shadow !== false;
        return {
          alias: m.alias,
          path: m.path,
          ...(shadow ? { gitDir: shadowGitDirFor(workspace.rootPath, m.alias) } : {}),
          ...(m.git?.baseCommit ? { baseCommit: m.git.baseCommit } : {}),
          ...(m.git?.nested?.length
            ? {
                nested: m.git.nested.map((name) => ({
                  name,
                  gitDir: shadowGitDirFor(workspace.rootPath, `${m.alias}/${name}`),
                })),
              }
            : {}),
        };
      });
  }

  /** Everything a harness needs: cwd, extra directories, env and the hint block. */
  async getExposure(workspace: ExecutionWorkspace): Promise<WorkspaceExposure> {
    return buildExposure(workspace, await this.listMounts(workspace));
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
    await this.mountRepo.deleteByWorkspace(workspaceId);
    await this.workspaceRepo.delete(workspaceId);

    this.logger.info(`[WorkspaceManager] Workspace ${workspaceId} deleted`);
  }

  /**
   * Every worktree directory that has to be unregistered before this
   * workspace's tree is destroyed, de-duplicated by resolved path.
   *
   * Two sources, deliberately both:
   *
   *  - `runWorktreeRepo` (the legacy `worktrees` table) — what
   *    `WorktreeService.createWorktree` writes for workflow runs and for chats
   *    created before mounts existed, keyed by `runId = workspace.ownerId`.
   *    Absolute paths, so it also covers worktrees placed outside the
   *    workspace root in the old project worktrees dir.
   *  - `mountRepo` — worktree mounts (`mode === 'worktree'`). In-place mounts
   *    are the user's own directories and are never candidates for removal.
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

    // Worktree mounts live under the workspace root; in-place mounts are the
    // user's own directories and are never candidates for removal.
    for (const mount of await this.mountRepo.findByWorkspace(workspace.id, { includeRemoved: true })) {
      if (mount.mode !== 'worktree' || mount.status === 'removed') continue;
      const resolved = path.resolve(mount.path);
      const root = path.resolve(workspace.rootPath);
      if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        this.logger.warn(`[WorkspaceManager] Skipping worktree mount ${mount.id}: ${mount.path} is outside workspace ${workspace.id}`);
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
      results.push(await this.toInfo(ws));
    }

    return results;
  }

  /** `WorktreeDetail`s derived from worktree mounts (kept for older API clients). */
  private worktreeDetailsFromMounts(ws: ExecutionWorkspace, mounts: WorkspaceMount[]): WorktreeDetail[] {
    return mounts
      .filter((m) => m.mode === 'worktree' && m.status !== 'removed')
      .map((m) => ({
        codebaseId: m.codebaseId ?? '',
        alias: m.alias,
        branchName: m.git?.branch ?? '',
        baseBranch: m.git?.baseRef ?? '',
        worktreePath: relativizeToRoot(ws.rootPath, path.resolve(m.path)),
        status: m.status === 'error' ? 'error' : 'active',
      }));
  }

  private async toInfo(ws: ExecutionWorkspace): Promise<WorkspaceInfo> {
    const mounts = await this.listMounts(ws);
    const exposure = buildExposure(ws, mounts);
    return {
      id: ws.id,
      ownerType: ws.ownerType,
      ownerId: ws.ownerId,
      projectId: ws.projectId,
      rootPath: ws.rootPath,
      workingDirectory: exposure.workingDirectory,
      sourcePaths: exposure.mounts.map((m) => m.path),
      artifactsPath: path.join(ws.rootPath, 'artifacts'),
      status: ws.status,
      prepStatus: ws.prepStatus ?? 'ready',
      ...(ws.prepError ? { prepError: ws.prepError } : {}),
      mounts: exposure.mounts,
      scratchPath: exposure.scratchDir,
      worktrees: this.worktreeDetailsFromMounts(ws, mounts),
      createdAt: ws.createdAt,
    };
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
    return this.toInfo(ws);
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
          const mounts = await this.mountRepo.findByWorkspace(ws.id);
          const hasUnpushed = mounts.some((m) => m.status === 'ready' && m.hasUncommittedChanges);
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
      await this.mountRepo.deleteByWorkspace(workspaceId);
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
      path.join(rootPath, SCRATCH_DIR),
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
        '',
        '# Integrated browser: persistent Chromium profile (cache, cookies,',
        '# service-worker state). Hundreds of binary files that churn on every',
        '# page load and drowned the Changes tab in "binary A" rows.',
        'browser/',
        '',
        '# Orchestrator runtime state (task ledger, wave bookkeeping). Not a',
        '# code change: it churns on every worker event and is regenerated.',
        'orchestrator/',
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

/**
 * Resolve a `WorktreeDetail.worktreePath` against a workspace root.
 *
 * The field is normally relative to `rootPath`, but legacy worktrees living
 * outside the workspace (the old project-worktrees layout) can only be
 * expressed absolutely. A bare `path.join` would produce
 * `<root>\C:\Users\...` for those, so every consumer must go through this.
 */
export function resolveWorktreePath(rootPath: string, worktreePath: string): string {
  return path.isAbsolute(worktreePath) ? worktreePath : path.join(rootPath, worktreePath);
}

/**
 * `abs` expressed relative to `rootPath` when it lives inside it, otherwise
 * `abs` unchanged. Keeps the common (in-workspace) case matching what
 * `WorktreeDetail.worktreePath` documents, while still surfacing worktrees
 * that predate the in-workspace layout.
 */
function relativizeToRoot(rootPath: string, abs: string): string {
  const root = path.resolve(rootPath);
  if (abs === root) return '.';
  if (!abs.startsWith(root + path.sep)) return abs;
  return abs.slice(root.length + 1);
}
