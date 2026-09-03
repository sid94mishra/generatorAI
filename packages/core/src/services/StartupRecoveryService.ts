// ────────────────────────────────────────────────────────────────
// StartupRecoveryService — recovers interrupted sessions on startup
// ────────────────────────────────────────────────────────────────

import type { ILogger, StageRun } from '@generatorai/shared';
import type { ISessionRepository } from '../domain/ports/IRepositories.js';
import type { IWorkflowRunRepository } from '../domain/ports/IWorkflowRunRepository.js';
import type { IStageRunRepository } from '../domain/ports/IStageRunRepository.js';
import type { IChatRepository } from '../domain/ports/IChatRepository.js';
import type { IAgentHarness } from '../domain/ports/IAgentHarness.js';
import type { EventBus } from '../events/EventBus.js';
import type { SessionAllocator } from './SessionAllocator.js';
import type { DurableExecutionEngine } from './DurableExecutionEngine.js';
import { recordSessionLineage } from './StageExecutionService.js';

/**
 * Optional sandbox cleanup interface. Implemented by `SandboxLifecycleManager`
 * in Phase 1 to reap orphaned Docker containers left behind by a crash.
 * Kept as a minimal structural type here so StartupRecovery doesn't depend
 * on the full SandboxLifecycleManager class.
 */
export interface ISandboxCleaner {
  cleanupOrphans(): Promise<{ destroyed: string[]; failed: string[] }>;
}

export class StartupRecoveryService {
  constructor(
    private sessionRepo: ISessionRepository,
    private harness: IAgentHarness,
    private eventBus: EventBus,
    private logger: ILogger,
    private workflowRunRepo?: IWorkflowRunRepository,
    private stageRunRepo?: IStageRunRepository,
    /** Phase 1, 1.6 — rehydrate SessionAllocator state from DB on boot. */
    private sessionAllocator?: SessionAllocator,
    /** Phase 1, 1.7 — reap orphaned Docker sandbox containers on boot. */
    private sandboxCleaner?: ISandboxCleaner,
    /**
     * DUR-06 — re-drive callback for interrupted runs. Wired to
     * `WorkflowRunService.redriveRun`. When supplied, an interrupted run is
     * auto-resumed: its in-flight stages are reset and the scheduler is
     * re-attached so execution continues from durable DB state — a restart
     * becomes a non-event. When omitted (minimal embeddings), recovery falls
     * back to the prior safe behaviour of parking the run as `paused` for an
     * explicit user resume.
     */
    private onRedriveRun?: (runId: string) => Promise<void>,
    /**
     * Chat repository — used to identify sessions that belong to a Chat so we
     * DON'T eagerly re-hydrate their harness handle at boot. A chat conversation
     * must be resumed WITH its tool set (browser / widget / custom tools), which
     * only `ChatManagementService.sendPrompt` can build. A bare, tool-less
     * resume here would tell the SDK "this session has no tools", poisoning it:
     * the model is then told the tools "are no longer available" and refuses
     * every tool task for the rest of the chat. Skipping chat sessions lets them
     * lazily resume WITH tools on the next prompt instead.
     */
    private chatRepo?: IChatRepository,
  ) {}

  /**
   * X-13 — durable engine, used only to append session-lineage links. Late
   * wired (this constructor is already nine arguments long) and entirely
   * optional: without it recovery behaves exactly as before, it just leaves
   * no record of which session it discarded.
   */
  private durableEngine?: DurableExecutionEngine;

  setDurableEngine(engine: DurableExecutionEngine): void {
    this.durableEngine = engine;
  }

  /** Called once during application initialization. */
  async recover(): Promise<void> {
    // SEC-10 — collect structured counters so a single end-of-recovery log
    // line can summarise exactly what happened. Ops reads this at boot to
    // confirm whether recovery picked up after a crash (non-zero counts)
    // or the last shutdown was clean (all zeros).
    const start = Date.now();
    const summary = {
      runsResumed: 0,
      runsPaused: 0,
      cancellationsCompleted: 0,
      copilotRehydrated: 0,
      copilotRehydrateFailed: 0,
      cancellingSessionsClosed: 0,
      sandboxOrphansDestroyed: 0,
      sandboxOrphansFailed: 0,
      sessionAllocatorRehydrated: false,
      failures: [] as string[],
      durationMs: 0,
    };

    // 1. Restore EventBus sequence counters from DB
    await this.eventBus.restoreCounters();

    // 2. Recover interrupted workflow runs + stage runs (only if repos available)
    if (this.workflowRunRepo && this.stageRunRepo) {
      await this.recoverV2Runs(summary);
    }

    // 3. Re-hydrate harness handles for active/paused sessions
    await this.rehydrateSessions(summary);

    // 4. Rehydrate SessionAllocator from its persistent tables so in-flight
    //    runs don't double-allocate sessions after a restart.
    if (this.sessionAllocator) {
      try {
        await this.sessionAllocator.rehydrate();
        summary.sessionAllocatorRehydrated = true;
        this.logger.info('[Recovery] SessionAllocator rehydrated from DB');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        summary.failures.push(`sessionAllocator: ${msg}`);
        this.logger.warn(`[Recovery] SessionAllocator rehydrate failed: ${msg}`);
      }
    }

    // 5. Reap any sandbox containers left behind by a crash.
    if (this.sandboxCleaner) {
      try {
        const result = await this.sandboxCleaner.cleanupOrphans();
        summary.sandboxOrphansDestroyed = result.destroyed.length;
        summary.sandboxOrphansFailed = result.failed.length;
        if (result.destroyed.length > 0 || result.failed.length > 0) {
          this.logger.info(
            `[Recovery] Sandbox cleanup: destroyed ${result.destroyed.length} orphan(s), ` +
            `${result.failed.length} failed`,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        summary.failures.push(`sandbox: ${msg}`);
        this.logger.warn(`[Recovery] Sandbox cleanup failed: ${msg}`);
      }
    }

    summary.durationMs = Date.now() - start;
    // SEC-10 — single structured summary for ops dashboards / log search.
    this.logger.info('[Recovery] complete', summary);
  }

  /** Recover interrupted workflow runs and stage runs */
  private async recoverV2Runs(summary: RecoverySummaryCounters): Promise<void> {
    const workflowRunRepo = this.workflowRunRepo!;
    const stageRunRepo = this.stageRunRepo!;

    // ── DUR-06: auto-resume interrupted runs ──
    // Instead of parking a crashed run in `paused` for a human to resume,
    // reset its in-flight stages and re-drive from durable DB state so the
    // restart is invisible. The DB is the source of truth; an interrupted
    // stage re-runs from scratch (at-least-once — the accepted durable
    // baseline). Only `running`/`queued` stages are reset; `sleeping`
    // (the durable-sleep sweeper owns it) and `awaiting_input` are left
    // untouched.
    //
    // P0-a — `awaiting_input` is deliberately NOT reset here, and that is
    // correct: an approval that has not happened must stay parked, and
    // resetting the row to `pending` would relaunch the stage and re-ask the
    // human. The transition out of `awaiting_input` belongs to the moment the
    // approval actually arrives — `HitlService.resume()` sees there is no
    // live in-process awaiter (this restart destroyed it), returns the row to
    // `pending` and re-drives the run itself, so the ready sweep picks the
    // stage up. Before that fix resume() wrote `running`, a status no
    // scheduler path relaunches, and the run wedged permanently.
    const runningRuns = await workflowRunRepo.getByStatus(['running', 'starting']);
    for (const run of runningRuns) {
      const interrupted = await stageRunRepo.getByStatus(run.id, ['running', 'queued']);
      for (const stage of interrupted) {
        // resetForRetry: → pending, clears error/startedAt/completedAt,
        // preserves retryCount. Drop the (now-dead) session handle so the
        // re-launch allocates a fresh one rather than reusing a stale id.
        await stageRunRepo.resetForRetry(stage.id);

        // △ W22 — rewind the step counter too. `resetForRetry` does NOT touch
        // `currentStep`, and leaving it at the step that was in flight makes
        // `executeStage` start its prompt loop THERE. The earlier prompts are
        // then skipped by the counter instead of being replayed out of the
        // durable journal — and because the relaunch also allocates a FRESH
        // conversation (the handle below is dropped), the agent is handed
        // prompt N with no memory of prompts 1..N-1 and no replay recap, which
        // is exactly the failure the effect sandwich exists to prevent.
        //
        // Rewinding to 0 puts the decision back in the journal: every settled
        // turn replays out of `entries` (no model call, no tool call, one
        // recap message), and only the turn that genuinely did not settle is
        // re-run or skipped per its replay policy.
        //
        // Unconditional, including embeddings with no durable engine wired:
        // there the stage re-runs from scratch, which is the at-least-once
        // baseline this method's own comment declares above — and strictly
        // better than resuming a fresh, empty conversation at prompt N.
        const patch: Partial<StageRun> = { currentStep: 0 };

        if (stage.sessionId) {
          // X-13 — record the loss BEFORE dropping the handle. This is the
          // one moment where the reason is known, and it is the moment the
          // only pointer to the old session disappears: after the update the
          // row is `sessions.status='closed'` with nothing referring to it,
          // which is why "why did it forget X?" had no answer.
          recordSessionLineage(this.durableEngine, stage.id, {
            event: 'lost',
            sessionId: stage.sessionId,
            reason: 'process restart — the in-process conversation did not survive',
            at: Date.now(),
          });
          patch.sessionId = null as unknown as undefined;
        }

        await stageRunRepo.update(stage.id, patch);
      }

      if (this.onRedriveRun) {
        this.logger.info(
          `[Recovery] Re-driving interrupted workflow run ${run.id} (${interrupted.length} stage(s) reset)`,
        );
        try {
          await this.onRedriveRun(run.id);
          summary.runsResumed += 1;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          summary.failures.push(`redrive ${run.id}: ${msg}`);
          this.logger.warn(`[Recovery] Re-drive failed for run ${run.id}, parking as paused: ${msg}`);
          await this.parkRunAsPaused(run.id, interrupted.map((s) => s.id), summary);
        }
      } else {
        // No re-drive wired — preserve the prior safe behaviour.
        await this.parkRunAsPaused(run.id, interrupted.map((s) => s.id), summary);
      }
    }

    // Complete cancellation of runs that were mid-cancel
    const cancellingRuns = await workflowRunRepo.getByStatus(['cancelling']);
    for (const run of cancellingRuns) {
      this.logger.info(`[Recovery] Completing cancellation for workflow run ${run.id}`);
      const nonTerminalStages = await stageRunRepo.getByStatus(run.id, ['running', 'queued', 'paused']);
      const ids = nonTerminalStages.map((s) => s.id);
      if (ids.length > 0) {
        await stageRunRepo.batchUpdateStatus(ids, 'cancelled');
      }
      await workflowRunRepo.updateStatus(run.id, 'cancelled');
    }

    summary.cancellationsCompleted = cancellingRuns.length;
    this.logger.info(
      `[Recovery] run recovery: ${summary.runsResumed} run(s) re-driven, ` +
      `${summary.runsPaused} parked as paused, ${cancellingRuns.length} cancellation(s) completed`,
    );
  }

  /**
   * Fallback path when a run cannot be auto-resumed (no re-drive wired, or
   * the re-drive threw): park the run + its interrupted stages as `paused`
   * and emit pause events so any connected client learns about it. This is
   * the pre-DUR-06 behaviour, retained as a safety net.
   */
  private async parkRunAsPaused(
    runId: string,
    interruptedStageIds: string[],
    summary: RecoverySummaryCounters,
  ): Promise<void> {
    const workflowRunRepo = this.workflowRunRepo!;
    const stageRunRepo = this.stageRunRepo!;
    await workflowRunRepo.updateStatus(runId, 'paused');
    await workflowRunRepo.update(runId, {
      error: 'Workflow was interrupted by a server restart and automatically paused. Resume to continue.',
    });
    if (interruptedStageIds.length > 0) {
      await stageRunRepo.batchUpdateStatus(interruptedStageIds, 'paused');
    }
    await this.eventBus.emitGlobal({
      kind: 'workflow_run.paused',
      data: { workflowRunId: runId, reason: 'crash_recovery' },
    });
    for (const stageId of interruptedStageIds) {
      await this.eventBus.emitGlobal({
        kind: 'stage_run.paused',
        data: { stageRunId: stageId, workflowRunId: runId, reason: 'crash_recovery' },
      });
    }
    summary.runsPaused += 1;
  }

  /** Re-hydrate harness in-memory handles for sessions that still need them */
  private async rehydrateSessions(summary: RecoverySummaryCounters): Promise<void> {
    // Find sessions with active/paused status that need SDK handles
    const sessionsToResume = await this.sessionRepo.getByStatus(['active', 'paused']);

    // Build the set of session IDs owned by a Chat. These must be resumed WITH
    // their tool set, which only `ChatManagementService.sendPrompt` can build,
    // so we SKIP them here and let them lazily resume (with tools) on the next
    // prompt. Eagerly resuming them tool-less poisons the SDK session — the
    // model gets told the tools "are no longer available" and refuses tool
    // tasks for the rest of the chat.
    const chatSessionIds = new Set<string>();
    if (this.chatRepo) {
      try {
        const [active, archived] = await Promise.all([
          this.chatRepo.getByStatus('active'),
          this.chatRepo.getByStatus('archived'),
        ]);
        for (const c of [...active, ...archived]) chatSessionIds.add(c.sessionId);
      } catch (err) {
        this.logger.warn(`[Recovery] Could not load chats to skip chat-session rehydration: ${(err as Error).message}`);
      }
    }

    for (const session of sessionsToResume) {
      if (chatSessionIds.has(session.id)) {
        this.logger.debug?.(`[Recovery] Skipping eager rehydration of chat session ${session.id} — it will resume WITH tools on the next prompt`);
        continue;
      }
      if (session.conversationId) {
        try {
          await this.harness.resumeConversation(session.conversationId);
          summary.copilotRehydrated += 1;
          this.logger.info(`[Recovery] Re-hydrated session ${session.id} (conversation ${session.conversationId})`);
        } catch {
          summary.copilotRehydrateFailed += 1;
          this.logger.warn(`[Recovery] Could not re-hydrate session ${session.id}, marking as closed`);
          await this.sessionRepo.updateStatus(session.id, 'closed');
        }
      }
    }

    // Clean up sessions stuck in 'closing' state
    const closingSessions = await this.sessionRepo.getByStatus(['closing']);
    for (const session of closingSessions) {
      if (session.conversationId) {
        try {
          await this.harness.destroyConversation(session.conversationId);
        } catch {
          // Best-effort cleanup
        }
      }
      await this.sessionRepo.updateStatus(session.id, 'closed');
      summary.cancellingSessionsClosed += 1;
      this.logger.info(`[Recovery] Completed cleanup for closing session ${session.id}`);
    }
  }
}

/** SEC-10 — shape of the counters accumulated across `recover()`. */
interface RecoverySummaryCounters {
  runsResumed: number;
  runsPaused: number;
  cancellationsCompleted: number;
  copilotRehydrated: number;
  copilotRehydrateFailed: number;
  cancellingSessionsClosed: number;
  sandboxOrphansDestroyed: number;
  sandboxOrphansFailed: number;
  sessionAllocatorRehydrated: boolean;
  failures: string[];
  durationMs: number;
}
