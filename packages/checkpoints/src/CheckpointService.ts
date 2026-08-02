// ────────────────────────────────────────────────────────────────
// CheckpointService — create / list / diff / restore / prune
// ────────────────────────────────────────────────────────────────

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type {
  CheckpointDiffFile,
  CheckpointFilters,
  CheckpointRecord,
  CheckpointRetentionPolicy,
  CreateCheckpointParams,
  ILogger,
  RestoreCheckpointResult,
} from '@generatorai/shared';
import { DEFAULT_CHECKPOINT_RETENTION } from '@generatorai/shared';
import type { IGitClient } from '@generatorai/git';
import { GitShadowRefStore, checkpointRefName } from './GitShadowRefStore.js';
import type { ICheckpointRepository } from './ports/ICheckpointRepository.js';

export interface CheckpointServiceOptions {
  retention?: Partial<CheckpointRetentionPolicy>;
}

export class CheckpointService {
  private readonly retention: CheckpointRetentionPolicy;
  /**
   * Single-flight lock per (workspaceId, repoAlias). Two concurrent captures
   * would share the same throwaway index file and could observe a torn tree.
   */
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly store: GitShadowRefStore,
    private readonly repository: ICheckpointRepository,
    private readonly git: IGitClient,
    private readonly logger: ILogger,
    options: CheckpointServiceOptions = {},
  ) {
    this.retention = { ...DEFAULT_CHECKPOINT_RETENTION, ...options.retention };
  }

  // ── Create ──────────────────────────────────────────────────

  /**
   * Capture a checkpoint for one repository. Returns `null` when nothing
   * changed since the previous checkpoint (and `skipIfUnchanged` is on) or
   * when the directory could not be snapshotted.
   */
  async create(params: CreateCheckpointParams): Promise<CheckpointRecord | null> {
    const repoAlias = params.repoAlias ?? '.';
    const key = `${params.workspaceId}::${repoAlias}`;
    return this.withLock(key, () => this.createUnlocked(params, repoAlias));
  }

  private async createUnlocked(
    params: CreateCheckpointParams,
    repoAlias: string,
  ): Promise<CheckpointRecord | null> {
    const { workspaceId, repoDir, kind, label, skipIfUnchanged = true } = params;

    try {
      const ready = await this.store.prepare(repoDir);
      if (!ready) {
        this.logger.warn(`[Checkpoints] Cannot snapshot non-git dir ${repoDir}`);
        return null;
      }

      const previous = await this.repository.findLatest(workspaceId, repoAlias);
      const seq = (await this.repository.maxSeq(workspaceId, repoAlias)) + 1;
      const refName = checkpointRefName(workspaceId, repoAlias, seq);
      const message = `generatorai:${kind}${label ? ` ${label}` : ''}`;

      const handle = await this.store.capture(
        repoDir,
        refName,
        message,
        previous?.refValue,
        skipIfUnchanged ? previous?.treeSha : undefined,
      );
      if (!handle) return null;

      // Stats vs. the previous checkpoint (or the empty tree for the first).
      const stats = previous
        ? await this.aggregateStats(repoDir, previous.treeSha, handle.treeSha)
        : await this.aggregateStats(repoDir, EMPTY_TREE_SHA, handle.treeSha);

      const record: CheckpointRecord = {
        id: `ckpt_${randomUUID()}`,
        workspaceId,
        repoAlias,
        seq,
        kind,
        ...(label ? { label } : {}),
        refKind: 'git_tree',
        refValue: handle.refValue,
        treeSha: handle.treeSha,
        ...(previous ? { parentId: previous.id } : {}),
        ...(params.sessionId ? { sessionId: params.sessionId } : {}),
        ...(params.chatId ? { chatId: params.chatId } : {}),
        ...(params.turnId ? { turnId: params.turnId } : {}),
        ...(params.workflowRunId ? { workflowRunId: params.workflowRunId } : {}),
        ...(params.stageRunId ? { stageRunId: params.stageRunId } : {}),
        ...(params.automationExecutionRunId
          ? { automationExecutionRunId: params.automationExecutionRunId }
          : {}),
        ...(params.phase ? { phase: params.phase } : {}),
        ...(params.promptExcerpt
          ? { promptExcerpt: params.promptExcerpt.slice(0, 200) }
          : {}),
        fileCount: stats.fileCount,
        additions: stats.additions,
        deletions: stats.deletions,
        createdAt: new Date(),
      };

      await this.repository.create(record);
      this.logger.info(
        `[Checkpoints] ${kind} checkpoint ${record.id} (${repoAlias}) ` +
          `${stats.fileCount} files +${stats.additions}/-${stats.deletions}`,
      );
      return record;
    } catch (err) {
      // Checkpointing must never break the agent loop.
      this.logger.warn(`[Checkpoints] create failed for ${repoDir}: ${err}`);
      return null;
    }
  }

  // ── Read ────────────────────────────────────────────────────

  async list(filters: CheckpointFilters): Promise<CheckpointRecord[]> {
    return this.repository.list(filters);
  }

  async getById(id: string): Promise<CheckpointRecord | null> {
    return this.repository.findById(id);
  }

  async getLatest(workspaceId: string, repoAlias = '.'): Promise<CheckpointRecord | null> {
    return this.repository.findLatest(workspaceId, repoAlias);
  }

  /** Baseline (first) checkpoint for a repo — the "since the start" anchor. */
  async getBaseline(workspaceId: string, repoAlias = '.'): Promise<CheckpointRecord | null> {
    const rows = await this.repository.list({
      workspaceId,
      repoAlias,
      kinds: ['baseline'],
      limit: 1,
      excludeLive: true,
    });
    return rows[0] ?? null;
  }

  /**
   * Per-file deltas between two points. `toTreeSha` omitted ⇒ diff against
   * the live working tree.
   */
  async diffTrees(
    repoDir: string,
    fromTreeSha: string,
    toTreeSha?: string,
    pathspec?: string[],
  ): Promise<CheckpointDiffFile[]> {
    return this.store.diff(repoDir, fromTreeSha, toTreeSha, pathspec);
  }

  async patchForFile(
    repoDir: string,
    fromTreeSha: string,
    toTreeSha: string | undefined,
    filePath: string,
    contextLines = 3,
  ): Promise<string> {
    return this.store.patch(repoDir, fromTreeSha, toTreeSha, filePath, contextLines);
  }

  /** Read one file's content at a checkpoint. Returns null when absent. */
  async readFileAt(
    repoDir: string,
    treeSha: string,
    filePath: string,
    maxBytes = 1_048_576,
  ): Promise<string | null> {
    try {
      const blob = await this.git.blobShaAt(repoDir, treeSha, filePath);
      if (!blob) return null;
      const size = await this.git.blobSize(repoDir, blob);
      if (size !== null && size > maxBytes) return null;
      return await this.git.showFile(repoDir, filePath, treeSha);
    } catch {
      return null;
    }
  }

  // ── Restore ─────────────────────────────────────────────────

  /**
   * Make the working tree match `checkpoint`. Always writes a `pre_restore`
   * checkpoint first so the operation is undoable.
   *
   * Symlinks and hard links are intentionally skipped (writing through them
   * would corrupt targets outside the workspace).
   */
  async restore(
    checkpoint: CheckpointRecord,
    repoDir: string,
    paths?: string[],
  ): Promise<RestoreCheckpointResult> {
    const key = `${checkpoint.workspaceId}::${checkpoint.repoAlias}`;
    return this.withLock(key, async () => {
      const skipped: RestoreCheckpointResult['skipped'] = [];

      // Undoing an undo must not nest the label ("Before rewind to Before
      // rewind to …"). A pre_restore target is identified by its timestamp
      // instead, which is what distinguishes it anyway.
      const targetName =
        checkpoint.kind === 'pre_restore' || !checkpoint.label
          ? new Date(checkpoint.createdAt).toLocaleTimeString()
          : checkpoint.label;

      const pre = await this.createUnlocked(
        {
          workspaceId: checkpoint.workspaceId,
          repoDir,
          repoAlias: checkpoint.repoAlias,
          kind: 'pre_restore',
          label: `Before rewind to ${targetName}`,
          skipIfUnchanged: false,
        },
        checkpoint.repoAlias,
      );

      // Working tree → target. `A` means present in target but missing now.
      const delta = await this.git.diffNameStatusZ(
        repoDir,
        checkpoint.treeSha,
        // Diff tree-to-tree using the pre-restore snapshot as "current".
        // `git diff <tree>` alone would compare against the index+worktree
        // and silently omit untracked files, so agent-created files would
        // never be deleted on rewind.
        pre?.treeSha,
        paths,
      );

      // Codes are relative to `checkpoint.treeSha` → `pre.treeSha`:
      //   A = exists now but not in the checkpoint  → delete
      //   D / M = exists in the checkpoint          → restore
      //   R = renamed since the checkpoint          → delete new, restore old
      const toDelete: string[] = [];
      const toRestore: string[] = [];
      for (const entry of delta) {
        if (entry.code.startsWith('A')) {
          toDelete.push(entry.path);
        } else if (entry.code.startsWith('R') || entry.code.startsWith('C')) {
          toDelete.push(entry.path);
          if (entry.oldPath) toRestore.push(entry.oldPath);
        } else {
          toRestore.push(entry.path);
        }
      }

      const safeDelete: string[] = [];
      for (const rel of toDelete) {
        const full = path.join(repoDir, rel);
        const verdict = await classifyPath(full);
        if (verdict) {
          skipped.push({ path: rel, reason: verdict });
          continue;
        }
        safeDelete.push(rel);
      }

      const safeRestore: string[] = [];
      for (const rel of toRestore) {
        const full = path.join(repoDir, rel);
        const verdict = await classifyPath(full);
        if (verdict) {
          skipped.push({ path: rel, reason: verdict });
          continue;
        }
        safeRestore.push(rel);
      }

      const indexFile = await this.store.restoreIndexPath(repoDir);
      if (indexFile && safeRestore.length > 0) {
        await this.git.restorePathsFromTree(
          repoDir,
          checkpoint.treeSha,
          indexFile,
          safeRestore,
        );
      }

      for (const rel of safeDelete) {
        try {
          await fs.rm(path.join(repoDir, rel), { force: true });
        } catch (err) {
          skipped.push({ path: rel, reason: `delete failed: ${String(err)}` });
        }
      }

      this.logger.info(
        `[Checkpoints] Restored ${checkpoint.id}: ${safeRestore.length} restored, ` +
          `${safeDelete.length} deleted, ${skipped.length} skipped`,
      );

      return {
        preRestoreCheckpointId: pre?.id ?? null,
        restoredPaths: safeRestore,
        deletedPaths: safeDelete,
        skipped,
      };
    });
  }

  // ── Prune ───────────────────────────────────────────────────

  /**
   * Drop checkpoints past the retention policy. Baselines are never pruned —
   * they are the anchor for "everything this session changed".
   */
  async prune(workspaceId: string, repoDir: string, repoAlias = '.'): Promise<number> {
    const all = await this.repository.list({
      workspaceId,
      repoAlias,
      excludeLive: false,
      limit: 10_000,
    });

    const now = Date.now();
    const maxAgeMs = this.retention.maxAgeDays * 86_400_000;
    const liveMaxAgeMs = this.retention.liveMaxAgeMinutes * 60_000;

    const prunable = all.filter((c) => c.kind !== 'baseline');
    const doomed = new Set<string>();

    for (const c of prunable) {
      const age = now - c.createdAt.getTime();
      if (c.kind === 'live' && age > liveMaxAgeMs) doomed.add(c.id);
      else if (age > maxAgeMs) doomed.add(c.id);
    }

    // Keep only the newest `maxPerRepo` durable checkpoints.
    const durable = prunable
      .filter((c) => c.kind !== 'live' && !doomed.has(c.id))
      .sort((a, b) => b.seq - a.seq);
    for (const c of durable.slice(this.retention.maxPerRepo)) doomed.add(c.id);

    for (const id of doomed) {
      const record = all.find((c) => c.id === id);
      if (!record) continue;
      try {
        await this.store.dropRef(
          repoDir,
          checkpointRefName(record.workspaceId, record.repoAlias, record.seq),
        );
      } catch {
        /* ref may already be gone */
      }
      await this.repository.delete(id);
    }

    if (doomed.size > 0) {
      this.logger.info(`[Checkpoints] Pruned ${doomed.size} checkpoints for ${workspaceId}`);
    }
    return doomed.size;
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    await this.repository.deleteByWorkspace(workspaceId);
  }

  // ── Internals ───────────────────────────────────────────────

  private async aggregateStats(
    repoDir: string,
    fromTree: string,
    toTree: string,
  ): Promise<{ fileCount: number; additions: number; deletions: number }> {
    try {
      const entries = await this.git.diffNumstat(repoDir, fromTree, toTree);
      let additions = 0;
      let deletions = 0;
      for (const e of entries) {
        if (e.additions > 0) additions += e.additions;
        if (e.deletions > 0) deletions += e.deletions;
      }
      return { fileCount: entries.length, additions, deletions };
    } catch {
      return { fileCount: 0, additions: 0, deletions: 0 };
    }
  }

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    this.locks.set(
      key,
      next.catch(() => undefined),
    );
    try {
      return await next;
    } finally {
      if (this.locks.get(key) === next) this.locks.delete(key);
    }
  }
}

/** The well-known SHA of git's empty tree — valid in every repository. */
export const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** Returns a skip reason when the path must not be written through. */
async function classifyPath(fullPath: string): Promise<string | null> {
  try {
    const stat = await fs.lstat(fullPath);
    if (stat.isSymbolicLink()) return 'symlink';
    if (stat.isFile() && stat.nlink > 1) return 'hard link';
    return null;
  } catch {
    // Missing file — nothing to protect.
    return null;
  }
}
