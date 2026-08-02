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
import { PathResolver } from './PathResolver.js';
import type { IGitClient } from '@generatorai/git';

export interface WorkspaceManagerConfig {
  workspacesDir: string;
  defaultGitEnabled: boolean;
}

/**
 * Central service for workspace lifecycle management.
 * This is the ONLY entry point for workspace creation.
 */
export class WorkspaceManager {
  private readonly pathResolver: PathResolver;
  /**
   * Listeners invoked before `deleteWorkspace` tears down a workspace.
   * Used by TerminalService (and potentially other future workspace-scoped
   * resources) to release native handles before the row disappears.
   */
  private readonly beforeDeleteListeners: Array<(workspaceId: string) => Promise<void> | void> = [];

  constructor(
    private readonly workspaceRepo: IExecutionWorkspaceRepository,
    private readonly worktreeRepo: IWorkspaceWorktreeRepository,
    private readonly artifactRepo: IWorkspaceArtifactRepository,
    private readonly config: WorkspaceManagerConfig,
    private readonly logger: ILogger,
    /** Optional git client — when provided, commits go through it. */
    private readonly gitClient?: IGitClient,
  ) {
    this.pathResolver = new PathResolver();
  }

  /**
   * Register a listener that fires just before a workspace is deleted.
   * Returns an unregister function. Errors thrown by listeners are logged
   * and swallowed so a hostile listener can't block deletion.
   */
  registerBeforeDelete(cb: (workspaceId: string) => Promise<void> | void): () => void {
    this.beforeDeleteListeners.push(cb);
    return () => {
      const idx = this.beforeDeleteListeners.indexOf(cb);
      if (idx >= 0) this.beforeDeleteListeners.splice(idx, 1);
    };
  }

  /**
   * Create a fully-initialized workspace for any execution type.
   * Idempotent: returns existing workspace if one exists for this owner.
   */
  async createWorkspace(params: CreateWorkspaceParams): Promise<ExecutionWorkspace> {
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
    const rootPath = path.join(this.config.workspacesDir, 'executions', params.ownerId);
    const now = new Date();

    const workspace: ExecutionWorkspace = {
      id,
      ownerType: params.ownerType,
      ownerId: params.ownerId,
      projectId: params.projectId,
      rootPath,
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
   */
  getWorkingDirectory(workspace: ExecutionWorkspace): string {
    return workspace.rootPath;
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
   */
  async archiveWorkspace(workspaceId: string): Promise<string | null> {
    const workspace = await this.workspaceRepo.findById(workspaceId);
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);

    await this.workspaceRepo.updateStatus(workspaceId, 'archived', {
      archivedAt: new Date(),
      updatedAt: new Date(),
    });

    this.logger.info(`[WorkspaceManager] Workspace ${workspaceId} archived`);
    return null; // Physical archival (tar.gz) deferred to Phase 6
  }

  /**
   * Delete a workspace and all its contents.
   */
  async deleteWorkspace(workspaceId: string): Promise<void> {
    const workspace = await this.workspaceRepo.findById(workspaceId);
    if (!workspace) return;

    // Give registered listeners (e.g. TerminalService) a chance to release
    // native handles before we blow the row away.
    for (const cb of this.beforeDeleteListeners) {
      try {
        await cb(workspaceId);
      } catch (err) {
        this.logger.warn(
          `[WorkspaceManager] beforeDelete listener failed for ${workspaceId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Remove from filesystem
    try {
      await fs.rm(workspace.rootPath, { recursive: true, force: true });
    } catch (err) {
      this.logger.warn(`[WorkspaceManager] Failed to remove workspace directory: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Remove DB records
    await this.artifactRepo.deleteByWorkspace(workspaceId);
    await this.worktreeRepo.deleteByWorkspace(workspaceId);
    await this.workspaceRepo.delete(workspaceId);

    this.logger.info(`[WorkspaceManager] Workspace ${workspaceId} deleted`);
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
    const cutoff = Date.now() - (policy.completedRetentionHours * 60 * 60 * 1000);
    let deleted = 0;

    for (const ws of allWorkspaces) {
      if (ws.completedAt && ws.completedAt.getTime() < cutoff) {
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
        await this.deleteWorkspace(ws.id);
        deleted++;
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
   */
  private async forceCleanup(workspaceId: string): Promise<void> {
    const ws = await this.workspaceRepo.findById(workspaceId);
    if (!ws) return;

    try {
      await fs.rm(ws.rootPath, { recursive: true, force: true });
    } catch {
      // Best effort
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

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
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
        'stream-log.jsonl',
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
