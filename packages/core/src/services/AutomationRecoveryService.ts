// ────────────────────────────────────────────────────────────────
// AutomationRecoveryService — Track A1: boot-time reconciler.
//   Scans for automation_executions rows left in `pending` or
//   `running` after a process crash / restart and drives them to a
//   terminal state based on the aggregate status of their child
//   workflow-runs. Also owns the periodic idempotency-key sweeper.
// ────────────────────────────────────────────────────────────────

import type {
  AgentEvent,
  AutomationExecution,
  AutomationExecutionRun,
  ILogger,
} from '@generatorai/shared';
import type { IWorkflowRunRepository } from '../domain/ports/IWorkflowRunRepository.js';
import type {
  IAutomationRepository,
  IAutomationExecutionRepository,
} from './AutomationService.js';
import type { EventBus } from '../events/EventBus.js';

/** Minimal contract for the idempotency-key repository, so the
 *  reconciler doesn't have to import the concrete Drizzle repo. */
export interface IIdempotencyKeyRepository {
  sweepExpired(): Promise<number>;
}

/** Interval between idempotency-key sweeper ticks. Small enough that
 *  a burst of expired keys clears quickly, large enough that idle
 *  systems don't hammer the DB. */
const DEFAULT_IDEMPOTENCY_SWEEP_MS = 60_000;

/**
 * P0-b — the re-drive hook, wired to `AutomationService.resumeExecution`.
 * Reports whether it took ownership of the execution; `false` means there was
 * nothing left to run and the reconciler should finalise as before.
 */
export type ResumeExecutionFn = (
  executionId: string,
  opts: { activeIterationIndexes?: number[] },
) => Promise<{ resumed: boolean; remaining: number }>;

export class AutomationRecoveryService {
  private idempotencyTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private automationRepo: IAutomationRepository,
    private executionRepo: IAutomationExecutionRepository,
    private workflowRunRepo: IWorkflowRunRepository,
    private eventBus: EventBus,
    private idempotencyRepo: IIdempotencyKeyRepository,
    private logger: ILogger,
    /**
     * P0-b — re-drive callback for interrupted batches. Without it this
     * service only ever FINALISES: a 1000-row batch that died at row 40 was
     * marked `completed` with 40 iterations and the remaining 960 durable
     * slots were never claimed by anyone, which is P0-41 verbatim — the exact
     * defect the durable iteration machinery was built to fix. Optional so
     * embeddings without an `AutomationService` keep the old behaviour.
     */
    private onResumeExecution?: ResumeExecutionFn,
  ) {}

  /**
   * Called from composition-root on startup. Idempotent — safe to
   * call twice. Returns the number of executions moved to a terminal
   * state for observability / smoke tests.
   */
  async recoverOnBoot(): Promise<{ recovered: number; scanned: number }> {
    const startedAt = Date.now();
    // We scan by status via a linear pass — automation_executions is
    // typically small (thousands, not millions) and this only happens
    // once per boot.
    // NOTE: We deliberately do NOT expose a "getByStatus" on the repo
    // to keep the surface small; the sweep here uses the existing
    // per-automation query pattern.
    const automations = await this.automationRepo.getAll();
    let scanned = 0;
    let recovered = 0;
    for (const automation of automations) {
      const executions = await this.executionRepo.getExecutionsByAutomationId(
        automation.id,
      );
      for (const exec of executions) {
        if (exec.status !== 'running' && exec.status !== 'pending') continue;
        scanned++;
        const recoveredExec = await this.recoverOne(exec);
        if (recoveredExec) recovered++;
      }
    }
    const ms = Date.now() - startedAt;
    this.logger.info(
      `[AutomationRecoveryService] Boot recovery: ${recovered}/${scanned} executions moved to terminal state in ${ms}ms`,
    );
    return { recovered, scanned };
  }

  /**
   * Inspect one execution and, if its child workflow runs have all
   * settled, mark the execution completed / failed / cancelled. If
   * children are still active, we leave the execution `running`; the
   * WorkflowRunService's own recovery + polling will drive them and
   * the automation execution will be picked up on the NEXT boot if
   * this process dies again.
   *
   * P0-b — before ANY of that, offer the execution to the resume hook.
   * Finalising an execution that still has unclaimed iteration slots is the
   * data loss: it reports success for work that was never attempted.
   */
  private async recoverOne(exec: AutomationExecution): Promise<boolean> {
    const runs = await this.executionRepo.getExecutionRunsByExecutionId(exec.id);

    // Consult the *current* workflow_run status for each execution-run.
    // Repo status is a snapshot that may lag if the process crashed
    // mid-write, so we always cross-check against workflow_runs.
    const statuses = await Promise.all(
      runs.map(async (run) => this.resolveRunStatus(run)),
    );

    const anyActive = statuses.some((s) => s === 'pending' || s === 'running');

    // ── P0-b: re-drive whatever is left before finalising anything ──
    if (this.onResumeExecution) {
      // Iterations whose workflow run is still live. The workflow engine's
      // recovery drives those, so their slots must keep their claim — reclaiming
      // them here would run the same iteration twice.
      const activeIterationIndexes = runs
        .filter((_run, idx) => statuses[idx] === 'pending' || statuses[idx] === 'running')
        .map((run) => run.iterationIndex);
      try {
        const outcome = await this.onResumeExecution(exec.id, { activeIterationIndexes });
        if (outcome.resumed) {
          this.logger.info(
            `[AutomationRecoveryService] Execution ${exec.id} resumed with ${outcome.remaining} ` +
            `iteration(s) still to run — not finalising`,
          );
          return false;
        }
      } catch (err) {
        // A failed resume must not block the reconciler from settling the
        // execution; falling through is the pre-P0-b behaviour.
        this.logger.warn(
          `[AutomationRecoveryService] Resume of execution ${exec.id} failed: ` +
          `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // No children → the run was interrupted before it could dispatch
    // any workflow runs (and, per the resume attempt above, has no
    // unclaimed iterations left either). Mark failed with a clear reason.
    if (runs.length === 0) {
      await this.executionRepo.updateExecution(exec.id, {
        status: 'failed',
        error: 'Execution was interrupted before any iterations were dispatched',
        completedAt: new Date(),
      });
      this.emitTerminal(exec, 'failed', 'interrupted-before-dispatch');
      return true;
    }

    if (anyActive) {
      // Still have live children — leave `exec.status` alone. The
      // WorkflowRunService's own recovery will drive completions and
      // subsequent boots will pick this execution up when it settles.
      this.logger.debug(
        `[AutomationRecoveryService] Execution ${exec.id} has active children; leaving 'running'`,
      );
      return false;
    }

    // Compute aggregate outcome.
    let completed = 0;
    let failed = 0;
    let cancelled = 0;
    for (const status of statuses) {
      if (status === 'completed') completed++;
      else if (status === 'failed') failed++;
      else if (status === 'cancelled') cancelled++;
    }

    // Update per-run rows so `attempt_count` / status reflect DB
    // ground truth for the UI.
    await Promise.all(
      runs.map(async (run, idx) => {
        const status = statuses[idx]!;
        if (status !== run.status) {
          await this.executionRepo.updateExecutionRun(run.id, { status });
        }
      }),
    );

    // Three-way outcome (item 28). The previous `else → completed` branch
    // reported a batch with 999 failures and 1 success as `completed`, and
    // with it suppressed the failure alert — the same inversion that lived in
    // `AutomationService.driveIterations`.
    let finalStatus: 'completed' | 'failed' | 'cancelled' | 'partial';
    let errorMsg: string | undefined;
    if (cancelled > 0 && completed === 0 && failed === 0) {
      finalStatus = 'cancelled';
    } else if (failed > 0 && completed === 0) {
      finalStatus = 'failed';
      errorMsg = `${failed} of ${runs.length} iterations failed after recovery`;
    } else if (failed > 0) {
      finalStatus = 'partial';
      errorMsg = `${failed} of ${runs.length} iterations failed after recovery (${completed} succeeded)`;
    } else {
      finalStatus = 'completed';
    }

    await this.executionRepo.updateExecution(exec.id, {
      status: finalStatus,
      completedIterations: completed,
      failedIterations: failed,
      error: errorMsg,
      completedAt: new Date(),
    });

    this.emitTerminal(exec, finalStatus, errorMsg);
    return true;
  }

  /**
   * Resolve the *current* status of a child workflow-run by consulting
   * the workflow_runs table (source of truth). Falls back to the last
   *-known execution-run status if the workflow run has been deleted.
   */
  private async resolveRunStatus(
    run: AutomationExecutionRun,
  ): Promise<'completed' | 'failed' | 'cancelled' | 'pending' | 'running'> {
    try {
      if (!run.workflowRunId) throw new Error('workflow run deleted');
      const wfr = await this.workflowRunRepo.getById(run.workflowRunId);
      switch (wfr.status) {
        case 'completed':
          return 'completed';
        case 'failed':
          return 'failed';
        case 'cancelled':
          return 'cancelled';
        case 'running':
        case 'paused':
        case 'starting':
        case 'created':
        case 'cancelling':
          return 'running';
        default:
          return 'pending';
      }
    } catch {
      // Workflow run row missing (deleted underneath us) → treat as
      // failed for the purposes of aggregation; the UI still shows
      // the automation-execution-run record.
      return 'failed';
    }
  }

  private emitTerminal(
    exec: AutomationExecution,
    status: 'completed' | 'failed' | 'cancelled' | 'partial',
    error?: string,
  ): void {
    // `emitGlobal` is async — a synchronous try/catch around it caught
    // nothing. Attach the handler to the promise instead.
    const event: AgentEvent = {
      kind: 'automation_execution.recovered',
      data: {
        executionId: exec.id,
        automationId: exec.automationId,
        finalStatus: status,
        error,
      },
    };
    void this.eventBus.emitGlobal(event).catch((err: unknown) => {
      this.logger.warn(
        `[AutomationRecoveryService] Failed to emit recovery event for ${exec.id}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  // ── Idempotency-key sweeper (Track A3) ─────────────────────────

  /** Start the background sweeper that removes expired idempotency keys. */
  startIdempotencySweeper(intervalMs: number = DEFAULT_IDEMPOTENCY_SWEEP_MS): void {
    if (this.idempotencyTimer) return;
    this.idempotencyTimer = setInterval(() => {
      void this.sweepIdempotencyKeys();
    }, intervalMs);
    // Don't hold the process open just for the sweeper.
    (this.idempotencyTimer as unknown as { unref?: () => void }).unref?.();
  }

  stopIdempotencySweeper(): void {
    if (this.idempotencyTimer) {
      clearInterval(this.idempotencyTimer);
      this.idempotencyTimer = null;
    }
  }

  private async sweepIdempotencyKeys(): Promise<void> {
    try {
      const removed = await this.idempotencyRepo.sweepExpired();
      if (removed > 0) {
        this.logger.debug(`[AutomationRecoveryService] Swept ${removed} expired idempotency keys`);
      }
    } catch (err) {
      this.logger.warn(
        `[AutomationRecoveryService] Idempotency sweeper failed: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
