// ────────────────────────────────────────────────────────────────
// ChatChangeStatsService — keeps the chat list's "Changes ±" column (G-02).
//
// docs/redesign/05-gap-matrix.md §G-02. Each chat row carries the net change
// of its workspace — session baseline → working tree, the same default view
// the Changes tab opens on — in `chats.changes_*`, so a page of chats needs no
// per-row change request.
//
// When it is recomputed:
//   - `workspace.changed` (live snapshots during a turn, the turn's closing
//     checkpoint, discard / restore / rewind) and `checkpoint.restored`;
//   - `harness.idle` — the turn ended;
//   - `ensure()` — the list met a row whose stats were never computed (every
//     chat that predates migration v55), once per workspace per process.
//
// Recomputes are coalesced per workspace: the first trigger arms a timer and
// later triggers inside the window ride along, so a write-heavy turn costs one
// summary per window rather than one per event. Across workspaces at most
// `maxConcurrent` (default 3) summaries run at once and the rest wait in a
// FIFO: listing 200 never-computed rows must not start 200 git processes at
// the same moment (P2-R9). A workspace is shared by an
// orchestrator and its workers, so every chat on it gets the same stats. When
// the stored values move, `chat.updated` tells list views to refetch.
//
// The computation itself (`computeStats`) is injected by the composition root,
// which owns the workspace manager and the change-summary engine; it answers
// null when the workspace is gone, which leaves the column unknown ("—").
// ────────────────────────────────────────────────────────────────

import type { AgentEvent, ChatChangeStats, ILogger, PersistedEvent } from '@generatorai/shared';
import type { IChatRepository } from '../domain/ports/IChatRepository.js';

export interface ChatChangeStatsDeps {
  eventBus: {
    subscribeAll(handler: (event: PersistedEvent) => void, name?: string): () => void;
    /** A discard or restore with no chat session in scope is announced on the global path. */
    subscribeGlobal(handler: (event: PersistedEvent) => void): () => void;
    emit(sessionId: string, event: AgentEvent): Promise<unknown>;
  };
  chats: Pick<IChatRepository, 'getById' | 'getByWorkspaceId' | 'setChangeStats'>;
  /** Net change of a workspace, baseline → working; null when it cannot be computed. */
  computeStats(workspaceId: string): Promise<ChatChangeStats | null>;
  /** Coalescing window in ms. Default 1500. */
  debounceMs?: number;
  /** Summaries allowed to run at once, across all workspaces. Default 3. */
  maxConcurrent?: number;
  logger?: Pick<ILogger, 'warn'>;
}

/** The slice of a change-summary repo this needs (structural, so core does not depend on `@generatorai/changes`). */
export interface ChangeStatsRepo {
  kind: string;
  stats: ChatChangeStats;
  /** A repo the engine could not summarise comes back with no base tree and placeholder zero stats. */
  base?: { treeish?: string };
}

/**
 * Net stats of a change summary as the Changes tab counts them: the legacy
 * workspace wrapper repo (kind `root`) is supporting material and is left out
 * whenever a real codebase is mounted, exactly as `splitWorkspaceChanges` in
 * the web does by default. A workspace with no codebase keeps it — there the
 * scratch files ARE the work.
 *
 * Null when any repo failed to summarise (a git error, a lock held by another
 * reader): its zeros are a placeholder, and storing them would show a chat
 * with changes as clean. The previous value stays until the next recompute.
 */
export function netChangeStats(repos: readonly ChangeStatsRepo[]): ChatChangeStats | null {
  if (repos.some((r) => r.base !== undefined && !r.base.treeish)) return null;
  const hasCodebase = repos.some((r) => r.kind !== 'root');
  return repos
    .filter((r) => !hasCodebase || r.kind !== 'root')
    .reduce<ChatChangeStats>(
      (acc, r) => ({
        files: acc.files + r.stats.files,
        additions: acc.additions + r.stats.additions,
        deletions: acc.deletions + r.stats.deletions,
      }),
      { files: 0, additions: 0, deletions: 0 },
    );
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export class ChatChangeStatsService {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** workspaceId → the running recompute (serialised per workspace). */
  private readonly running = new Map<string, Promise<void>>();
  /** A trigger that landed while that workspace was recomputing: run once more after. */
  private readonly again = new Set<string>();
  /** Workspaces `ensure()` has already asked for in this process. */
  private readonly ensured = new Set<string>();
  /** Due workspaces waiting for a free slot, oldest first (a Set keeps each once). */
  private readonly queued = new Set<string>();
  private readonly maxConcurrent: number;
  private readonly unsubscribers: Array<() => void> = [];
  private stopped = false;
  private readonly debounceMs: number;

  constructor(private readonly deps: ChatChangeStatsDeps) {
    this.debounceMs = deps.debounceMs ?? 1_500;
    this.maxConcurrent = Math.max(1, deps.maxConcurrent ?? 3);
  }

  start(): void {
    const { eventBus } = this.deps;
    this.unsubscribers.push(
      eventBus.subscribeAll((event) => this.onEvent(event), 'chat-change-stats'),
      eventBus.subscribeGlobal((event) => this.onEvent(event)),
    );
  }

  stop(): void {
    this.stopped = true;
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.queued.clear();
  }

  /** Stats for these rows were never computed: compute them once, in the background. */
  ensure(rows: ReadonlyArray<{ workspaceId?: string }>): void {
    for (const row of rows) {
      if (!row.workspaceId || this.ensured.has(row.workspaceId)) continue;
      this.ensured.add(row.workspaceId);
      this.schedule(row.workspaceId);
    }
  }

  /** Resolves when no recompute is armed or running. Tests and shutdown. */
  async settled(): Promise<void> {
    for (;;) {
      // A queued workspace implies a running one, so `running` covers the queue.
      if (this.timers.size === 0 && this.running.size === 0) return;
      await Promise.all([...this.running.values()]);
      if (this.timers.size > 0) await new Promise((r) => setTimeout(r, this.debounceMs + 5));
    }
  }

  private onEvent(event: PersistedEvent): void {
    if (this.stopped) return;
    const data = (event.data ?? {}) as Record<string, unknown>;
    if (event.kind === 'workspace.changed' || event.kind === 'checkpoint.restored') {
      const workspaceId = str(data['workspaceId']);
      if (workspaceId) this.schedule(workspaceId);
      return;
    }
    if (event.kind === 'harness.idle') {
      const chatId = str(data['chatId']);
      if (!chatId) return;
      void this.deps.chats
        .getById(chatId)
        .then((chat) => {
          if (chat.workspaceId) this.schedule(chat.workspaceId);
        })
        .catch(() => undefined);
    }
  }

  private schedule(workspaceId: string): void {
    if (this.stopped || this.timers.has(workspaceId)) return;
    const timer = setTimeout(() => {
      this.timers.delete(workspaceId);
      this.run(workspaceId);
    }, this.debounceMs);
    // Never keep a process alive just to refresh a list column.
    (timer as { unref?: () => void }).unref?.();
    this.timers.set(workspaceId, timer);
  }

  private run(workspaceId: string): void {
    if (this.running.has(workspaceId)) {
      this.again.add(workspaceId);
      return;
    }
    if (this.running.size >= this.maxConcurrent) {
      this.queued.add(workspaceId);
      return;
    }
    const job = this.recompute(workspaceId)
      .catch((err: unknown) => {
        this.deps.logger?.warn('[ChatChangeStats] recompute failed', {
          workspaceId,
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        this.running.delete(workspaceId);
        if (this.again.delete(workspaceId)) this.schedule(workspaceId);
        this.startNextQueued();
      });
    this.running.set(workspaceId, job);
  }

  private startNextQueued(): void {
    if (this.stopped) return;
    for (const next of this.queued) {
      if (this.running.size >= this.maxConcurrent) return;
      this.queued.delete(next);
      this.run(next);
    }
  }

  private async recompute(workspaceId: string): Promise<void> {
    const stats = await this.deps.computeStats(workspaceId);
    if (!stats || this.stopped) return;
    for (const chat of await this.deps.chats.getByWorkspaceId(workspaceId)) {
      if (await this.deps.chats.setChangeStats(chat.id, stats)) {
        await this.deps.eventBus.emit(chat.sessionId, { kind: 'chat.updated', data: { chatId: chat.id } });
      }
    }
  }
}
