// ────────────────────────────────────────────────────────────────
// AutomationService — Manages automation lifecycle, execution,
//   cron scheduling, webhook handling, and loop/batch processing
// ────────────────────────────────────────────────────────────────

import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import { mkdir } from 'node:fs/promises';
import type {
  Automation,
  AutomationExecution,
  AutomationExecutionRun,
  AutomationTriggerType,
  AutomationDataset,
  AutomationRetryPolicy,
  CreateAutomationParams,
  UpdateAutomationParams,
  AutomationWithExecutions,
  AutomationExecutionWithRuns,
  DataSourceConfig,
  DataSourceTestResult,
  ParsedBatchData,
  ILogger,
} from '@generatorai/shared';
import {
  generateId,
  parseBatchData,
  resolveIterationVariables,
  buildIterationLabel,
  ValidationError,
} from '@generatorai/shared';
import type { WorkflowRunService } from './WorkflowRunService.js';
import type * as NodeCron from 'node-cron';
import type { WorkflowDefinitionService } from './WorkflowDefinitionService.js';
import type { DataSourceResolver } from './DataSourceResolver.js';
import type { EventBus } from '../events/EventBus.js';
import type { IWorkflowRunRepository } from '../domain/ports/IWorkflowRunRepository.js';
import { planIterations } from './IterationPlanner.js';
import type { DurableExecutionEngine } from './DurableExecutionEngine.js';

/** Interface for automation repository */
export interface IAutomationRepository {
  create(automation: Automation): Promise<Automation>;
  getById(id: string): Promise<Automation>;
  getAll(): Promise<Automation[]>;
  getEnabled(): Promise<Automation[]>;
  getByTriggerType(triggerType: AutomationTriggerType): Promise<Automation[]>;
  getByWebhookToken(token: string): Promise<Automation | null>;
  getByProjectId(projectId: string): Promise<Automation[]>;
  update(id: string, updates: Partial<Automation>): Promise<Automation>;
  delete(id: string): Promise<void>;

  /**
   * Phase 1, 1.23 — cross-process cron lease.
   *
   * Atomically claim ownership of a scheduled automation for `leaseMs`.
   * Returns true if this process now owns the lease, false if another
   * process already holds it (and our tick should be skipped).
   *
   * Implementation is a conditional UPDATE:
   *   UPDATE automations
   *      SET locked_until = now+leaseMs, locked_by_process = ?
   *    WHERE id = ? AND (locked_until IS NULL OR locked_until < now)
   */
  tryAcquireCronLease(
    automationId: string,
    processId: string,
    leaseMs: number,
  ): Promise<boolean>;

  /** Release a previously-acquired lease (called on tick completion). */
  releaseCronLease(automationId: string, processId: string): Promise<void>;
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

/** Cron job handle for scheduling */
interface CronJobHandle {
  automationId: string;
  stop: () => void;
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
  private cronJobs = new Map<string, CronJobHandle>();
  private cronModule: typeof NodeCron | null = null;
  /** Unique per-process identifier used as the `locked_by_process` value
   *  on cron lease rows. Lets operators tell at a glance which replica
   *  owns a given lease. */
  private readonly processId: string = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  /** Default cron lease duration. Long enough to cover a typical
   *  automation tick without another replica stealing the slot, short
   *  enough that a crashed owner's lease expires before the next tick
   *  (cron runs are usually at-least-a-minute cadence). */
  private readonly cronLeaseMs: number = 60_000;
  /** Tracks execution IDs that have been cancelled so background loops can bail out */
  private cancelledExecutions = new Set<string>();
  /**
   * Phase 2, 2.9 — AbortController per in-flight execution. `cancelExecution`
   * calls `.abort()` so downstream awaits (data-source HTTP fetches, sleeps,
   * anything that accepts an AbortSignal) can exit immediately instead of
   * waiting for the next boundary check on `cancelledExecutions`.
   * The legacy Set is kept for sites that don't take a signal yet.
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
    private artifactsDir?: string,
    private dataSourceResolver?: DataSourceResolver,
    /**
     * Optional transactional wrapper. When supplied, the initial burst of
     * writes that open an execution (createExecution + update automation's
     * lastRunAt) is atomic so a mid-sequence failure doesn't leave the
     * automation's `lastRunAt` advanced with no corresponding execution row
     * (or vice-versa).
     */
    private withTransaction?: <T>(fn: () => Promise<T>) => Promise<T>,
    /**
     * W22 — durable execution engine. When supplied, iteration slots are
     * written to the `entries` table up front and claimed atomically, so a
     * 1000-row batch that dies at row 40 resumes at row 41 on restart
     * (P0-41 fix). When absent, the legacy in-memory iteration loop runs.
     */
    private durableEngine?: DurableExecutionEngine,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // CRUD Operations
  // ═══════════════════════════════════════════════════════════════

  async createAutomation(params: CreateAutomationParams): Promise<Automation> {
    const now = new Date();
    const automation: Automation = {
      id: generateId(),
      name: params.name,
      description: params.description,
      enabled: true,
      triggerType: params.triggerType,
      cronExpression: params.cronExpression,
      webhookToken: params.triggerType === 'webhook'
        ? randomBytes(32).toString('hex')
        : undefined,
      workflowIds: params.workflowIds,
      inputMode: params.inputMode,
      loopVariable: params.loopVariable,
      loopItems: params.loopItems ?? [],
      batchDataFormat: params.batchDataFormat,
      batchData: params.batchData,
      batchColumns: params.batchColumns,
      batchColumnMapping: params.batchColumnMapping,
      dataSourceConfig: params.dataSourceConfig,
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

    const created = await this.automationRepo.create(automation);

    // Register cron if schedule type
    if (created.triggerType === 'schedule' && created.cronExpression && created.enabled) {
      await this.registerCronJob(created);
    }

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
      updates.webhookToken = randomBytes(32).toString('hex');
    }

    const updated = await this.automationRepo.update(id, updates);

    // Re-register cron if schedule parameters changed
    if (updated.triggerType === 'schedule' && updated.enabled) {
      this.unregisterCronJob(id);
      await this.registerCronJob(updated);
    } else {
      this.unregisterCronJob(id);
    }

    this.logger.info(`[AutomationService] Updated automation: ${id}`);
    return updated;
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
    const newToken = randomBytes(32).toString('hex');
    const updated = await this.automationRepo.update(id, { webhookToken: newToken });
    this.logger.info(`[AutomationService] Rotated webhook token for automation ${id}`);
    return updated;
  }

  async deleteAutomation(id: string): Promise<void> {
    this.unregisterCronJob(id);

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
    if (updated.triggerType === 'schedule' && updated.cronExpression) {
      await this.registerCronJob(updated);
    }
    this.logger.info(`[AutomationService] Enabled automation: ${id}`);
    return updated;
  }

  async disableAutomation(id: string): Promise<Automation> {
    this.unregisterCronJob(id);
    const updated = await this.automationRepo.update(id, { enabled: false });
    this.logger.info(`[AutomationService] Disabled automation: ${id}`);
    return updated;
  }

  // ═══════════════════════════════════════════════════════════════
  // Data Source Testing (E1)
  // ═══════════════════════════════════════════════════════════════

  /** Test a data source configuration — returns preview without creating an execution */
  async testDataSource(config: DataSourceConfig): Promise<DataSourceTestResult> {
    if (!this.dataSourceResolver) {
      throw new Error('Data source resolver is not configured');
    }
    return this.dataSourceResolver.testDataSource(config);
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

    return this.executeAutomation(automation, 'manual', undefined, undefined, dataset);
  }

  /**
   * Webhook trigger — finds automation by token and executes.
   *
   * When the automation has a `dataSchema`, the raw HTTP body is
   * treated as the dataset (content-type drives the format hint but
   * the schema-declared format wins). Otherwise the legacy behaviour
   * applies: top-level payload keys become extra variables.
   */
  async triggerWebhook(
    token: string,
    payload: unknown,
    contentType?: string,
  ): Promise<AutomationExecution> {
    const automation = await this.automationRepo.getByWebhookToken(token);
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
        undefined,
        dataset,
      );
    }

    // Legacy webhook handling — extract variables from payload object.
    // Use null-prototype object to prevent prototype pollution.
    let extraVariables: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
        if (
          Object.prototype.hasOwnProperty.call(payload, key) &&
          !key.startsWith('__') &&
          key !== '__proto__' &&
          key !== 'constructor' &&
          key !== 'prototype' &&
          /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)
        ) {
          extraVariables[key] = value;
        }
      }
    }

    return this.executeAutomation(
      automation,
      'webhook',
      JSON.stringify(payload).slice(0, 5000),
      extraVariables,
    );
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
    extraVariables?: Record<string, unknown>,
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
          baseVariables: { ...automation.variables, ...(extraVariables ?? {}) },
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
      // Only snapshot for the schema-driven pipeline (dataset is
      // meaningful there); legacy execs already record inline data on
      // the automation.
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

    // Resolve iteration count based on input mode.
    let iterationCount: number;
    let resolvedDataSource: ParsedBatchData | null = null;

    if (plannedIterations) {
      // Schema-driven — planner already produced the iteration list.
      iterationCount = plannedIterations.iterations.length;
    } else {
      try {
        // Legacy paths (dynamic data source, batch, loop, single).
        if (automation.dataSourceConfig && automation.dataSourceConfig.type !== 'static' && this.dataSourceResolver) {
          resolvedDataSource = await this.dataSourceResolver.resolve(automation);
          iterationCount = resolvedDataSource?.rowCount ?? 1;
        } else if (automation.inputMode === 'batch' && automation.batchData && automation.batchDataFormat) {
          const parsed = parseBatchData(automation.batchDataFormat, automation.batchData);
          iterationCount = parsed.rowCount;
        } else if (automation.inputMode === 'loop' && automation.loopItems?.length) {
          iterationCount = automation.loopItems.length;
        } else {
          iterationCount = 1;
        }
      } catch (err) {
        // Data source resolution failed — mark execution as failed
        const errMessage = err instanceof Error ? err.message : String(err);
        this.logger.error(`[AutomationService] Data source resolution failed for execution ${execution.id}: ${errMessage}`);
        await this.executionRepo.updateExecution(execution.id, {
          status: 'failed',
          completedAt: new Date(),
          error: `Data source resolution failed: ${errMessage}`,
        });
        return execution;
      }
    }

    // totalRuns = (number of iterations) * (number of workflows per iteration)
    const totalRuns = iterationCount * automation.workflowIds.length;

    // Update execution with resolved total
    await this.executionRepo.updateExecution(execution.id, {
      totalIterations: totalRuns,
    });
    execution.totalIterations = totalRuns;

    // Start execution in background
    this.runExecution(automation, execution, extraVariables, resolvedDataSource, plannedIterations).catch((err) => {
      this.logger.error(`[AutomationService] Execution ${execution.id} failed: ${err instanceof Error ? err.message : String(err)}`);
    });

    return execution;
  }

  /** Background execution runner */
  private async runExecution(
    automation: Automation,
    execution: AutomationExecution,
    extraVariables?: Record<string, unknown>,
    resolvedDataSource?: ParsedBatchData | null,
    plannedIterations?: ReturnType<typeof planIterations> | null,
  ): Promise<void> {
    await this.executionRepo.updateExecution(execution.id, {
      status: 'running',
      startedAt: new Date(),
    });

    // Emit execution started event
    this.eventBus.emitGlobal({
      kind: 'automation_execution.started',
      data: { executionId: execution.id, automationId: automation.id },
    });

    await this.driveIterations(automation, execution, { completed: 0, failed: 0 }, () =>
      this.buildIterationList(automation, extraVariables, resolvedDataSource, plannedIterations),
    );
  }

  /**
   * Expand the automation's input configuration into the concrete iteration
   * list. Pure — every branch is a function of the arguments, which is why it
   * can be handed to `driveIterations` as a thunk and evaluated inside its
   * error handling (a malformed batch payload must fail the execution, not
   * escape as an unhandled rejection).
   */
  private buildIterationList(
    automation: Automation,
    extraVariables?: Record<string, unknown>,
    resolvedDataSource?: ParsedBatchData | null,
    plannedIterations?: ReturnType<typeof planIterations> | null,
  ): { variables: Record<string, unknown>; label: string }[] {
    // Build iteration list based on input mode
    let iterations: { variables: Record<string, unknown>; label: string }[];

      if (plannedIterations) {
        // Track C: schema-driven pipeline. IterationPlanner already
        // validated + coerced + merged base variables + reserved keys.
        iterations = plannedIterations.iterations;
      } else if (resolvedDataSource && resolvedDataSource.rowCount > 0) {
        // Legacy E1: Dynamic data source — use resolved data as iteration items
        const totalIter = resolvedDataSource.rows.length;

        iterations = resolvedDataSource.rows.map((row, idx) => ({
          variables: resolveIterationVariables(
            row,
            automation.batchColumnMapping,
            { ...automation.variables, ...(extraVariables ?? {}) },
            idx,
            totalIter,
          ),
          label: buildIterationLabel(row, idx),
        }));
      } else if (automation.inputMode === 'batch' && automation.batchData && automation.batchDataFormat) {
        // Legacy batch mode: parse structured data, map columns to variables
        const parsed = parseBatchData(automation.batchDataFormat, automation.batchData);
        const totalIter = parsed.rows.length;

        iterations = parsed.rows.map((row, idx) => ({
          variables: resolveIterationVariables(
            row,
            automation.batchColumnMapping,
            { ...automation.variables, ...(extraVariables ?? {}) },
            idx,
            totalIter,
          ),
          label: buildIterationLabel(row, idx),
        }));
      } else if (automation.inputMode === 'loop' && automation.loopItems?.length) {
        // Legacy loop mode: single variable injection
        iterations = automation.loopItems.map((item, idx) => {
          const vars: Record<string, unknown> = {
            ...automation.variables,
            ...(extraVariables ?? {}),
            __iteration_index: idx,
            __iteration_total: automation.loopItems!.length,
          };
          if (automation.loopVariable && item !== null) {
            vars[automation.loopVariable] = item;
          }
          return {
            variables: vars,
            label: `${automation.loopVariable ?? 'item'}=${String(item).slice(0, 80)}`,
          };
        });
      } else {
        // Single mode: one iteration with base variables
        iterations = [{
          variables: {
            ...automation.variables,
            ...(extraVariables ?? {}),
            __iteration_index: 0,
            __iteration_total: 1,
          },
          label: 'Single run',
        }];
      }

    return iterations;
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

    let completedCount = seed.completed;
    let failedCount = seed.failed;

    try {
      const iterations = buildIterations();

      const maxConcurrency = Math.max(1, automation.maxConcurrency);

      // ── W22 — Durable iteration claiming (P0-41 fix) ──────────
      // When the durable engine is available, write all iteration slots up
      // front so a restart can claim and resume any still-pending rows
      // without losing work. On a resume `iterations` is empty and every slot
      // already exists, so this is a no-op.
      if (this.durableEngine && iterations.length > 0) {
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

      // In batch/loop mode, maxConcurrency controls how many iterations run in parallel.
      // Within each iteration, workflows still run sequentially (they share context).
      for (let batchStart = 0; ; batchStart += maxConcurrency) {
        // Check if this execution has been cancelled before starting a new batch
        if (this.cancelledExecutions.has(execution.id)) {
          this.logger.info(`[AutomationService] Execution ${execution.id} cancelled — stopping iteration loop`);
          this.cancelledExecutions.delete(execution.id);
          return; // Exit early — cancelExecution already set terminal status
        }

        // W22: when the durable engine is active, use atomic claim instead of
        // slicing the in-memory array. This prevents duplicate iteration on
        // restart (the claim is idempotent — already-claimed rows return null).
        let iterBatch: IterationWorkItem[];
        if (this.durableEngine) {
          iterBatch = [];
          for (let i = 0; i < maxConcurrency; i++) {
            const claimed = this.durableEngine.claimNextIteration(execution.id);
            if (!claimed) break;
            // △ `claimed.index` — NOT a recomputed loop counter. The claim
            // returns whichever slot is lowest-pending, which after a resume
            // (or any concurrent claimer) is not `batchStart + offset`:
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
        } else {
          if (batchStart >= iterations.length) break;
          iterBatch = iterations
            .slice(batchStart, batchStart + maxConcurrency)
            .map((iter, offset) => ({ index: batchStart + offset, ...iter }));
        }

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
                if (this.cancelledExecutions.has(execution.id)) {
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
              if (iter.slotId && this.durableEngine) {
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
        this.eventBus.emitGlobal({
          kind: 'automation_execution.progress',
          data: {
            executionId: execution.id,
            automationId: automation.id,
            completedRuns: completedCount,
            failedRuns: failedCount,
            totalRuns: execution.totalIterations,
          },
        });
      }

      // Execution complete — but skip if already cancelled by cancelExecution
      if (this.cancelledExecutions.has(execution.id)) {
        this.cancelledExecutions.delete(execution.id);
        return;
      }

      const finalStatus = failedCount > 0 && completedCount === 0 ? 'failed' : 'completed';
      await this.executionRepo.updateExecution(execution.id, {
        status: finalStatus,
        completedIterations: completedCount,
        failedIterations: failedCount,
        completedAt: new Date(),
      });

      this.eventBus.emitGlobal({
        kind: `automation_execution.${finalStatus}` as 'automation_execution.completed' | 'automation_execution.failed',
        data: { executionId: execution.id, automationId: automation.id },
      });

    } catch (err) {
      // Skip overwriting if execution was cancelled
      if (this.cancelledExecutions.has(execution.id)) {
        this.cancelledExecutions.delete(execution.id);
        return;
      }

      await this.executionRepo.updateExecution(execution.id, {
        status: 'failed',
        completedIterations: completedCount,
        failedIterations: failedCount,
        error: err instanceof Error ? err.message : String(err),
        completedAt: new Date(),
      });

      this.eventBus.emitGlobal({
        kind: 'automation_execution.failed',
        data: {
          executionId: execution.id,
          automationId: automation.id,
          error: err instanceof Error ? err.message : String(err),
        },
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
    if (!this.durableEngine) return { resumed: false, ...idle };
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
    this.eventBus.emitGlobal({
      kind: 'automation_execution.started',
      data: { executionId, automationId: automation.id },
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
        if (this.cancelledExecutions.has(executionId)) {
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

  /**
   * Sleep for `ms` but bail out early if the execution is cancelled.
   */
  private async sleepWithCancel(ms: number, executionId: string): Promise<void> {
    const step = 250;
    let waited = 0;
    while (waited < ms) {
      if (this.cancelledExecutions.has(executionId)) return;
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
    try {
      this.eventBus.emitGlobal({
        kind: 'automation_execution.iteration_retried',
        data: { executionId, iterationIndex, attempt, maxAttempts },
      });
    } catch {
      /* observability is best-effort */
    }
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
  // Cron Scheduling
  // ═══════════════════════════════════════════════════════════════

  /** Initialize cron scheduler — load enabled scheduled automations */
  async initializeCronJobs(): Promise<void> {
    try {
      this.cronModule = await import('node-cron');
    } catch {
      this.logger.warn('[AutomationService] node-cron not available, cron scheduling disabled');
      return;
    }

    const scheduledAutomations = await this.automationRepo.getByTriggerType('schedule');
    for (const automation of scheduledAutomations) {
      if (automation.enabled && automation.cronExpression) {
        await this.registerCronJob(automation);
      }
    }
    this.logger.info(`[AutomationService] Initialized ${this.cronJobs.size} cron jobs`);
  }

  /** Register a cron job for a scheduled automation */
  private async registerCronJob(automation: Automation): Promise<void> {
    if (!this.cronModule || !automation.cronExpression) return;

    // Unregister existing if any
    this.unregisterCronJob(automation.id);

    const cron = this.cronModule;
    if (!cron.validate(automation.cronExpression)) {
      this.logger.warn(`[AutomationService] Invalid cron expression for ${automation.id}: ${automation.cronExpression}`);
      return;
    }

    const task = cron.schedule(automation.cronExpression, () => {
      // Phase 1, 1.23 — try to acquire the row-level lease before running.
      // If another process owns it (multi-pod deployment, or a zombie lease
      // from a prior crash still inside the grace period), skip this tick.
      // The lease covers ~typical automation duration; cron-bound jobs that
      // legitimately run >60s should set a longer lease.
      const leaseMs = this.cronLeaseMs;
      void (async () => {
        let haveLease = false;
        try {
          haveLease = await this.automationRepo.tryAcquireCronLease(
            automation.id,
            this.processId,
            leaseMs,
          );
        } catch (err) {
          this.logger.warn(
            `[AutomationService] Cron lease check failed for ${automation.id}: ` +
            `${err instanceof Error ? err.message : String(err)}`,
          );
          return;
        }
        if (!haveLease) {
          this.logger.debug(
            `[AutomationService] Skipping cron tick for ${automation.id}; lease held by another process`,
          );
          return;
        }

        this.logger.info(
          `[AutomationService] Cron triggered automation: ${automation.id} (${automation.name})`,
        );
        try {
          await this.executeAutomation(automation, 'schedule');
        } catch (err) {
          this.logger.error(
            `[AutomationService] Cron execution failed for ${automation.id}: ` +
            `${err instanceof Error ? err.message : String(err)}`,
          );
        } finally {
          // Release so the next tick window is eligible. Fire-and-forget —
          // if the release fails the lease will expire naturally.
          this.automationRepo.releaseCronLease(automation.id, this.processId).catch((err) => {
            this.logger.warn(
              `[AutomationService] Failed to release cron lease for ${automation.id}: ` +
              `${err instanceof Error ? err.message : String(err)}`,
            );
          });
        }
      })();
    });

    this.cronJobs.set(automation.id, {
      automationId: automation.id,
      stop: () => task.stop(),
    });

    this.logger.info(`[AutomationService] Registered cron job for ${automation.id}: ${automation.cronExpression}`);
  }

  /** Unregister a cron job */
  private unregisterCronJob(automationId: string): void {
    const job = this.cronJobs.get(automationId);
    if (job) {
      job.stop();
      this.cronJobs.delete(automationId);
      this.logger.info(`[AutomationService] Unregistered cron job for ${automationId}`);
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

    // Signal the background runExecution loop to stop creating new iterations.
    // AbortController unblocks awaiters that opted into the signal;
    // `cancelledExecutions` remains as a legacy boundary-poll fallback.
    this.cancelledExecutions.add(executionId);
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

    this.eventBus.emitGlobal({
      kind: 'automation_execution.cancelled',
      data: { executionId, automationId: execution.automationId },
    });
  }

  /** Shut down all cron jobs */
  shutdown(): void {
    for (const [id, job] of this.cronJobs) {
      job.stop();
      this.logger.info(`[AutomationService] Stopped cron job: ${id}`);
    }
    this.cronJobs.clear();
  }
}
