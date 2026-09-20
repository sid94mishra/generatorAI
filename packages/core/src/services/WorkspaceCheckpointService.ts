// ────────────────────────────────────────────────────────────────
// WorkspaceCheckpointService — workspace-aware checkpoint capture
// ────────────────────────────────────────────────────────────────
//
// `CheckpointService` snapshots ONE repository. A workspace can contain
// several (root + linked worktrees + agent-generated subdirs), so this
// service fans a single logical checkpoint out across all of them using the
// exact same repo-discovery rules `ChangeSetService` uses — otherwise a repo
// could be diffed against a baseline that was never captured for it.

import type {
  AgentEvent,
  CheckpointKind,
  CheckpointProvenance,
  CheckpointRecord,
  ExecutionWorkspace,
  ILogger,
} from '@generatorai/shared';
import type { CheckpointService } from '@generatorai/checkpoints';
import { discoverRepos, type DiscoveredRepo, type MountRef } from '@generatorai/changes';
import type { IGitClient } from '@generatorai/git';
import type { IExecutionWorkspaceRepository } from '../domain/ports/IExecutionWorkspaceRepository.js';
import type { EventBus } from '../events/EventBus.js';

/** Where the workspace's mounts come from (the WorkspaceManager). */
export interface MountSource {
  toMountRefs(workspace: ExecutionWorkspace): Promise<MountRef[]>;
}

export interface CaptureWorkspaceCheckpointParams extends CheckpointProvenance {
  workspaceId: string;
  kind: CheckpointKind;
  label?: string;
  /** Restrict the capture to one repo alias (defaults to every repo). */
  repoAlias?: string;
  skipIfUnchanged?: boolean;
}

export type WorkspaceRepoRef = DiscoveredRepo;

/**
 * Provenance carried on emitted events so the SSE bridge can republish to the
 * chat / run scopes and the client can invalidate the right queries.
 */
export interface CheckpointEventScope {
  sessionId?: string;
  chatId?: string;
  workflowRunId?: string;
}

/** Outcome of `WorkspaceCheckpointService.restoreTurn`, per mount and in total. */
export interface RestoreTurnResult {
  mounts: Array<{
    alias: string;
    ok: boolean;
    checkpointId?: string;
    restored?: number;
    deleted?: number;
    skipped?: number;
    preRestoreCheckpointId?: string | null;
    error?: string;
  }>;
  restored: number;
  deleted: number;
  skipped: number;
}

/** What `onRestore` listeners are told. Paths are repo-relative. */
export interface WorkspaceRestoreNotice {
  workspaceId: string;
  repoAlias: string;
  restoredPaths: string[];
  deletedPaths: string[];
  /** The chat that owns the workspace, when one does. */
  chatId?: string;
}

export class WorkspaceCheckpointService {
  /**
   * Debounce state for rolling `live` captures, keyed by workspace. Prevents
   * a write-heavy agent turn from producing hundreds of snapshots.
   */
  private readonly liveTimers = new Map<string, NodeJS.Timeout>();
  /** When the oldest still-unserved live-capture request for a workspace arrived. */
  private readonly liveWaitingSince = new Map<string, number>();
  /** Longest a live capture may be put off by further activity. */
  static readonly LIVE_MAX_WAIT_MS = 6_000;
  static readonly LIVE_DEBOUNCE_MS = 2_000;

  /**
   * Optional event bus. Late-wired because the bus is constructed before the
   * checkpoint stack in the composition root.
   */
  private eventBus?: EventBus;

  constructor(
    private readonly checkpoints: CheckpointService,
    private readonly workspaceRepo: IExecutionWorkspaceRepository,
    private readonly mounts: MountSource,
    private readonly git: IGitClient,
    private readonly logger: ILogger,
  ) {}

  /** Late-wire the event bus so checkpoint activity reaches the SSE stream. */
  setEventBus(bus: EventBus): void {
    this.eventBus = bus;
  }

  /**
   * Called with a repo directory right after its working tree was rewritten
   * by a restore, BEFORE the restore is announced. The change-summary cache
   * memoises the working tree; without dropping it here clients that refetch
   * on the announcement would be served the pre-restore tree.
   */
  private restoreListener?: (repoDir: string) => void;
  setRestoreListener(fn: (repoDir: string) => void): void {
    this.restoreListener = fn;
  }

  /**
   * Rewind every mount of a workspace to the snapshot taken at `phase` of one
   * chat turn, in one call.
   *
   * Each mount has its own `before` snapshot for the turn (captured with
   * `skipIfUnchanged: false`, so one exists for every mount that was ready at
   * the time). A mount that has none — it was added later, or its capture
   * failed — falls back to its newest snapshot taken before the turn's, so
   * the rewind still lands the mount on its state at that moment rather than
   * silently leaving it alone. Results are per mount; a failure on one mount
   * does not stop the others, and the caller reports all of them.
   */
  async restoreTurn(
    workspaceId: string,
    turnId: string,
    scope: CheckpointEventScope = {},
    phase: 'before' | 'after' = 'before',
  ): Promise<RestoreTurnResult> {
    const result: RestoreTurnResult = { mounts: [], restored: 0, deleted: 0, skipped: 0 };
    const workspace = await this.workspaceRepo.findById(workspaceId);
    if (!workspace) return result;
    const repos = await this.resolveRepos(workspace);
    const all = await this.checkpoints.list({ workspaceId, limit: 5_000, excludeLive: true });
    const exact = all.filter((c) => c.turnId === turnId && (c.phase ?? 'before') === phase);
    // Every mount's snapshot of the turn shares one capture moment; a mount
    // without one falls back to its latest snapshot taken before that moment.
    const momentMs = exact.length
      ? Math.min(...exact.map((c) => c.createdAt.getTime()))
      : undefined;

    for (const repo of repos) {
      let target = exact.find((c) => c.repoAlias === repo.alias);
      if (!target && momentMs !== undefined) {
        target = all
          .filter((c) => c.repoAlias === repo.alias && c.createdAt.getTime() <= momentMs)
          .sort((a, b) => b.seq - a.seq)[0];
      }
      if (!target) {
        result.mounts.push({ alias: repo.alias, ok: false, error: 'No snapshot for this turn' });
        continue;
      }
      try {
        const r = await this.checkpoints.restore(target, repo.repoDir);
        this.restoreListener?.(repo.repoDir);
        await this.announceRestore(workspaceId, target.id, repo.alias, r, scope);
        result.restored += r.restoredPaths.length;
        result.deleted += r.deletedPaths.length;
        result.skipped += r.skipped.length;
        result.mounts.push({
          alias: repo.alias,
          ok: true,
          checkpointId: target.id,
          restored: r.restoredPaths.length,
          deleted: r.deletedPaths.length,
          skipped: r.skipped.length,
          preRestoreCheckpointId: r.preRestoreCheckpointId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[WorkspaceCheckpoints] restoreTurn ${turnId} failed for ${repo.alias}: ${message}`);
        result.mounts.push({ alias: repo.alias, ok: false, checkpointId: target.id, error: message });
      }
    }
    return result;
  }

  /**
   * Capture a checkpoint across every repo in the workspace. Returns the
   * records that were actually written (repos with no changes are skipped).
   *
   * Never throws — checkpointing must not be able to break the agent loop.
   */
  async capture(params: CaptureWorkspaceCheckpointParams): Promise<CheckpointRecord[]> {
    try {
      const workspace = await this.workspaceRepo.findById(params.workspaceId);
      if (!workspace) return [];

      const repos = await this.resolveRepos(workspace);
      const targets = params.repoAlias
        ? repos.filter((r) => r.alias === params.repoAlias)
        : repos;

      const created: CheckpointRecord[] = [];
      for (const repo of targets) {
        // Self-healing baseline: the very first snapshot of a repo is always
        // recorded as the `baseline`, whatever the caller asked for. Repos can
        // appear mid-run (a worktree is linked, the agent scaffolds a new
        // subdirectory), and every one of them needs a "since the start"
        // anchor or its diffs would have nothing to compare against.
        //
        // This is correct because the earliest capture point is a `turn` /
        // `stage` checkpoint, which is taken BEFORE the agent runs.
        const existing = await this.checkpoints.getLatest(params.workspaceId, repo.alias);
        const kind: CheckpointKind = existing ? params.kind : 'baseline';
        const isImplicitBaseline = !existing && params.kind !== 'baseline';

        const record = await this.checkpoints.create({
          workspaceId: params.workspaceId,
          repoDir: repo.repoDir,
          repoAlias: repo.alias,
          kind,
          ...(params.label ? { label: params.label } : {}),
          // A baseline must always be written, even for an empty repo —
          // otherwise there is nothing to diff the first turn against.
          skipIfUnchanged: kind === 'baseline' ? false : (params.skipIfUnchanged ?? true),
          ...(params.sessionId ? { sessionId: params.sessionId } : {}),
          ...(params.chatId ? { chatId: params.chatId } : {}),
          ...(params.turnId ? { turnId: params.turnId } : {}),
          ...(params.workflowRunId ? { workflowRunId: params.workflowRunId } : {}),
          ...(params.stageRunId ? { stageRunId: params.stageRunId } : {}),
          ...(params.automationExecutionRunId
            ? { automationExecutionRunId: params.automationExecutionRunId }
            : {}),
          // Only meaningful on the checkpoint the caller actually asked for.
          // An implicit baseline is not a side of the turn, so it stays unset.
          ...(params.phase && !isImplicitBaseline ? { phase: params.phase } : {}),
          ...(params.promptExcerpt ? { promptExcerpt: params.promptExcerpt } : {}),
        });
        if (record) created.push(record);

        // The caller asked for a turn/stage checkpoint on a brand-new repo.
        // We wrote the baseline above; now write the requested checkpoint so
        // the provenance link (turnId → checkpoint) still exists. It is a
        // no-op when nothing changed, which is the common case.
        if (isImplicitBaseline) {
          const followUp = await this.checkpoints.create({
            workspaceId: params.workspaceId,
            repoDir: repo.repoDir,
            repoAlias: repo.alias,
            kind: params.kind,
            ...(params.label ? { label: params.label } : {}),
            skipIfUnchanged: params.skipIfUnchanged ?? true,
            ...(params.sessionId ? { sessionId: params.sessionId } : {}),
            ...(params.chatId ? { chatId: params.chatId } : {}),
            ...(params.turnId ? { turnId: params.turnId } : {}),
            ...(params.workflowRunId ? { workflowRunId: params.workflowRunId } : {}),
            ...(params.stageRunId ? { stageRunId: params.stageRunId } : {}),
            ...(params.automationExecutionRunId
              ? { automationExecutionRunId: params.automationExecutionRunId }
              : {}),
            ...(params.phase ? { phase: params.phase } : {}),
            ...(params.promptExcerpt ? { promptExcerpt: params.promptExcerpt } : {}),
          });
          if (followUp) created.push(followUp);
        }
      }

      for (const record of created) {
        await this.emitCheckpointEvents(record, params);
      }
      // Retention was never enforced before (no caller): snapshots accumulated
      // for the life of the workspace. Prune after every durable capture.
      if (created.length > 0 && params.kind !== 'live') {
        for (const repo of targets) {
          try {
            await this.checkpoints.prune(params.workspaceId, repo.repoDir, repo.alias);
          } catch {
            /* logged by the service */
          }
        }
      }
      return created;
    } catch (err) {
      this.logger.warn(
        `[WorkspaceCheckpoints] capture failed for ${params.workspaceId}: ${err}`,
      );
      return [];
    }
  }

  /**
   * Debounced rolling capture used while the agent is actively writing files,
   * so the Changes panel can show a live diff without a snapshot per write.
   */
  scheduleLiveCapture(workspaceId: string, provenance: CheckpointProvenance = {}): void {
    const existing = this.liveTimers.get(workspaceId);
    if (existing) clearTimeout(existing);

    // A pure trailing debounce never fires while the agent keeps working — a
    // tool call every second holds it off until the turn is over, which is
    // exactly when a live diff stops being useful. So the wait is capped.
    const now = Date.now();
    const since = this.liveWaitingSince.get(workspaceId) ?? now;
    this.liveWaitingSince.set(workspaceId, since);
    const delay = Math.max(
      0,
      Math.min(
        WorkspaceCheckpointService.LIVE_DEBOUNCE_MS,
        since + WorkspaceCheckpointService.LIVE_MAX_WAIT_MS - now,
      ),
    );

    const timer = setTimeout(() => {
      this.liveTimers.delete(workspaceId);
      this.liveWaitingSince.delete(workspaceId);
      void this.capture({ workspaceId, kind: 'live', ...provenance });
    }, delay);

    // Never hold the process open for a rolling snapshot.
    timer.unref?.();
    this.liveTimers.set(workspaceId, timer);
  }

  /** Cancel any pending rolling capture (workspace teardown). */
  cancelLiveCapture(workspaceId: string): void {
    const existing = this.liveTimers.get(workspaceId);
    if (existing) {
      clearTimeout(existing);
      this.liveTimers.delete(workspaceId);
    }
    this.liveWaitingSince.delete(workspaceId);
  }

  /**
   * Every repository inside a workspace, using the same discovery rules as
   * the change-set engine.
   */
  async resolveRepos(workspace: ExecutionWorkspace): Promise<WorkspaceRepoRef[]> {
    // The mounts ARE the tracked set: the directories the agent edits, each
    // with its private shadow store. The managed root (scratch, plans,
    // screenshots) is deliberately not among them.
    const mounts = await this.mounts.toMountRefs(workspace);
    const repos = await discoverRepos(this.git, {
      rootPath: workspace.codeRoot ?? workspace.rootPath,
      mounts,
      autoInit: false,
    });
    for (const repo of repos) this.checkpoints.registerShadow(repo.repoDir, repo.gitDir);
    return repos;
  }

  /** Resolve a single repo alias to its absolute directory. */
  async resolveRepoDir(workspaceId: string, repoAlias = '.'): Promise<string | null> {
    const workspace = await this.workspaceRepo.findById(workspaceId);
    if (!workspace) return null;
    const repos = await this.resolveRepos(workspace);
    return repos.find((r) => r.alias === repoAlias)?.repoDir ?? null;
  }

  /** Prune checkpoints for every repo in a workspace. */
  async prune(workspaceId: string): Promise<number> {
    try {
      const workspace = await this.workspaceRepo.findById(workspaceId);
      if (!workspace) return 0;
      const repos = await this.resolveRepos(workspace);
      let total = 0;
      for (const repo of repos) {
        total += await this.checkpoints.prune(workspaceId, repo.repoDir, repo.alias);
      }
      return total;
    } catch (err) {
      this.logger.warn(`[WorkspaceCheckpoints] prune failed for ${workspaceId}: ${err}`);
      return 0;
    }
  }

  /** Drop all checkpoint rows for a workspace (called on deletion). */
  async forget(workspaceId: string): Promise<void> {
    this.cancelLiveCapture(workspaceId);
    await this.checkpoints.deleteWorkspace(workspaceId);
  }

  private readonly restoreListeners = new Set<(notice: WorkspaceRestoreNotice) => void>();

  /**
   * Be told whenever the user moves files back in time — a rewind, a
   * checkpoint restore, "Undo" on a changed file. Every one of those paths
   * ends in `announceRestore`, so this is the one place to listen.
   */
  onRestore(listener: (notice: WorkspaceRestoreNotice) => void): () => void {
    this.restoreListeners.add(listener);
    return () => { this.restoreListeners.delete(listener); };
  }

  /**
   * Announce a restore so every client viewing this workspace refetches —
   * the working tree just moved underneath them.
   */
  async announceRestore(
    workspaceId: string,
    checkpointId: string,
    repoAlias: string,
    result: {
      preRestoreCheckpointId: string | null;
      restoredPaths: string[];
      deletedPaths: string[];
      skipped: Array<{ path: string; reason: string }>;
    },
    scope: CheckpointEventScope = {},
  ): Promise<void> {
    await this.emit(
      {
        kind: 'checkpoint.restored',
        data: {
          workspaceId,
          checkpointId,
          repoAlias,
          preRestoreCheckpointId: result.preRestoreCheckpointId,
          restoredCount: result.restoredPaths.length,
          deletedCount: result.deletedPaths.length,
          skipped: result.skipped,
          ...(scope.chatId ? { chatId: scope.chatId } : {}),
          ...(scope.workflowRunId ? { workflowRunId: scope.workflowRunId } : {}),
        },
      },
      scope.sessionId,
    );
    await this.emit(
      {
        kind: 'workspace.changed',
        data: {
          workspaceId,
          repoAlias,
          changedPaths: [...result.restoredPaths, ...result.deletedPaths],
          stats: {
            files: result.restoredPaths.length + result.deletedPaths.length,
            additions: 0,
            deletions: 0,
          },
          ...(scope.chatId ? { chatId: scope.chatId } : {}),
          ...(scope.workflowRunId ? { workflowRunId: scope.workflowRunId } : {}),
        },
      },
      scope.sessionId,
    );
    if (this.restoreListeners.size > 0 && result.restoredPaths.length + result.deletedPaths.length > 0) {
      let chatId = scope.chatId;
      if (!chatId) {
        try {
          const workspace = await this.workspaceRepo.findById(workspaceId);
          if (workspace?.ownerType === 'chat' && workspace.ownerId) chatId = workspace.ownerId;
        } catch { /* a notice is best effort */ }
      }
      const notice: WorkspaceRestoreNotice = {
        workspaceId,
        repoAlias,
        restoredPaths: result.restoredPaths,
        deletedPaths: result.deletedPaths,
        ...(chatId ? { chatId } : {}),
      };
      for (const listener of this.restoreListeners) {
        try { listener(notice); } catch { /* a listener must not break a restore */ }
      }
    }
  }

  // ── Events ──────────────────────────────────────────────────

  private async emitCheckpointEvents(
    record: CheckpointRecord,
    scope: CheckpointEventScope,
  ): Promise<void> {
    // Rolling `live` snapshots are an implementation detail — they must still
    // refresh the Changes panel, but they never appear in the rewind picker,
    // so no `checkpoint.created` is emitted for them.
    if (record.kind !== 'live') {
      await this.emit(
        {
          kind: 'checkpoint.created',
          data: {
            workspaceId: record.workspaceId,
            checkpointId: record.id,
            repoAlias: record.repoAlias,
            checkpointKind: record.kind,
            ...(record.label ? { label: record.label } : {}),
            ...(record.turnId ? { turnId: record.turnId } : {}),
            ...(record.stageRunId ? { stageRunId: record.stageRunId } : {}),
            ...(scope.chatId ?? record.chatId ? { chatId: scope.chatId ?? record.chatId } : {}),
            ...(scope.workflowRunId ?? record.workflowRunId
              ? { workflowRunId: scope.workflowRunId ?? record.workflowRunId }
              : {}),
          },
        },
        scope.sessionId ?? record.sessionId,
      );
    }

    if (record.fileCount > 0) {
      await this.emit(
        {
          kind: 'workspace.changed',
          data: {
            workspaceId: record.workspaceId,
            repoAlias: record.repoAlias,
            changedPaths: [],
            stats: {
              files: record.fileCount,
              additions: record.additions,
              deletions: record.deletions,
            },
            checkpointId: record.id,
            ...(scope.chatId ?? record.chatId ? { chatId: scope.chatId ?? record.chatId } : {}),
            ...(scope.workflowRunId ?? record.workflowRunId
              ? { workflowRunId: scope.workflowRunId ?? record.workflowRunId }
              : {}),
          },
        },
        scope.sessionId ?? record.sessionId,
      );
    }
  }

  /**
   * Emit through the session queue when we know the session (so ordering vs.
   * harness events is preserved), else globally.
   */
  private async emit(event: AgentEvent, sessionId?: string): Promise<void> {
    if (!this.eventBus) return;
    try {
      if (sessionId) await this.eventBus.emit(sessionId, event);
      else await this.eventBus.emitGlobal(event);
    } catch (err) {
      this.logger.warn(`[WorkspaceCheckpoints] event emit failed: ${err}`);
    }
  }
}
