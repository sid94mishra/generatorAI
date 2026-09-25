// ────────────────────────────────────────────────────────────────
// DrizzleAutomationRepository — Automation persistence
// ────────────────────────────────────────────────────────────────

import { hashWebhookToken } from '@generatorai/shared/node';
import { eq, and, or, isNull, isNotNull, lt, lte } from 'drizzle-orm';
import type {
  Automation,
  AutomationTriggerType,
  AutomationInputMode,
  AutomationErrorPolicy,
  AutomationMissedRunPolicy,
  AutomationOverlapPolicy,
  BatchDataFormat,
  DataSourceConfig,
  DataSchema,
  IterationMode,
  AutomationDataset,
  AutomationRetryPolicy,
} from '@generatorai/shared';
import { NotFoundError, StorageError } from '@generatorai/shared';
import { automations } from '../schema.js';
import type { AppDatabase } from '../index.js';
import { safeJsonColumn } from '../utils/safeJsonColumn.js';
import { validateJsonColumn } from '../utils/validateJsonColumn.js';
import { jsonArray, jsonRecord, stringArray } from '../utils/jsonColumnSchemas.js';

// DB-03 — JSON column guards for `automations`. Used on both the write
// and read paths so the same Zod schema defines valid shape end-to-end.
function validateAutomationJson(obj: {
  workflowIds?: unknown;
  loopItems?: unknown;
  batchColumns?: unknown;
  batchColumnMapping?: unknown;
  dataSourceConfig?: unknown;
  variables?: unknown;
  dataSchema?: unknown;
  iterationMode?: unknown;
  defaultDataset?: unknown;
  retryPolicy?: unknown;
}, table = 'automations'): void {
  if (obj.workflowIds !== undefined) validateJsonColumn(obj.workflowIds, stringArray, { column: 'workflowIds', table });
  if (obj.loopItems !== undefined) validateJsonColumn(obj.loopItems, jsonArray, { column: 'loopItems', table });
  if (obj.batchColumns !== undefined) validateJsonColumn(obj.batchColumns, stringArray, { column: 'batchColumns', table });
  if (obj.batchColumnMapping !== undefined) validateJsonColumn(obj.batchColumnMapping, jsonRecord, { column: 'batchColumnMapping', table });
  if (obj.dataSourceConfig !== undefined) validateJsonColumn(obj.dataSourceConfig, jsonRecord, { column: 'dataSourceConfig', table });
  if (obj.variables !== undefined) validateJsonColumn(obj.variables, jsonRecord, { column: 'variables', table });
  // The new JSON columns store structured objects; use `jsonRecord` here as
  // a shallow shape guard (the shared Zod schemas do the exhaustive check).
  if (obj.dataSchema !== undefined && obj.dataSchema !== null) validateJsonColumn(obj.dataSchema, jsonRecord, { column: 'dataSchema', table });
  if (obj.iterationMode !== undefined && obj.iterationMode !== null) validateJsonColumn(obj.iterationMode, jsonRecord, { column: 'iterationMode', table });
  if (obj.defaultDataset !== undefined && obj.defaultDataset !== null) validateJsonColumn(obj.defaultDataset, jsonRecord, { column: 'defaultDataset', table });
  if (obj.retryPolicy !== undefined && obj.retryPolicy !== null) validateJsonColumn(obj.retryPolicy, jsonRecord, { column: 'retryPolicy', table });
}

export { hashWebhookToken };

export class DrizzleAutomationRepository {
  constructor(private db: AppDatabase) {}

  async create(automation: Automation): Promise<Automation> {
    try {
      // DB-03 — validate every JSON column on insert.
      validateAutomationJson(automation);

      await this.db.insert(automations).values({
        id: automation.id,
        name: automation.name,
        description: automation.description ?? null,
        enabled: automation.enabled,
        triggerType: automation.triggerType,
        cronExpression: automation.cronExpression ?? null,
        timezone: automation.timezone ?? null,
        missedRunPolicy: automation.missedRunPolicy ?? 'skip',
        overlapPolicy: automation.overlapPolicy ?? 'skip',
        // The raw token is NEVER persisted — only its hash (v47).
        webhookTokenHash: automation.webhookTokenHash ?? null,
        workflowIds: automation.workflowIds,
        inputMode: automation.inputMode,
        loopVariable: automation.loopVariable ?? null,
        loopItems: automation.loopItems ?? [],
        batchDataFormat: automation.batchDataFormat ?? null,
        batchData: automation.batchData ?? null,
        batchColumns: automation.batchColumns ?? [],
        batchColumnMapping: automation.batchColumnMapping ?? {},
        dataSourceConfig: automation.dataSourceConfig ?? null,
        variables: automation.variables,
        maxConcurrency: automation.maxConcurrency,
        onError: automation.onError,
        lastRunAt: automation.lastRunAt ?? null,
        nextRunAt: automation.nextRunAt ?? null,
        projectId: automation.projectId ?? null,
        useWorktree: automation.useWorktree ?? true,
        // ── Track C / A ──
        dataSchema: automation.dataSchema ?? null,
        iterationMode: automation.iterationMode ?? null,
        defaultDataset: automation.defaultDataset ?? null,
        retryPolicy: automation.retryPolicy ?? null,
        createdAt: automation.createdAt,
        updatedAt: automation.updatedAt,
      });
      return this.getById(automation.id);
    } catch (err) {
      throw new StorageError(
        `Failed to create automation: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  async getById(id: string): Promise<Automation> {
    const rows = await this.db
      .select()
      .from(automations)
      .where(eq(automations.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Automation', id);
    return this.mapRow(row);
  }

  async getAll(): Promise<Automation[]> {
    const rows = await this.db
      .select()
      .from(automations)
      .orderBy(automations.createdAt);
    return rows.map((r) => this.mapRow(r));
  }

  async getByProjectId(projectId: string): Promise<Automation[]> {
    const rows = await this.db
      .select()
      .from(automations)
      .where(eq(automations.projectId, projectId))
      .orderBy(automations.createdAt);
    return rows.map((r) => this.mapRow(r));
  }

  async getEnabled(): Promise<Automation[]> {
    const rows = await this.db
      .select()
      .from(automations)
      .where(eq(automations.enabled, true))
      .orderBy(automations.createdAt);
    return rows.map((r) => this.mapRow(r));
  }

  async getByTriggerType(triggerType: AutomationTriggerType): Promise<Automation[]> {
    const rows = await this.db
      .select()
      .from(automations)
      .where(and(eq(automations.triggerType, triggerType), eq(automations.enabled, true)))
      .orderBy(automations.createdAt);
    return rows.map((r) => this.mapRow(r));
  }

  /** Look an automation up by the sha256 of its webhook token. */
  async getByWebhookTokenHash(tokenHash: string): Promise<Automation | null> {
    const rows = await this.db
      .select()
      .from(automations)
      .where(eq(automations.webhookTokenHash, tokenHash))
      .limit(1);
    return rows[0] ? this.mapRow(rows[0]) : null;
  }

  async update(id: string, updates: Partial<Automation>): Promise<Automation> {
    // DB-03 — validate only the JSON columns present in the diff.
    validateAutomationJson(updates);

    const values: Partial<typeof automations.$inferInsert> = {};
    if (updates.name !== undefined) values.name = updates.name;
    if (updates.description !== undefined) values.description = updates.description ?? null;
    if (updates.enabled !== undefined) values.enabled = updates.enabled;
    if (updates.triggerType !== undefined) values.triggerType = updates.triggerType;
    if (updates.cronExpression !== undefined) values.cronExpression = updates.cronExpression ?? null;
    if (updates.timezone !== undefined) values.timezone = updates.timezone ?? null;
    if (updates.missedRunPolicy !== undefined) values.missedRunPolicy = updates.missedRunPolicy;
    if (updates.overlapPolicy !== undefined) values.overlapPolicy = updates.overlapPolicy;
    // `webhookToken` is deliberately NOT writable — only the hash is stored.
    if (updates.webhookTokenHash !== undefined) values.webhookTokenHash = updates.webhookTokenHash ?? null;
    if (updates.workflowIds !== undefined) values.workflowIds = updates.workflowIds;
    if (updates.inputMode !== undefined) values.inputMode = updates.inputMode;
    if (updates.loopVariable !== undefined) values.loopVariable = updates.loopVariable ?? null;
    if (updates.loopItems !== undefined) values.loopItems = updates.loopItems ?? [];
    if (updates.batchDataFormat !== undefined) values.batchDataFormat = updates.batchDataFormat ?? null;
    if (updates.batchData !== undefined) values.batchData = updates.batchData ?? null;
    if (updates.batchColumns !== undefined) values.batchColumns = updates.batchColumns ?? [];
    if (updates.batchColumnMapping !== undefined) values.batchColumnMapping = updates.batchColumnMapping ?? {};
    if (updates.dataSourceConfig !== undefined) values.dataSourceConfig = updates.dataSourceConfig ?? null;
    if (updates.variables !== undefined) values.variables = updates.variables;
    if (updates.maxConcurrency !== undefined) values.maxConcurrency = updates.maxConcurrency;
    if (updates.onError !== undefined) values.onError = updates.onError;
    if (updates.lastRunAt !== undefined) values.lastRunAt = updates.lastRunAt ?? null;
    if (updates.nextRunAt !== undefined) values.nextRunAt = updates.nextRunAt ?? null;
    if (updates.projectId !== undefined) values.projectId = updates.projectId ?? null;
    if (updates.useWorktree !== undefined) values.useWorktree = updates.useWorktree;
    // ── Track C / A — explicit null-preserving semantics ──
    if (updates.dataSchema !== undefined) values.dataSchema = updates.dataSchema ?? null;
    if (updates.iterationMode !== undefined) values.iterationMode = updates.iterationMode ?? null;
    if (updates.defaultDataset !== undefined) values.defaultDataset = updates.defaultDataset ?? null;
    if (updates.retryPolicy !== undefined) values.retryPolicy = updates.retryPolicy ?? null;
    values.updatedAt = new Date();

    await this.db
      .update(automations)
      .set(values)
      .where(eq(automations.id, id));
    return this.getById(id);
  }

  async delete(id: string): Promise<void> {
    await this.db
      .delete(automations)
      .where(eq(automations.id, id));
  }

  // ── Due-row scheduler (item 38) ──────────────────────────────────

  /**
   * Atomically claim every enabled schedule-triggered automation whose
   * `next_run_at` has passed and whose lease is free or expired. The lease
   * (`locked_until` / `locked_by_process`) is stamped by the SAME
   * conditional UPDATE that selects the rows, so two pollers can never
   * both take the same slot — the pattern `DurableExecutionEngine.
   * claimNextIteration` uses, not the old acquire-then-release-on-start
   * cron lease. The caller extends the lease while the execution runs and
   * releases it on completion.
   */
  async claimDueSchedules(
    now: Date,
    processId: string,
    leaseMs: number,
  ): Promise<Automation[]> {
    const until = new Date(now.getTime() + leaseMs);
    const rows = await this.db
      .update(automations)
      .set({ lockedUntil: until, lockedByProcess: processId })
      .where(
        and(
          eq(automations.triggerType, 'schedule'),
          eq(automations.enabled, true),
          isNotNull(automations.nextRunAt),
          lte(automations.nextRunAt, now),
          or(isNull(automations.lockedUntil), lt(automations.lockedUntil, now)),
        ),
      )
      .returning();
    return rows.map((r) => this.mapRow(r));
  }

  /** Heartbeat: push `locked_until` forward while this process still owns the lease. */
  async extendScheduleLease(automationId: string, processId: string, leaseMs: number): Promise<boolean> {
    const result = await this.db
      .update(automations)
      .set({ lockedUntil: new Date(Date.now() + leaseMs) })
      .where(
        and(eq(automations.id, automationId), eq(automations.lockedByProcess, processId)),
      )
      .returning({ id: automations.id });
    return result.length > 0;
  }

  /** Release the lease (on execution completion). No-op if another process owns it now. */
  async releaseScheduleLease(automationId: string, processId: string): Promise<void> {
    await this.db
      .update(automations)
      .set({ lockedUntil: null, lockedByProcess: null })
      .where(
        and(eq(automations.id, automationId), eq(automations.lockedByProcess, processId)),
      );
  }

  /**
   * Phase 1, 1.23 — cross-process cron lease for the `node-cron`-driven tick
   * path (`AutomationService.registerCronJob`), which claims one automation
   * by id rather than a due-row batch. Same conditional-UPDATE race-free
   * pattern as {@link claimDueSchedules}, scoped to a single row and
   * reporting whether THIS call won the race instead of returning rows.
   */
  async tryAcquireCronLease(automationId: string, processId: string, leaseMs: number): Promise<boolean> {
    const now = new Date();
    const until = new Date(now.getTime() + leaseMs);
    const result = await this.db
      .update(automations)
      .set({ lockedUntil: until, lockedByProcess: processId })
      .where(
        and(
          eq(automations.id, automationId),
          or(isNull(automations.lockedUntil), lt(automations.lockedUntil, now)),
        ),
      )
      .returning({ id: automations.id });
    return result.length > 0;
  }

  /** Release a previously-acquired cron lease. No-op if another process owns it now. */
  async releaseCronLease(automationId: string, processId: string): Promise<void> {
    await this.db
      .update(automations)
      .set({ lockedUntil: null, lockedByProcess: null })
      .where(
        and(eq(automations.id, automationId), eq(automations.lockedByProcess, processId)),
      );
  }

  private mapRow(row: typeof automations.$inferSelect): Automation {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      enabled: row.enabled,
      triggerType: row.triggerType as AutomationTriggerType,
      cronExpression: row.cronExpression ?? undefined,
      timezone: row.timezone ?? undefined,
      missedRunPolicy: (row.missedRunPolicy as AutomationMissedRunPolicy) ?? 'skip',
      overlapPolicy: (row.overlapPolicy as AutomationOverlapPolicy) ?? 'skip',
      // Raw token is never read back; the hash is the persisted identity.
      webhookTokenHash: row.webhookTokenHash ?? undefined,
      workflowIds: safeJsonColumn(row.workflowIds, stringArray, { fallback: [] }) ?? [],
      inputMode: row.inputMode as AutomationInputMode,
      loopVariable: row.loopVariable ?? undefined,
      loopItems: safeJsonColumn(row.loopItems, jsonArray, { fallback: [] }) ?? [],
      batchDataFormat: (row.batchDataFormat as BatchDataFormat) ?? undefined,
      batchData: row.batchData ?? undefined,
      batchColumns: safeJsonColumn(row.batchColumns, stringArray, { fallback: undefined }),
      batchColumnMapping: safeJsonColumn(row.batchColumnMapping, jsonRecord, { fallback: undefined }) as Record<string, string> | undefined,
      dataSourceConfig: safeJsonColumn(row.dataSourceConfig, jsonRecord, { fallback: undefined }) as DataSourceConfig | undefined,
      variables: safeJsonColumn(row.variables, jsonRecord, { fallback: {} }) ?? {},
      maxConcurrency: row.maxConcurrency,
      onError: row.onError as AutomationErrorPolicy,
      lastRunAt: row.lastRunAt ?? undefined,
      nextRunAt: row.nextRunAt ?? undefined,
      projectId: row.projectId ?? undefined,
      useWorktree: row.useWorktree ?? true,
      // ── Track C / A ──
      dataSchema: safeJsonColumn(row.dataSchema, jsonRecord, { fallback: undefined }) as DataSchema | undefined,
      iterationMode: safeJsonColumn(row.iterationMode, jsonRecord, { fallback: undefined }) as IterationMode | undefined,
      defaultDataset: safeJsonColumn(row.defaultDataset, jsonRecord, { fallback: undefined }) as AutomationDataset | undefined,
      retryPolicy: safeJsonColumn(row.retryPolicy, jsonRecord, { fallback: undefined }) as AutomationRetryPolicy | undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
