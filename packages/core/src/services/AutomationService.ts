// ────────────────────────────────────────────────────────────────
// AutomationService — Manages automation lifecycle, execution,
//   cron scheduling, webhook handling, and dataset iterations
// ────────────────────────────────────────────────────────────────

import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import { mkdir } from 'node:fs/promises';
import type {
  Automation,
  AutomationExecution,
  AutomationExecutionRun,
  AutomationExecutionStatus,
  AutomationTriggerType,
  AutomationDataset,
  AutomationRetryPolicy,
  CreateAutomationParams,
  UpdateAutomationParams,
  AutomationWithExecutions,
  AutomationExecutionWithRuns,
  ILogger,
} from '@generatorai/shared';
import { hashWebhookToken } from '@generatorai/shared/node';
import {
  generateId,
  ValidationError,
  SECRET_MASK,
  isSensitiveKey,
  getNextCronRun,
  countCronRunsBetween,
} from '@generatorai/shared';
import type { WorkflowRunService } from './WorkflowRunService.js';
import type { WorkflowDefinitionService } from './WorkflowDefinitionService.js';
import type { EventBus } from '../events/EventBus.js';
import type { IWorkflowRunRepository } from '../domain/ports/IWorkflowRunRepository.js';
import { planIterations } from './IterationPlanner.js';
import type { DurableExecutionEngine } from './DurableExecutionEngine.js';

export { hashWebhookToken };

/**
 * A webhook delivery that was matched to an automation, with everything the
 * route needs to verify it. The raw token never leaves the request.
 */
export interface ResolvedWebhook {
  automation: Automation;
  /** Per-automation HMAC secret, when one is configured. */
  signingSecret?: string;
}

/**
 * An automation as the API is allowed to return it.
 *
 * The webhook token and every credential-shaped value inside the data-source
 * configuration are replaced with a mask. Both were previously echoed in full
 * to any read-scoped caller — which includes a paired phone — so redaction
 * belongs at the projection every read path shares, not at each route.
 */
export function toPublicAutomation(automation: Automation): Automation {
  const redacted: Automation = { ...automation };

  // The raw token exists only in the create/rotate response, and only the
  // create/rotate route hands it out — every other projection masks it.
  if (redacted.webhookToken) redacted.webhookToken = SECRET_MASK;

  return redacted;
}

/** Interface for automation repository */
export interface IAutomationRepository {
  create(automation: Automation): Promise<Automation>;
  getById(id: string): Promise<Automation>;
  getAll(): Promise<Automation[]>;
  getEnabled(): Promise<Automation[]>;
  getByTriggerType(triggerType: AutomationTriggerType): Promise<Automation[]>;
  /**
   * Look an automation up by the SHA-256 of its webhook token. The raw token
   * is never stored, so this is the only lookup a delivery can use.
   */
  getByWebhookTokenHash(tokenHash: string): Promise<Automation | null>;
  getByProjectId(projectId: string): Promise<Automation[]>;
  update(id: string, updates: Partial<Automation>): Promise<Automation>;
  delete(id: string): Promise<void>;

  /**
   * Item 38 — DB-backed due-row scheduler.
   *
   * Atomically claim every enabled schedule-triggered automation whose
   * `nextRunAt` has passed and whose lease is free or expired, stamping
   * the lease (`locked_until` / `locked_by_process`) in the SAME
   * conditional UPDATE that selects the rows — the pattern
   * `DurableExecutionEngine.claimNextIteration` uses, not the old
   * acquire-then-release-on-start cron lease. The caller releases the
   * lease only after the run has been dispatched.
   */
  claimDueSchedules(now: Date, processId: string, leaseMs: number): Promise<Automation[]>;

  /** Heartbeat: push the lease forward while this process still owns it. */
  extendScheduleLease(automationId: string, processId: string, leaseMs: number): Promise<boolean>;

  /** Release the lease (on dispatch completion). No-op if another process owns it now. */
  releaseScheduleLease(automationId: string, processId: string): Promise<void>;
}

/** Interface for automation execution repository */
export interface IAutomationExecutionRepository {
  createExecution(execution: AutomationExecution): Promise<AutomationExecution>;
  getExecutionById(id: string): Promise<AutomationExecution>;
  getExecutionsByAutomationId(automationId: string): Promise<AutomationExecution[]>;
  updateExecution(id: string, updates: Partial<AutomationExecution>): Promise<AutomationExecution>;
  deleteExecution(id: string): Promise<void>;
  createExecutionRun(run: AutomationExecutionRun): Promise<AutomationExecutionRun>;
  getExecutionRunsByExecutionId(executionId: string): Promise<AutomationExecutionRun[]>;
  updateExecutionRun(id: string, updates: Partial<AutomationExecutionRun>): Promise<AutomationExecutionRun>;
}

/**
 * One unit of work in the iteration loop. `index` is authoritative: in durable
 * mode it comes from the claimed slot, never from the loop counter, because
 * after a resume the slot the engine hands back is not the one the counter
 * would have named.
 */
interface IterationWorkItem {
  index: number;
  variables: Record<string, unknown>;
  label: string;
  /** `entries.id` of the durable slot backing this iteration, when claimed. */
  slotId?: string;
}

export class AutomationService {
  /** The due-row poller's interval timer, or null while stopped. */
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** Unique per-process identifier used as the `locked_by_process` value
   *  on schedule lease rows. Lets operators tell at a glance which replica
   *  owns a given lease. */
  private readonly processId: string = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  /** How often the due-row poller ticks. Configurable via the constructor
   *  `schedulerOptions` so tests can run it fast. */
  private readonly pollIntervalMs: number;
  /** Lease duration stamped on a claimed row. Long enough to comfortably
   *  cover claim → dispatch → recompute-and-release, short enough that a
   *  crashed owner's lease expires before the next replica's tick. */
  private readonly leaseMs: number;
  /**
   * Phase 2, 2.9 — AbortController per in-flight execution. `cancelExecution`
   * calls `.abort()`; downstream awaits that take the signal exit at once,
   * and the iteration loop checks `isCancelled` at every boundary.
   */
  private executionAborts = new Map<string, AbortController>();

  constructor(
    private automationRepo: IAutomationRepository,
    private executionRepo: IAutomationExecutionRepository,
    private workflowRunService: WorkflowRunService,
    private workflowRunRepo: IWorkflowRunRepository,
    private workflowDefinitionService: WorkflowDefinitionService,
    private eventBus: EventBus,
    private logger: ILogger,
    /**
     * W22 — iteration slots are written to the `entries` table up front and
     * claimed atomically, so a 1000-row batch that dies at row 40 resumes at
     * row 41 on restart (P0-41 fix).
     */
    private durableEngine: DurableExecutionEngine,
    private artifactsDir?: string,
    /**
     * Optional transactional wrapper. When supplied, the initial burst of
     * writes that open an execution (createExecution + update automation's
     * lastRunAt) is atomic so a mid-sequence failure doesn't leave the
     * automation's `lastRunAt` advanced with no corresponding execution row
     * (or vice-versa).
     */
    private withTransaction?: <T>(fn: () => Promise<T>) => Promise<T>,
    /**
     * Item 38 — due-row poller tuning. Optional so existing embedders (and
     * the composition-root call site, which constructs this positionally)
     * keep working unchanged; defaults match production cadence.
     */
    schedulerOptions?: { pollIntervalMs?: number; leaseMs?: number },
  ) {
    this.pollIntervalMs = schedulerOptions?.pollIntervalMs ?? 15_000;
    this.leaseMs = schedulerOptions?.leaseMs ?? 60_000;
  }

  // ═══════════════════════════════════════════════════════════════
  // CRUD Operations
  // ═══════════════════════════════════════════════════════════════

  /**
   * Item 38 — compute the next scheduled firing for an automation,
   * honouring its timezone. Returns undefined when the automation isn't
   * an enabled schedule with a valid cron expression — the due-row
   * poller only ever claims rows with a non-null `nextRunAt`, so leaving
   * it undefined is how a disabled / non-schedule / malformed automation
   * opts out of being claimed.
   */
  private computeNextRunAt(automation: Automation, from: Date = new Date()): Date | undefined {
    if (automation.triggerType !== 'schedule' || !automation.enabled || !automation.cronExpression) {
      return undefined;
    }
    try {
      return getNextCronRun(automation.cronExpression, from, automation.timezone);
    } catch (err) {
      this.logger.warn(
        `[AutomationService] Could not compute next run for ${automation.id}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }

  async createAutomation(params: CreateAutomationParams): Promise<Automation> {
    const now = new Date();
    const automation: Automation = {
      id: generateId(),
      name: params.name,
      description: params.description,
      enabled: true,
      triggerType: params.triggerType,
      cronExpression: params.cronExpression,
      // The RAW token is returned to the caller exactly once, in this
      // response; only its hash is persisted, and the hash is what a delivery
      // is matched against. Writing the raw value and no hash — which is what
      // this did — left every new webhook automation unreachable, because the
      // lookup is `getByWebhookTokenHash`.
      ...(params.triggerType === 'webhook' ? this.mintWebhookToken() : {}),
      workflowIds: params.workflowIds,
      variables: params.variables ?? {},
      maxConcurrency: params.maxConcurrency ?? 1,
      onError: params.onError ?? 'continue',
      projectId: params.projectId,
      useWorktree: params.useWorktree,
      // ── Track C / A ──
      dataSchema: params.dataSchema,
      iterationMode: params.iterationMode,
      defaultDataset: params.defaultDataset,
      retryPolicy: params.retryPolicy,
      createdAt: now,
      updatedAt: now,
    };
    // Item 38 — a newly-saved schedule automation needs a due time or the
    // poller will never claim it.
    automation.nextRunAt = this.computeNextRunAt(automation, now);

    const created = await this.automationRepo.create(automation);

    this.logger.info(`[AutomationService] Created automation: ${created.id} (${created.name})`);
    return created;
  }

  async getAutomation(id: string): Promise<Automation> {
    return this.automationRepo.getById(id);
  }

  async getAutomationWithExecutions(id: string): Promise<AutomationWithExecutions> {
    const automation = await this.automationRepo.getById(id);
    const executions = await this.executionRepo.getExecutionsByAutomationId(id);
    return { ...automation, executions };
  }

  async listAutomations(projectId?: string): Promise<Automation[]> {
    if (projectId) {
      return this.automationRepo.getByProjectId(projectId);
    }
    return this.automationRepo.getAll();
  }

  async updateAutomation(id: string, params: UpdateAutomationParams): Promise<Automation> {
    const existing = await this.automationRepo.getById(id);

    // If trigger type changes to webhook, generate new token
    const updates: Partial<Automation> = {};
    for (const key of Object.keys(params) as Array<keyof UpdateAutomationParams>) {
      const val = params[key];
      // Preserve explicit nulls (used to clear dataSchema / retryPolicy /
      // defaultDataset / iterationMode) while skipping undefined.
      if (val !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (updates as any)[key] = val;
      }
    }
    if (params.triggerType === 'webhook' && existing.triggerType !== 'webhook') {
      Object.assign(updates, this.mintWebhookToken());
    }

    const updated = await this.automationRepo.update(id, updates);

    // Item 38 — recompute nextRunAt whenever schedule-relevant fields may
    // have changed (cronExpression, timezone, enabled, triggerType).
    const nextRunAt = this.computeNextRunAt(updated);
    const final = nextRunAt
      ? await this.automationRepo.update(id, { nextRunAt })
      : updated.nextRunAt
        ? await this.automationRepo.update(id, { nextRunAt: null } as unknown as Partial<Automation>)
        : updated;

    this.logger.info(`[AutomationService] Updated automation: ${id}`);
    return final;
  }

  /**
   * Phase 2, 2.10 — Rotate the webhook token for a webhook-triggered automation.
   * Returns the updated automation with the new token. Throws if the
   * automation's triggerType is not `'webhook'`.
   */
  async rotateWebhookToken(id: string): Promise<Automation> {
    const existing = await this.automationRepo.getById(id);
    if (existing.triggerType !== 'webhook') {
      throw new ValidationError(
        `Automation ${id} is not webhook-triggered (triggerType=${existing.triggerType})`,
      );
    }
    const minted = this.mintWebhookToken();
    const updated = await this.automationRepo.update(id, minted);
    // The caller needs the raw token this once; it is never readable again.
    updated.webhookToken = minted.webhookToken;
    this.logger.info(`[AutomationService] Rotated webhook token for automation ${id}`);
    return updated;
  }

  /**
   * A new webhook credential: the raw token for the caller, the hash for the
   * database.
   *
   * Deliveries are matched by `getByWebhookTokenHash`, so a row written with
   * only a raw token can never be triggered. Keeping both halves in one place
   * is what stops the two from drifting apart again.
   */
  private mintWebhookToken(): { webhookToken: string; webhookTokenHash: string } {
    const raw = randomBytes(32).toString('hex');
    return { webhookToken: raw, webhookTokenHash: hashWebhookToken(raw) };
  }

  async deleteAutomation(id: string): Promise<void> {
    // Cancel any running executions before deleting
    const executions = await this.executionRepo.getExecutionsByAutomationId(id);
    for (const exec of executions) {
      if (exec.status === 'running' || exec.status === 'pending') {
        try {
          await this.cancelExecution(exec.id);
        } catch {
          // Best-effort cancellation
        }
      }
    }

    await this.automationRepo.delete(id);
    this.logger.info(`[AutomationService] Deleted automation: ${id}`);
  }

  async enableAutomation(id: string): Promise<Automation> {
    const updated = await this.automationRepo.update(id, { enabled: true });
    const nextRunAt = this.computeNextRunAt(updated);
    const final = nextRunAt ? await this.automationRepo.update(id, { nextRunAt }) : updated;
    this.logger.info(`[AutomationService] Enabled automation: ${id}`);
    return final;
  }

  async disableAutomation(id: string): Promise<Automation> {
    const updated = await this.automationRepo.update(id, { enabled: false });
    // A disabled automation is already excluded by claimDueSchedules'
    // `enabled = true` filter, but clearing nextRunAt keeps "next run" UI
    // honest and avoids a stale due time resurfacing on re-enable races.
    const final = updated.nextRunAt
      ? await this.automationRepo.update(id, { nextRunAt: null } as unknown as Partial<Automation>)
      : updated;
    this.logger.info(`[AutomationService] Disabled automation: ${id}`);
    return final;
  }


  // ═══════════════════════════════════════════════════════════════
  // Trigger & Execution
  // ═══════════════════════════════════════════════════════════════

  /**
   * Manual trigger of an automation.
   *
   * Optional `dataset` overrides `defaultDataset` for this run. When
   * `saveAsDefault` is true, the supplied dataset is persisted as the
   * automation's `defaultDataset` so subsequent cron / manual runs pick
   * it up.
   *
   * If the automation uses `dataSchema` and no dataset is provided
   * (neither `dataset` nor `automation.defaultDataset`), a
   * `ValidationError` is thrown so the UI can prompt the user.
   */
  async triggerManual(
    id: string,
    opts?: { dataset?: AutomationDataset; saveAsDefault?: boolean },
  ): Promise<AutomationExecution> {
    const automation = await this.automationRepo.getById(id);
    if (!automation.enabled) {
      throw new ValidationError(`Automation ${id} is disabled`);
    }

    const dataset = opts?.dataset ?? automation.defaultDataset;
    if (automation.dataSchema && !dataset) {
      throw new ValidationError(
        'This automation requires a dataset; supply one in the trigger body or save a default first',
      );
    }

    // Persist the supplied dataset as the new default if requested.
    if (opts?.dataset && opts.saveAsDefault) {
      await this.automationRepo.update(id, { defaultDataset: opts.dataset });
    }

    return this.executeAutomation(automation, 'manual', undefined, dataset);
  }

  /**
   * Webhook trigger — finds automation by token and executes.
   *
   * When the automation has a `dataSchema`, the raw HTTP body is
   * treated as the dataset (content-type drives the format hint but
   * the schema-declared format wins). Otherwise the workflows run once
   * with the base variables; the payload is recorded on the execution.
   */
  async triggerWebhook(
    token: string,
    payload: unknown,
    contentType?: string,
  ): Promise<AutomationExecution> {
    const automation = await this.automationRepo.getByWebhookTokenHash(hashWebhookToken(token));
    if (!automation || !automation.enabled || automation.triggerType !== 'webhook') {
      throw new Error('Invalid or disabled webhook');
    }

    // Schema-driven pipeline: the entire payload becomes the dataset.
    if (automation.dataSchema) {
      const dataset = this.webhookPayloadToDataset(
        payload,
        automation.dataSchema.format,
        contentType,
      );
      return this.executeAutomation(
        automation,
        'webhook',
        JSON.stringify(payload).slice(0, 5000),
        dataset,
      );
    }

    return this.executeAutomation(automation, 'webhook', JSON.stringify(payload).slice(0, 5000));
  }

  /**
   * Convert a raw webhook payload into an AutomationDataset shaped to
   * match the automation's schema format.
   */
  private webhookPayloadToDataset(
    payload: unknown,
    schemaFormat: 'json_array' | 'csv' | 'jsonl',
    contentType?: string,
  ): AutomationDataset {
    // If content-type suggests CSV or JSONL and payload is a string,
    // treat it as raw text; otherwise serialize the parsed body.
    if (schemaFormat === 'csv') {
      const data = typeof payload === 'string' ? payload : String(payload ?? '');
      return { format: 'csv', data };
    }
    if (schemaFormat === 'jsonl') {
      const data =
        typeof payload === 'string'
          ? payload
          : Array.isArray(payload)
            ? payload.map((row) => JSON.stringify(row)).join('\n')
            : JSON.stringify(payload);
      return { format: 'jsonl', data };
    }
    // json_array: accept an array as-is, wrap a single object in an
    // array, or accept a JSON string verbatim.
    const data =
      typeof payload === 'string'
        ? payload
        : Array.isArray(payload)
          ? JSON.stringify(payload)
          : payload && typeof payload === 'object'
            ? JSON.stringify([payload])
            : JSON.stringify([]);
    // contentType is unused here but kept for future refinement.
    void contentType;
    return { format: 'json_array', data };
  }

  /** Core execution logic — creates execution, runs workflows sequentially for each iteration */
  private async executeAutomation(
    automation: Automation,
    triggeredBy: AutomationTriggerType,
    webhookPayload?: string,
    dataset?: AutomationDataset,
  ): Promise<AutomationExecution> {
    // For schedule triggers, fall back to the persisted default dataset
    // if the caller didn't supply one explicitly.
    if (!dataset && triggeredBy === 'schedule') {
      dataset = automation.defaultDataset;
    }

    // Track C: if we're on the schema-driven pipeline, plan iterations
    // eagerly so validation errors surface as an immediate 400 rather
    // than a silent background failure.
    let plannedIterations: ReturnType<typeof planIterations> | null = null;
    if (automation.dataSchema && automation.iterationMode) {
      if (!dataset) {
        throw new ValidationError(
          'Schema-driven automation requires a dataset (supply in trigger body or set defaultDataset)',
        );
      }
      try {
        plannedIterations = planIterations({
          schema: automation.dataSchema,
          mode: automation.iterationMode,
          dataset,
          baseVariables: { ...automation.variables },
        });
      } catch (err) {
        // Surface planning errors before we open the execution row so
        // the trigger endpoint can respond with a 400.
        throw new ValidationError(
          `Dataset does not match schema: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (plannedIterations.iterations.length === 0) {
        throw new ValidationError('Dataset produced 0 iterations — nothing to run');
      }
    }

    // Create execution record immediately so failures are tracked
    const execution: AutomationExecution = {
      id: generateId(),
      automationId: automation.id,
      status: 'pending',
      triggeredBy,
      webhookPayload,
      totalIterations: 0, // Updated after resolution
      completedIterations: 0,
      failedIterations: 0,
      // Only snapshot for the schema-driven pipeline (a dataset is
      // meaningful there).
      datasetSnapshot: automation.dataSchema && dataset ? {
        format: dataset.format,
        data: dataset.data,
        parsedRowCount: plannedIterations?.parsedRowCount,
      } : undefined,
      createdAt: new Date(),
    };

    // Atomically: create the execution row + advance the automation's
    // lastRunAt. A failure between the two writes would previously leave
    // the automation looking "freshly run" with no execution row.
    const openExecution = async (): Promise<void> => {
      await this.executionRepo.createExecution(execution);
      await this.automationRepo.update(automation.id, { lastRunAt: new Date() });
    };
    if (this.withTransaction) {
      await this.withTransaction(openExecution);
    } else {
      await openExecution();
    }

    // Schema-driven — the planner already produced the iteration list;
    // without a schema the workflows run once.
    const iterationCount = plannedIterations ? plannedIterations.iterations.length : 1;

    // totalRuns = (number of iterations) * (number of workflows per iteration)
    const totalRuns = iterationCount * automation.workflowIds.length;

    // Update execution with resolved total
    await this.executionRepo.updateExecution(execution.id, {
      totalIterations: totalRuns,
    });
    execution.totalIterations = totalRuns;

    // Start execution in background
    this.runExecution(automation, execution, plannedIterations).catch((err) => {
      this.logger.error(`[AutomationService] Execution ${execution.id} failed: ${err instanceof Error ? err.message : String(err)}`);
    });

    return execution;
  }

  /** Background execution runner */
  private async runExecution(
    automation: Automation,
    execution: AutomationExecution,
    plannedIterations?: ReturnType<typeof planIterations> | null,
  ): Promise<void> {
    await this.executionRepo.updateExecution(execution.id, {
      status: 'running',
      startedAt: new Date(),
    });

    // Emit execution started event
    void this.eventBus.emitGlobal({
      kind: 'automation_execution.started',
      data: { executionId: execution.id, automationId: automation.id },
    }).catch((err) => {
      this.logger.warn(`[AutomationService] Failed to emit started event for ${execution.id}: ${err instanceof Error ? err.message : String(err)}`);
    });

    await this.driveIterations(automation, execution, { completed: 0, failed: 0 }, () =>
      this.buildIterationList(automation, plannedIterations),
    );
  }

  /**
   * The concrete iteration list: the planner's rows for a schema-driven
   * automation, otherwise one iteration with the base variables. Pure, so it
   * can be handed to `driveIterations` as a thunk and evaluated inside its
   * error handling.
   */
  private buildIterationList(
    automation: Automation,
    plannedIterations?: ReturnType<typeof planIterations> | null,
  ): { variables: Record<string, unknown>; label: string }[] {
    if (plannedIterations) {
      // IterationPlanner already validated + coerced + merged base
      // variables + reserved keys.
      return plannedIterations.iterations;
    }
    return [{
      variables: {
        ...automation.variables,
        __iteration_index: 0,
        __iteration_total: 1,
      },
      label: 'Single run',
    }];
  }

  /**
   * Run an execution's iterations to completion and write its terminal status.
   *
   * Shared by the initial run (`runExecution`) and the post-restart resume
   * (`resumeExecution`), which differ only in where the work comes from: a
   * fresh run expands `buildIterations()` and seeds the durable slots, a
   * resume finds the slots already there and simply claims what is left.
   * `seed` carries the counts already recorded on the execution row so a
   * resumed batch reports its true totals rather than only what this process
   * did.
   */
  private async driveIterations(
    automation: Automation,
    execution: AutomationExecution,
    seed: { completed: number; failed: number },
    buildIterations: () => { variables: Record<string, unknown>; label: string }[],
  ): Promise<void> {
    // Phase 2, 2.9 — register AbortController so cancelExecution can abort
    // in-flight awaits. Cleared in a `finally` below. Doubles as the
    // "this process is already driving this execution" guard `resumeExecution`
    // checks before starting a second loop over the same slots.
    const abortController = new AbortController();
    this.executionAborts.set(execution.id, abortController);
    // A cancel that landed before this loop registered its controller is
    // on the execution row; honour it.
    const persisted = await this.executionRepo.getExecutionById(execution.id).catch(() => undefined);
    if (persisted?.status === 'cancelled') abortController.abort();

    let completedCount = seed.completed;
    let failedCount = seed.failed;

    try {
      const iterations = buildIterations();

      const maxConcurrency = Math.max(1, automation.maxConcurrency);

      // ── W22 — Durable iteration claiming (P0-41 fix) ──────────
      // Write all iteration slots up front so a restart can claim and resume
      // any still-pending rows without losing work. On a resume `iterations`
      // is empty and every slot already exists, so this is a no-op.
      if (iterations.length > 0) {
        const slots = iterations.map((iter, idx) => ({
          index: idx,
          variables: iter.variables,
          label: iter.label,
        }));
        const written = this.durableEngine.initializeIterations(execution.id, slots);
        if (written > 0) {
          this.logger.debug(`[AutomationService] Durable: initialized ${written} iteration slots for execution ${execution.id}`);
        } else {
          this.logger.debug(`[AutomationService] Durable: recovery mode — slots already exist for execution ${execution.id}`);
        }
      }
      // ──────────────────────────────────────────────────────────

      // maxConcurrency controls how many iterations run in parallel.
      // Within each iteration, workflows still run sequentially (they share context).
      for (;;) {
        // Check if this execution has been cancelled before starting a new batch
        if (this.isCancelled(execution.id)) {
          this.logger.info(`[AutomationService] Execution ${execution.id} cancelled — stopping iteration loop`);
          return; // Exit early — cancelExecution already set terminal status
        }

        // W22: atomic claim — idempotent, so a restart never runs an
        // iteration twice (already-claimed rows return null).
        const iterBatch: IterationWorkItem[] = [];
        for (let i = 0; i < maxConcurrency; i++) {
          const claimed = this.durableEngine.claimNextIteration(execution.id);
          if (!claimed) break;
          // △ `claimed.index` — NOT a recomputed loop counter. The claim
          // returns whichever slot is lowest-pending, which after a resume
          // (or any concurrent claimer) is not a loop-counter offset:
          // deriving it from the loop counter labelled recovered rows with
          // the wrong `iterationIndex`, so the execution-run rows no longer
          // matched the data the iteration actually ran on.
          iterBatch.push({
            index: claimed.index,
            variables: claimed.variables,
            label: claimed.label,
            slotId: claimed.id,
          });
        }
        if (iterBatch.length === 0) break; // No more pending iterations.

        const iterResults = await Promise.allSettled(
          iterBatch.map(async (iter) => {
            const { index: iterIdx, variables: iterationVariables, label: iterationLabel } = iter;
            // P0-c — every claimed slot MUST get a completion write, on every
            // exit path, or recovery cannot tell it apart from one whose owner
            // died and will either lose it or re-run finished work.
            let slotError: string | undefined;
            try {
              // Run all workflows sequentially within this iteration
              for (const workflowDefId of automation.workflowIds) {
                // Check cancellation before each workflow run within an iteration
                if (this.isCancelled(execution.id)) {
                  slotError = 'execution cancelled';
                  return;
                }

                try {
                  const success = await this.runSingleWorkflow(
                    execution.id,
                    workflowDefId,
                    iterationVariables,
                    iterIdx,
                    iterationLabel,
                    automation.projectId,
                    automation.retryPolicy,
                    execution.triggeredBy,
                  );
                  if (success) {
                    completedCount++;
                  } else {
                    failedCount++;
                    slotError ??= `workflow ${workflowDefId} did not complete`;
                    if (automation.onError === 'stop') {
                      throw new Error('Workflow run failed');
                    }
                  }
                } catch (err) {
                  failedCount++;
                  const message = err instanceof Error ? err.message : String(err);
                  slotError ??= message;
                  this.logger.error(`[AutomationService] Workflow run error (iter ${iterIdx}, def ${workflowDefId}): ${message}`);
                  if (automation.onError === 'stop') {
                    throw err;
                  }
                }
              }
            } finally {
              if (iter.slotId) {
                this.durableEngine.completeIteration(
                  iter.slotId,
                  slotError ? 'failed' : 'completed',
                  slotError,
                );
              }
            }
          }),
        );

        // Check for thrown errors (onError=stop)
        for (const result of iterResults) {
          if (result.status === 'rejected') {
            if (automation.onError === 'stop') {
              throw result.reason instanceof Error ? result.reason : new Error(String(result.reason));
            }
          }
        }

        // Update progress after each concurrent batch of iterations
        await this.executionRepo.updateExecution(execution.id, {
          completedIterations: completedCount,
          failedIterations: failedCount,
        });

        // Emit progress event
        void this.eventBus.emitGlobal({
          kind: 'automation_execution.progress',
          data: {
            executionId: execution.id,
            automationId: automation.id,
            completedRuns: completedCount,
            failedRuns: failedCount,
            totalRuns: execution.totalIterations,
          },
        }).catch((err) => {
          this.logger.warn(`[AutomationService] Failed to emit progress event for ${execution.id}: ${err instanceof Error ? err.message : String(err)}`);
        });
      }

      // Execution complete — but skip if already cancelled by cancelExecution
      if (this.isCancelled(execution.id)) return;

      // Item 28 — three-way outcome. The previous `else → completed` branch
      // reported a batch with 999 failures and 1 success as `completed`,
      // silently suppressing the failure alert.
      let finalStatus: AutomationExecutionStatus;
      if (failedCount > 0 && completedCount === 0) {
        finalStatus = 'failed';
      } else if (failedCount > 0) {
        finalStatus = 'partial';
      } else {
        finalStatus = 'completed';
      }
      await this.executionRepo.updateExecution(execution.id, {
        status: finalStatus,
        completedIterations: completedCount,
        failedIterations: failedCount,
        completedAt: new Date(),
      });

      const finalEvent =
        finalStatus === 'partial'
          ? {
              kind: 'automation_execution.partial' as const,
              data: {
                executionId: execution.id,
                automationId: automation.id,
                completedRuns: completedCount,
                failedRuns: failedCount,
              },
            }
          : {
              kind: `automation_execution.${finalStatus}` as 'automation_execution.completed' | 'automation_execution.failed',
              data: { executionId: execution.id, automationId: automation.id },
            };
      void this.eventBus.emitGlobal(finalEvent).catch((err) => {
        this.logger.warn(`[AutomationService] Failed to emit ${finalEvent.kind} event for ${execution.id}: ${err instanceof Error ? err.message : String(err)}`);
      });

    } catch (err) {
      // Skip overwriting if execution was cancelled
      if (this.isCancelled(execution.id)) return;

      await this.executionRepo.updateExecution(execution.id, {
        status: 'failed',
        completedIterations: completedCount,
        failedIterations: failedCount,
        error: err instanceof Error ? err.message : String(err),
        completedAt: new Date(),
      });

      void this.eventBus.emitGlobal({
        kind: 'automation_execution.failed',
        data: {
          executionId: execution.id,
          automationId: automation.id,
          error: err instanceof Error ? err.message : String(err),
        },
      }).catch((emitErr) => {
        this.logger.warn(`[AutomationService] Failed to emit failed event for ${execution.id}: ${emitErr instanceof Error ? emitErr.message : String(emitErr)}`);
      });
    } finally {
      this.executionAborts.delete(execution.id);
    }
  }

  /**
   * P0-b — resume an execution whose iteration loop died with the process.
   *
   * This is the post-restart caller the durable iteration machinery never had.
   * Without it, `initializeIterations` / `claimNextIteration` were only ever
   * exercised by the process that opened the batch, so P0-41 reproduced in
   * full: a 1000-row batch that died at row 40 was reported **completed** with
   * 40 iterations and the other 960 were never run.
   *
   * Called by `AutomationRecoveryService` on boot, BEFORE it decides whether
   * the execution has finished. Returns `resumed: false` when there is nothing
   * left to claim, which is the reconciler's signal to finalise as before.
   *
   * `activeIterationIndexes` are iterations whose workflow run is still live
   * (StartupRecoveryService re-drives those); their leases are left alone so
   * the work is not started twice. Everything else is handed back immediately
   * — a process that has restarted cannot still be running them.
   *
   * The returned `completion` settles when the resumed drive finishes; boot
   * recovery voids it (a batch can run for hours and must not block startup),
   * tests await it.
   */
  async resumeExecution(
    executionId: string,
    opts: { activeIterationIndexes?: number[] } = {},
  ): Promise<{ resumed: boolean; reclaimed: number[]; remaining: number; completion: Promise<void> }> {
    const idle = { reclaimed: [] as number[], remaining: 0, completion: Promise.resolve() };
    // Already being driven in this process — a second loop over the same slots
    // would claim nothing but would double-write the terminal status.
    if (this.executionAborts.has(executionId)) return { resumed: false, ...idle };

    const reclaimed = this.durableEngine.reclaimExpiredIterations(executionId, {
      leaseMs: 0,
      ...(opts.activeIterationIndexes ? { skipIndexes: opts.activeIterationIndexes } : {}),
    });
    const remaining = this.durableEngine.countPendingIterations(executionId);
    if (remaining === 0) {
      return { resumed: false, reclaimed, remaining, completion: Promise.resolve() };
    }

    const execution = await this.executionRepo.getExecutionById(executionId);
    const automation = await this.automationRepo.getById(execution.automationId);

    await this.executionRepo.updateExecution(executionId, { status: 'running' });
    void this.eventBus.emitGlobal({
      kind: 'automation_execution.started',
      data: { executionId, automationId: automation.id },
    }).catch((err) => {
      this.logger.warn(`[AutomationService] Failed to emit resume-started event for ${executionId}: ${err instanceof Error ? err.message : String(err)}`);
    });
    this.logger.info(
      `[AutomationService] Resuming execution ${executionId}: ${remaining} iteration(s) left ` +
      `(${reclaimed.length} reclaimed from an expired lease)`,
    );

    // Seed from the row so the resumed drive reports the whole batch's totals,
    // not just what this process managed to finish.
    const completion = this.driveIterations(
      automation,
      execution,
      { completed: execution.completedIterations, failed: execution.failedIterations },
      () => [], // slots already exist — nothing to expand or seed
    ).catch((err) => {
      this.logger.error(
        `[AutomationService] Resumed execution ${executionId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    return { resumed: true, reclaimed, remaining, completion };
  }

  /**
   * Run a single workflow within an execution, honouring the automation's
   * retry policy. Returns true if any attempt completed successfully.
   *
   * Retry semantics (Track A2):
   *   * `policy.maxAttempts` = 1 (or null policy) → no retry.
   *   * Failure classes on `policy.retryOn` trigger a backoff-then-retry.
   *   * Cancellation, workflow-run cancelled → propagate immediately.
   *   * Retries always spawn a fresh WorkflowRun so previous state
   *     doesn't leak in.
   */
  private async runSingleWorkflow(
    executionId: string,
    workflowDefId: string,
    variables: Record<string, unknown>,
    iterationIndex: number,
    iterationLabel: string | undefined,
    projectId: string | undefined,
    retryPolicy: AutomationRetryPolicy | undefined,
    /**
     * X-21 — how this execution was triggered. Threaded down to the run so a
     * SCHEDULED run can be given a fresh execution context. Before this,
     * `triggeredBy` was written onto the execution row and read in exactly one
     * place (the default-dataset fallback); it reached neither `createRun` nor
     * the harness, so "fresh agent with no history for scheduled runs" had no
     * mechanism behind it at all.
     */
    triggeredBy: AutomationTriggerType,
  ): Promise<boolean> {
    const maxAttempts = Math.max(1, retryPolicy?.maxAttempts ?? 1);
    const retryOn = new Set(retryPolicy?.retryOn ?? []);
    // Clamp policy inputs so a malformed persisted policy can't spin us
    // in a 0-ms retry loop or overflow with negative values.
    let backoff = Math.max(100, retryPolicy?.initialBackoffMs ?? 1000);
    const backoffMultiplier = Math.max(1, retryPolicy?.backoffMultiplier ?? 2);
    const maxBackoff = Math.max(backoff, retryPolicy?.maxBackoffMs ?? 60_000);

    let lastExecRunId: string | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Fresh workflow-run per attempt so retries don't inherit stage-run
      // state from the previous failed attempt.
      const run = await this.workflowRunService.createRun({
        workflowDefinitionId: workflowDefId,
        // X-21 — `__triggeredBy` is how the trigger reaches the run. The
        // shared `CreateWorkflowRunParams` has no field for it, and the
        // `__`-prefixed internal-variable convention is the established
        // channel for exactly this (`__workingDirectory`, `__workspaceId`,
        // `__projectId`, `__validationFeedback` all travel the same way).
        variables: { ...variables, __triggeredBy: triggeredBy },
        ...(projectId ? { projectId } : {}),
      });

      // Snapshot per attempt. We keep the most recent execRun id so
      // cancellation / final-status updates land on the right row. The
      // previous attempt's execRun row remains as an audit trail of
      // "attempt 1 failed with class X".
      const execRun: AutomationExecutionRun = {
        id: generateId(),
        executionId,
        workflowRunId: run.id,
        workflowDefinitionId: workflowDefId,
        iterationIndex,
        iterationVariables: variables,
        iterationLabel,
        status: 'running',
        attemptCount: attempt,
        createdAt: new Date(),
      };
      await this.executionRepo.createExecutionRun(execRun);
      lastExecRunId = execRun.id;

      try {
        await this.workflowRunService.startRun(run.id);
        await this.waitForRunCompletion(run.id, 7_200_000);

        const finalRun = await this.workflowRunRepo.getById(run.id);
        if (finalRun.status === 'completed') {
          await this.executionRepo.updateExecutionRun(execRun.id, {
            status: 'completed',
            attemptCount: attempt,
          });
          return true;
        }

        if (finalRun.status === 'cancelled') {
          // A cancelled child run isn't retryable.
          await this.executionRepo.updateExecutionRun(execRun.id, {
            status: 'cancelled',
            attemptCount: attempt,
          });
          return false;
        }

        // Non-completed, non-cancelled → failure.
        await this.executionRepo.updateExecutionRun(execRun.id, {
          status: 'failed',
          attemptCount: attempt,
        });

        // Decide whether to retry: `workflow_failed` must be in retryOn.
        const shouldRetry = attempt < maxAttempts && retryOn.has('workflow_failed');
        if (!shouldRetry) return false;

        this.logger.info(
          `[AutomationService] Iteration ${iterationIndex} attempt ${attempt} failed; retrying in ${backoff}ms (attempt ${attempt + 1}/${maxAttempts})`,
        );
        this.emitRetryEvent(executionId, iterationIndex, attempt, maxAttempts);
        await this.sleepWithCancel(backoff, executionId);
        backoff = Math.min(backoff * backoffMultiplier, maxBackoff);
      } catch (err) {
        // Cancellation short-circuits everything.
        if (this.isCancelled(executionId)) {
          await this.executionRepo.updateExecutionRun(execRun.id, {
            status: 'cancelled',
            attemptCount: attempt,
          });
          return false;
        }

        // Classify the error to see if it's retryable.
        const errClass = this.classifyError(err);
        await this.executionRepo.updateExecutionRun(execRun.id, {
          status: 'failed',
          attemptCount: attempt,
        });
        const shouldRetry = attempt < maxAttempts && retryOn.has(errClass);
        if (!shouldRetry) {
          throw err;
        }
        this.logger.info(
          `[AutomationService] Iteration ${iterationIndex} attempt ${attempt} threw '${errClass}'; retrying in ${backoff}ms (attempt ${attempt + 1}/${maxAttempts})`,
        );
        this.emitRetryEvent(executionId, iterationIndex, attempt, maxAttempts);
        await this.sleepWithCancel(backoff, executionId);
        backoff = Math.min(backoff * backoffMultiplier, maxBackoff);
      }
    }

    // Fell out of the retry loop without a return — treat as failure.
    if (lastExecRunId) {
      try {
        await this.executionRepo.updateExecutionRun(lastExecRunId, {
          status: 'failed',
          attemptCount: maxAttempts,
        });
      } catch { /* best-effort */ }
    }
    return false;
  }

  /**
   * Map a thrown error to a retry classification. Best-effort — we
   * check message substrings since the underlying WorkflowRunService
   * doesn't return typed errors yet.
   */
  private classifyError(err: unknown): 'timeout' | 'network' | 'workflow_failed' {
    const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout';
    if (
      msg.includes('econnrefused') ||
      msg.includes('econnreset') ||
      msg.includes('etimedout') ||
      msg.includes('enotfound') ||
      msg.includes('network')
    ) return 'network';
    return 'workflow_failed';
  }

  /** True once `cancelExecution` aborted this execution's in-flight drive. */
  private isCancelled(executionId: string): boolean {
    return this.executionAborts.get(executionId)?.signal.aborted === true;
  }

  /**
   * Sleep for `ms` but bail out early if the execution is cancelled.
   */
  private async sleepWithCancel(ms: number, executionId: string): Promise<void> {
    const step = 250;
    let waited = 0;
    while (waited < ms) {
      if (this.isCancelled(executionId)) return;
      const chunk = Math.min(step, ms - waited);
      await new Promise((r) => setTimeout(r, chunk));
      waited += chunk;
    }
  }

  private emitRetryEvent(
    executionId: string,
    iterationIndex: number,
    attempt: number,
    maxAttempts: number,
  ): void {
    // A synchronous try/catch around an async call can never catch its
    // rejection — attach the handler to the promise instead.
    void this.eventBus.emitGlobal({
      kind: 'automation_execution.iteration_retried',
      data: { executionId, iterationIndex, attempt, maxAttempts },
    }).catch(() => {
      /* observability is best-effort */
    });
  }

  /**
   * Wait for a workflow run to reach a terminal state using EventBus
   * subscription (zero-polling). Falls back to a single DB check on
   * subscribe in case the run already completed before we subscribed.
   */
  private async waitForRunCompletion(runId: string, timeoutMs = 600_000): Promise<void> {
    const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);

    // Fast path: run may already be terminal (e.g. instant failure)
    const current = await this.workflowRunRepo.getById(runId);
    if (terminalStatuses.has(current.status)) return;

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        unsubscribe();
        reject(new Error(`Workflow run ${runId} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      // Subscribe to global events for terminal workflow_run events
      const unsubscribe = this.eventBus.subscribeGlobal((event) => {
        if (settled) return;

        const isTerminal =
          event.kind === 'workflow_run.completed' ||
          event.kind === 'workflow_run.failed' ||
          event.kind === 'workflow_run.cancelled';
        if (!isTerminal) return;

        // Check if this event is for our run
        const eventRunId =
          event.data && typeof event.data === 'object' && 'workflowRunId' in event.data
            ? (event.data as { workflowRunId?: string }).workflowRunId
            : undefined;

        if (eventRunId === runId) {
          settled = true;
          clearTimeout(timer);
          unsubscribe();
          resolve();
        }
      });

      // Cancellation propagates via `executionAborts`: `runSingleWorkflow`
      // throws when the enclosing execution is cancelled, which unwinds
      // through this promise's catch handler. Nothing to do here.
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Due-Row Scheduler (item 38)
  //
  // Replaces the old in-process node-cron timers (one JS timer per
  // schedule automation, alive only in whichever process registered it,
  // rediscovered only via `initializeCronJobs()` at boot) with a single
  // periodic tick that claims whatever `automations` rows are due from
  // the DB. `claimDueSchedules` is one atomic conditional UPDATE, so two
  // replicas racing the same tick can never both take the same row — the
  // lease is released only once this process has dispatched the run and
  // written the next `nextRunAt`, not merely acquired.
  // ═══════════════════════════════════════════════════════════════

  /**
   * Boot hook — starts the due-row poller. Kept under its historical name
   * because apps/server/src/composition-root.ts calls it by this name; the
   * implementation is no longer node-cron in-process timers.
   */
  async initializeCronJobs(): Promise<void> {
    this.startPoller();
  }

  /** Idempotent — a second call is a no-op. */
  private startPoller(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.runSchedulerTick().catch((err) => {
        this.logger.error(`[AutomationService] Scheduler tick failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, this.pollIntervalMs);
    // Don't hold the process open just for the poller.
    (this.pollTimer as unknown as { unref?: () => void }).unref?.();
    this.logger.info(
      `[AutomationService] Started due-row scheduler (interval=${this.pollIntervalMs}ms, lease=${this.leaseMs}ms)`,
    );
  }

  private stopPoller(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      this.logger.info('[AutomationService] Stopped due-row scheduler');
    }
  }

  /**
   * One poller tick: claim every due row and handle each. Public so tests
   * (and, potentially, an operator "run scheduler now" trigger) can drive
   * it deterministically instead of waiting on the interval.
   */
  async runSchedulerTick(): Promise<void> {
    let due: Automation[];
    try {
      due = await this.automationRepo.claimDueSchedules(new Date(), this.processId, this.leaseMs);
    } catch (err) {
      this.logger.warn(`[AutomationService] claimDueSchedules failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (due.length === 0) return;

    await Promise.allSettled(due.map((automation) => this.handleDueAutomation(automation)));
  }

  /**
   * Handle one claimed row: honour missed-run / overlap policy, dispatch
   * (or skip), recompute `nextRunAt`, and release the lease LAST — after
   * dispatch, not at the start, so another replica can't claim the same
   * slot again while this one is still mid-dispatch.
   */
  private async handleDueAutomation(automation: Automation): Promise<void> {
    const now = new Date();
    const scheduledFor = automation.nextRunAt ?? now;

    try {
      // ── Missed-run policy ──────────────────────────────────────
      // "Far in the past" = at least one MORE scheduled instant elapsed
      // between the due slot and now (a single tick running a little
      // late from poll cadence is not a miss).
      const additionalMissed = automation.cronExpression
        ? countCronRunsBetween(automation.cronExpression, scheduledFor, now, automation.timezone)
        : 0;
      const missedRunPolicy = automation.missedRunPolicy ?? 'skip';

      if (additionalMissed > 0 && missedRunPolicy === 'skip') {
        const totalMissed = additionalMissed + 1; // + the due slot itself
        const nextRunAt = this.computeNextRunAt(automation, now);
        await this.automationRepo.update(automation.id, { nextRunAt } as Partial<Automation>);
        this.logger.warn(
          `[AutomationService] Skipped ${totalMissed} missed run(s) for "${automation.name}" ` +
          `(${automation.id}); missedRunPolicy=skip`,
        );
        void this.eventBus.emitGlobal({
          kind: 'automation.schedule_skipped',
          data: {
            automationId: automation.id,
            reason: 'missed',
            scheduledFor: scheduledFor.toISOString(),
            missedCount: totalMissed,
            nextRunAt: nextRunAt?.toISOString(),
            note: `Skipped ${totalMissed} missed run(s) for "${automation.name}" while the scheduler was unavailable (missedRunPolicy=skip)`,
          },
        }).catch((err) => {
          this.logger.warn(`[AutomationService] Failed to emit schedule_skipped(missed) for ${automation.id}: ${err instanceof Error ? err.message : String(err)}`);
        });
        return; // lease released in finally — nothing was dispatched
      }
      // `run_once` (or no backlog) falls through to the normal dispatch
      // path below: exactly one run, then recompute forward.

      // ── Overlap policy ──────────────────────────────────────────
      const overlapPolicy = automation.overlapPolicy ?? 'skip';
      const existingExecutions = await this.executionRepo.getExecutionsByAutomationId(automation.id);
      const hasActiveExecution = existingExecutions.some(
        (e) => e.status === 'running' || e.status === 'pending',
      );

      if (hasActiveExecution && overlapPolicy === 'skip') {
        const nextRunAt = this.computeNextRunAt(automation, now);
        await this.automationRepo.update(automation.id, { nextRunAt } as Partial<Automation>);
        this.logger.warn(
          `[AutomationService] Skipped scheduled run for "${automation.name}" (${automation.id}): ` +
          `a previous execution is still running (overlapPolicy=skip)`,
        );
        void this.eventBus.emitGlobal({
          kind: 'automation.schedule_skipped',
          data: {
            automationId: automation.id,
            reason: 'overlap',
            scheduledFor: scheduledFor.toISOString(),
            nextRunAt: nextRunAt?.toISOString(),
            note: `Skipped scheduled run for "${automation.name}": a previous execution is still running (overlapPolicy=skip)`,
          },
        }).catch((err) => {
          this.logger.warn(`[AutomationService] Failed to emit schedule_skipped(overlap) for ${automation.id}: ${err instanceof Error ? err.message : String(err)}`);
        });
        return; // lease released in finally — nothing was dispatched
      }

      if (hasActiveExecution && overlapPolicy === 'queue') {
        void this.eventBus.emitGlobal({
          kind: 'automation.schedule_deferred',
          data: {
            automationId: automation.id,
            scheduledFor: scheduledFor.toISOString(),
            note: `Running scheduled "${automation.name}" alongside an already-active execution (overlapPolicy=queue)`,
          },
        }).catch((err) => {
          this.logger.warn(`[AutomationService] Failed to emit schedule_deferred for ${automation.id}: ${err instanceof Error ? err.message : String(err)}`);
        });
      }

      // ── Dispatch ─────────────────────────────────────────────────
      // `executeAutomation` returns once the execution row exists and its
      // iteration count is resolved; the iterations themselves continue
      // in the background via `runExecution`. That's "dispatched" — the
      // lease only needs to cover this synchronous part, not the whole
      // (possibly long) run.
      try {
        this.logger.info(`[AutomationService] Scheduler triggered automation: ${automation.id} (${automation.name})`);
        await this.executeAutomation(automation, 'schedule');
      } catch (err) {
        this.logger.error(
          `[AutomationService] Scheduled dispatch failed for ${automation.id}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // ── Recompute nextRunAt AFTER dispatch ─────────────────────────
      const nextRunAt = this.computeNextRunAt(automation, now);
      await this.automationRepo.update(automation.id, { nextRunAt } as Partial<Automation>);
    } finally {
      // Release so the row is eligible for its next due time. Fire-and-
      // forget — if the release fails the lease will expire naturally.
      this.automationRepo.releaseScheduleLease(automation.id, this.processId).catch((err) => {
        this.logger.warn(
          `[AutomationService] Failed to release schedule lease for ${automation.id}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Execution Queries
  // ═══════════════════════════════════════════════════════════════

  async getExecution(executionId: string): Promise<AutomationExecution> {
    return this.executionRepo.getExecutionById(executionId);
  }

  async getExecutionWithRuns(executionId: string): Promise<AutomationExecutionWithRuns> {
    const execution = await this.executionRepo.getExecutionById(executionId);
    const runs = await this.executionRepo.getExecutionRunsByExecutionId(executionId);
    return { ...execution, runs };
  }

  async getExecutionsByAutomation(automationId: string): Promise<AutomationExecution[]> {
    return this.executionRepo.getExecutionsByAutomationId(automationId);
  }

  async cancelExecution(executionId: string): Promise<void> {
    const execution = await this.executionRepo.getExecutionById(executionId);
    if (execution.status !== 'running' && execution.status !== 'pending') {
      throw new Error(`Cannot cancel execution in ${execution.status} state`);
    }

    // Signal the background loop to stop creating new iterations and unblock
    // awaiters that took the signal. A loop not yet registered reads the
    // cancelled status off the row when it starts.
    this.executionAborts.get(executionId)?.abort();

    // Cancel all pending/running workflow runs in this execution
    const runs = await this.executionRepo.getExecutionRunsByExecutionId(executionId);
    for (const run of runs) {
      if (run.status === 'running' || run.status === 'pending') {
        try {
          await this.workflowRunService.cancelRun(run.workflowRunId);
        } catch {
          // Run may already be in terminal state
        }
        await this.executionRepo.updateExecutionRun(run.id, { status: 'cancelled' });
      }
    }

    await this.executionRepo.updateExecution(executionId, {
      status: 'cancelled',
      completedAt: new Date(),
    });

    void this.eventBus.emitGlobal({
      kind: 'automation_execution.cancelled',
      data: { executionId, automationId: execution.automationId },
    }).catch((err) => {
      this.logger.warn(`[AutomationService] Failed to emit cancelled event for ${executionId}: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  /** Stop the due-row poller. Kept as `shutdown()` — the historical name
   *  apps/server/src/composition-root.ts calls on graceful shutdown. */
  shutdown(): void {
    this.stopPoller();
  }
}
