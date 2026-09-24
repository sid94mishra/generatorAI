// ────────────────────────────────────────────────────────────────
// SessionAllocator — session allocation for workflow execution modes
// Handles single, per-stage, and auto session allocation.
// ────────────────────────────────────────────────────────────────

import type { Session, WorkflowSessionMode } from '@generatorai/shared';
import { generateId, SessionAllocationError } from '@generatorai/shared';
import type { ISessionRepository } from '../domain/ports/IRepositories.js';
import type { IAgentHarness, CreateConversationParams } from '../domain/ports/IAgentHarness.js';
import type {
  ISessionAllocationRepository,
  SessionAllocationRow,
} from '../domain/ports/ISessionAllocationRepository.js';
import type { EventBus } from '../events/EventBus.js';

/** Tracks allocated sessions for a workflow run */
interface RunAllocation {
  /** DB row id for the persisted allocation (so we can update/delete). */
  allocationId: string;
  mode: WorkflowSessionMode;
  /** The shared session for 'single' mode */
  sharedSessionId?: string;
  /** Map of stageRunId → sessionId for per-stage allocations */
  stageSessionMap: Map<string, string>;
  /** Reference count for shared sessions (auto mode) */
  sharedRefCount: number;
}

export class SessionAllocator {
  /** Run ID → allocation state */
  private allocations = new Map<string, RunAllocation>();

  /**
   * Per-run serialization gate. Allocation and release mutate shared
   * allocation state across `await` points (session creation, DB writes), so
   * concurrent ready stages of the SAME run must not interleave — otherwise
   * `single` mode would create duplicate shared sessions and undercount the
   * refcount (causing a premature destroy-in-use). Operations on DIFFERENT
   * runs still run concurrently. Entries are removed once the chain drains, so
   * the map does not grow unbounded.
   */
  private runLocks = new Map<string, Promise<unknown>>();

  private serializePerRun<T>(runId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.runLocks.get(runId) ?? Promise.resolve();
    // Run `fn` whether or not the previous holder rejected, so one failed
    // allocation never wedges the rest of the run's allocations.
    const result = prev.then(fn, fn);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.runLocks.set(runId, tail);
    void tail.then(() => {
      if (this.runLocks.get(runId) === tail) this.runLocks.delete(runId);
    });
    return result;
  }

  constructor(
    private sessionRepo: ISessionRepository,
    private harness: IAgentHarness,
    private eventBus: EventBus,
    /**
     * Optional persistence. When supplied, every allocator mutation is
     * written through so a process crash leaves a recoverable trail of
     * which stages owned which Copilot sessions. StartupRecoveryService
     * calls `rehydrate()` on boot to reload the in-memory Map.
     */
    private allocationRepo?: ISessionAllocationRepository,
  ) {}

  /** Rebuild in-memory state from the DB (StartupRecovery entry point). */
  async rehydrate(): Promise<void> {
    if (!this.allocationRepo) return;
    const rows = await this.allocationRepo.listAllocations();
    for (const row of rows) {
      const map = new Map<string, string>();
      const stageMaps = await this.allocationRepo.listStageSessions(row.id);
      for (const sm of stageMaps) map.set(sm.stageRunId, sm.sessionId);
      this.allocations.set(row.workflowRunId, {
        allocationId: row.id,
        mode: row.mode,
        sharedSessionId: row.sharedSessionId ?? undefined,
        stageSessionMap: map,
        sharedRefCount: row.sharedRefCount,
      });
    }
  }

  /**
   * Allocate a session for a stage run.
   * - single: reuse the shared session (create on first call)
   * - per-stage: create a new session for each stage
   * - auto: reuse shared session for sequential stages, new for parallel
   */
  async allocateSession(
    workflowRunId: string,
    stageRunId: string,
    mode: WorkflowSessionMode,
    config?: Partial<CreateConversationParams>,
  ): Promise<Session> {
    return this.serializePerRun(workflowRunId, () =>
      this.allocateSessionLocked(workflowRunId, stageRunId, mode, config),
    );
  }

  private async allocateSessionLocked(
    workflowRunId: string,
    stageRunId: string,
    mode: WorkflowSessionMode,
    config?: Partial<CreateConversationParams>,
  ): Promise<Session> {
    let allocation = this.allocations.get(workflowRunId);
    if (!allocation) {
      const allocationId = generateId();
      allocation = { allocationId, mode, stageSessionMap: new Map(), sharedRefCount: 0 };
      this.allocations.set(workflowRunId, allocation);
      if (this.allocationRepo) {
        const row: SessionAllocationRow = {
          id: allocationId,
          workflowRunId,
          mode,
          sharedSessionId: null,
          sharedRefCount: 0,
          createdAt: new Date(),
        };
        await this.allocationRepo.createAllocation(row);
      }
    }

    switch (mode) {
      case 'single':
        return this.allocateSingleMode(allocation, workflowRunId, stageRunId, config);
      case 'per-stage':
        return this.allocatePerStageMode(allocation, workflowRunId, stageRunId, config);
      case 'auto':
        // Auto mode creates a new session per stage for simplicity
        // (DAGScheduler handles parallelism, each parallel stage gets its own)
        return this.allocatePerStageMode(allocation, workflowRunId, stageRunId, config);
      default:
        throw new SessionAllocationError(`Unknown session mode: ${mode as string}`);
    }
  }

  /**
   * Release a session after a stage completes.
   * In per-stage mode: destroys the conversation and closes the session.
   * In single mode: only releases when explicitly told (via releaseAll).
   */
  async releaseSession(stageRunId: string): Promise<void> {
    // Resolve which run owns this stage (sync map scan) so the release runs
    // under the SAME per-run lock as allocation — preventing a release from
    // racing an in-flight allocate on the shared session.
    let owningRunId: string | undefined;
    for (const [runId, allocation] of this.allocations) {
      if (allocation.stageSessionMap.has(stageRunId)) {
        owningRunId = runId;
        break;
      }
    }
    if (!owningRunId) return;
    return this.serializePerRun(owningRunId, () => this.releaseSessionLocked(stageRunId));
  }

  private async releaseSessionLocked(stageRunId: string): Promise<void> {
    for (const [, allocation] of this.allocations) {
      const sessionId = allocation.stageSessionMap.get(stageRunId);
      if (!sessionId) continue;

      if (allocation.mode === 'per-stage' || allocation.mode === 'auto') {
        await this.destroySession(sessionId);
        allocation.stageSessionMap.delete(stageRunId);
        if (this.allocationRepo) {
          await this.allocationRepo.deleteStageSession(stageRunId);
        }
      } else if (allocation.mode === 'single') {
        allocation.sharedRefCount = Math.max(0, allocation.sharedRefCount - 1);
        allocation.stageSessionMap.delete(stageRunId);
        if (this.allocationRepo) {
          await this.allocationRepo.deleteStageSession(stageRunId);
          await this.allocationRepo.updateAllocation(allocation.allocationId, {
            sharedRefCount: allocation.sharedRefCount,
          });
        }
        // When the last stage releases a shared session, destroy it to
        // prevent session + SDK conversation leaks.
        if (allocation.sharedRefCount === 0 && allocation.sharedSessionId) {
          await this.destroySession(allocation.sharedSessionId);
          allocation.sharedSessionId = undefined;
          if (this.allocationRepo) {
            await this.allocationRepo.updateAllocation(allocation.allocationId, {
              sharedSessionId: null,
            });
          }
        }
      }
      return;
    }
  }

  /**
   * Release all sessions for a workflow run.
   * Called on run completion, cancellation, or deletion.
   */
  async releaseAll(workflowRunId: string): Promise<void> {
    return this.serializePerRun(workflowRunId, () => this.releaseAllLocked(workflowRunId));
  }

  private async releaseAllLocked(workflowRunId: string): Promise<void> {
    const allocation = this.allocations.get(workflowRunId);
    if (!allocation) return;

    const sessionIds = new Set<string>();
    for (const sid of allocation.stageSessionMap.values()) {
      sessionIds.add(sid);
    }
    if (allocation.sharedSessionId) {
      sessionIds.add(allocation.sharedSessionId);
    }

    for (const sessionId of sessionIds) {
      await this.destroySession(sessionId);
    }

    this.allocations.delete(workflowRunId);
    if (this.allocationRepo) {
      // FK cascade removes stage_session_maps rows automatically.
      await this.allocationRepo.deleteAllocation(allocation.allocationId);
    }
  }

  /**
   * Look up a session by its ID (for in-session retry).
   * Returns the session record with its conversationId.
   */
  async getSessionById(sessionId: string): Promise<Session | null> {
    try {
      return await this.sessionRepo.getById(sessionId);
    } catch {
      return null;
    }
  }

  // ── Private Helpers ──

  private async allocateSingleMode(
    allocation: RunAllocation,
    workflowRunId: string,
    stageRunId: string,
    config?: Partial<CreateConversationParams>,
  ): Promise<Session> {
    if (allocation.sharedSessionId) {
      // Reuse existing shared session
      const session = await this.sessionRepo.getById(allocation.sharedSessionId);

      // Idempotent ref-counting: only count this stage once. A retry that
      // re-allocates for the same stageRunId (without an intervening release)
      // must NOT bump the refcount again, otherwise the count never returns to
      // zero and the shared session/SDK conversation is never destroyed when
      // the last real stage releases (it leaks until releaseAll at run end).
      const alreadyHeld = allocation.stageSessionMap.has(stageRunId);
      if (!alreadyHeld) {
        allocation.stageSessionMap.set(stageRunId, session.id);
        allocation.sharedRefCount++;
        if (this.allocationRepo) {
          await this.allocationRepo.putStageSession({
            id: generateId(),
            allocationId: allocation.allocationId,
            stageRunId,
            sessionId: session.id,
          });
          await this.allocationRepo.updateAllocation(allocation.allocationId, {
            sharedRefCount: allocation.sharedRefCount,
          });
        }
      }

      // Ensure the conversation is in-memory (may have been lost after restart)
      try {
        await this.harness.resumeConversation(session.conversationId!);
      } catch {
        // Already in-memory — ignore
      }

      return session;
    }

    // Create new shared session
    const session = await this.createSession(workflowRunId, stageRunId, config);
    allocation.sharedSessionId = session.id;
    allocation.stageSessionMap.set(stageRunId, session.id);
    allocation.sharedRefCount = 1;
    if (this.allocationRepo) {
      await this.allocationRepo.updateAllocation(allocation.allocationId, {
        sharedSessionId: session.id,
        sharedRefCount: 1,
      });
      await this.allocationRepo.putStageSession({
        id: generateId(),
        allocationId: allocation.allocationId,
        stageRunId,
        sessionId: session.id,
      });
    }
    return session;
  }

  private async allocatePerStageMode(
    allocation: RunAllocation,
    workflowRunId: string,
    stageRunId: string,
    config?: Partial<CreateConversationParams>,
  ): Promise<Session> {
    // Reuse existing session if already allocated (e.g. after crash recovery + resume)
    const existingSessionId = allocation.stageSessionMap.get(stageRunId);
    if (existingSessionId) {
      const existing = await this.sessionRepo.getById(existingSessionId);
      if (existing) {
        // Ensure SDK conversation handle is in-memory (may have been lost after restart)
        if (existing.conversationId) {
          try {
            await this.harness.resumeConversation(existing.conversationId);
          } catch {
            // Already in-memory — ignore
          }
        }
        return existing;
      }
    }

    const session = await this.createSession(workflowRunId, stageRunId, config);
    allocation.stageSessionMap.set(stageRunId, session.id);
    if (this.allocationRepo) {
      try {
        await this.allocationRepo.putStageSession({
          id: generateId(),
          allocationId: allocation.allocationId,
          stageRunId,
          sessionId: session.id,
        });
      } catch {
        // Roll back in-memory map on DB failure to keep them in sync.
        // Next attempt will create a fresh session (the orphaned SDK session
        // will be reclaimed by the GC/retention sweeper).
        allocation.stageSessionMap.delete(stageRunId);
        throw new SessionAllocationError(
          `Failed to persist stage session mapping for ${stageRunId}`,
        );
      }
    }
    return session;
  }

  private async createSession(
    workflowRunId: string,
    stageRunId: string,
    config?: Partial<CreateConversationParams>,
  ): Promise<Session> {
    const sessionId = generateId();
    const conversationId = `stage-${stageRunId}-${Date.now()}`;
    const now = new Date();

    const session: Session = {
      id: sessionId,
      name: `Stage session (${stageRunId})`,
      status: 'created',
      tags: [],
      conversationId,
      ownerType: 'stage_run',
      ownerId: stageRunId,
      createdAt: now,
      updatedAt: now,
    };

    await this.sessionRepo.create(session);

    // Create the harness conversation. `harnessType` picks the agent provider
    // for this stage; when unset the router falls back to the provider that
    // owns `model`, so a workflow can mix providers across stages.
    //
    // Spread the caller's config wholesale rather than re-enumerating fields:
    // the old allow-list silently dropped reasoningEffort, hooks, plan gates
    // and the agent binding. `conversationId` is overridden last because it is
    // already persisted on the session row above and must win.
    await this.harness.createConversation({
      ...(config ?? {}),
      conversationId,
      streaming: config?.streaming ?? true,
      // Auto-approve all permission requests for workflow stage execution
      // so the Copilot agent can create files, directories, and run commands
      onPermissionRequest: config?.onPermissionRequest ?? (async () => ({ granted: true })),
    });

    // Transition session to active
    await this.sessionRepo.updateStatus(sessionId, 'active');

    await this.eventBus.emit(sessionId, {
      kind: 'session.active',
      data: { sessionId },
    });

    return { ...session, status: 'active', conversationId };
  }

  private async destroySession(sessionId: string): Promise<void> {
    try {
      const session = await this.sessionRepo.getById(sessionId);
      if (session.conversationId) {
        try {
          await this.harness.destroyConversation(session.conversationId);
        } catch {
          // Conversation may already be destroyed
        }
      }
      await this.sessionRepo.updateStatus(sessionId, 'closed');
      await this.sessionRepo.update(sessionId, { closedAt: new Date() });
    } catch {
      // Session may not exist or already be closed
    }
  }
}
