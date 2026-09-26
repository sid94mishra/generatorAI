// ────────────────────────────────────────────────────────────────
// AutomationSchemas — Zod validation schemas for automation API
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { validateCronExpression, isValidTimezone } from '../utils/cron.js';

// Cron expression validator. Delegates to the SAME parser the scheduler
// fires from (`utils/cron.ts`) so "accepted here" and "fires there" can
// never disagree again: field ranges are checked (`99 * * * *` is
// refused) and month / weekday names are accepted (`0 9 * * MON-FRI`).
const cronExpressionSchema = z.string().min(1).max(100).superRefine((value, ctx) => {
  const result = validateCronExpression(value);
  if (!result.ok) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid cron expression: ${result.error}` });
  }
});

/** IANA zone name, e.g. `Europe/Berlin`. Validated against the runtime's tz data. */
const timezoneSchema = z.string().min(1).max(64).refine(isValidTimezone, {
  message: 'timezone must be a valid IANA zone name (e.g. "America/New_York")',
});

const missedRunPolicySchema = z.enum(['skip', 'run_once']);
const overlapPolicySchema = z.enum(['skip', 'queue']);

// ── Track C — Schema-driven pipeline ──

/** Field names must be valid identifiers so they can be used in
 *  `{{name}}` interpolation and JS object access. */
const dataFieldNameRegex = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Blocked field names — reserved either by JS prototype semantics or
 *  by the iteration variable envelope (`__iteration_*`). */
const RESERVED_FIELD_NAMES = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
]);

/** Engine-reserved variable names (`__*`, `repo_path_*`, `repo_branch_*`) never come from a dataset (C-3, W-06). */
const ENGINE_RESERVED_FIELD = /^(__|repo_path_|repo_branch_)/;

const DataFieldDefSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(dataFieldNameRegex, 'Field name must be a valid identifier')
    .refine((n) => !RESERVED_FIELD_NAMES.has(n) && !ENGINE_RESERVED_FIELD.test(n), {
      message: 'Field name is reserved and cannot be used',
    }),
  type: z.enum(['string', 'number', 'boolean', 'date', 'json']),
  required: z.boolean().optional(),
  description: z.string().max(500).optional(),
  defaultValue: z.unknown().optional(),
  enum: z.array(z.string().max(200)).max(200).optional(),
});

export const DataSchemaSchema = z.object({
  version: z.literal(1),
  format: z.enum(['json_array', 'csv', 'jsonl']),
  fields: z.array(DataFieldDefSchema).min(1, 'DataSchema must declare at least one field').max(100),
  primaryKey: z.string().max(100).optional(),
}).refine(
  (schema) => {
    if (!schema.primaryKey) return true;
    return schema.fields.some((f) => f.name === schema.primaryKey);
  },
  { message: 'primaryKey must reference one of the declared fields', path: ['primaryKey'] },
).refine(
  (schema) => {
    const names = schema.fields.map((f) => f.name);
    return new Set(names).size === names.length;
  },
  { message: 'Field names must be unique', path: ['fields'] },
);

export const IterationModeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('each_row') }),
  z.object({
    kind: z.literal('group_by'),
    fields: z.array(z.string().max(100)).min(1).max(10),
    groupVariable: z.string().max(100).regex(dataFieldNameRegex).optional(),
  }),
  z.object({
    kind: z.literal('single'),
    datasetVariable: z.string().max(100).regex(dataFieldNameRegex).optional(),
  }),
]);

export const AutomationDatasetSchema = z.object({
  format: z.enum(['json_array', 'csv', 'jsonl']),
  data: z.string().max(5_000_000, 'Dataset exceeds 5MB'),
  parsedRowCount: z.number().int().min(0).optional(),
});

export const AutomationRetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(10),
  initialBackoffMs: z.number().int().min(100).max(60_000),
  backoffMultiplier: z.number().min(1).max(10),
  maxBackoffMs: z.number().int().min(1000).max(600_000),
  retryOn: z.array(z.enum(['timeout', 'network', 'workflow_failed'])).min(1).max(3),
});

/** Body accepted by `POST /api/automations/:id/trigger`. */
export const TriggerAutomationBodySchema = z.object({
  dataset: AutomationDatasetSchema.optional(),
  saveAsDefault: z.boolean().optional(),
});

/** Body accepted by `POST /api/automations/preview-iterations`. */
export const PreviewIterationsBodySchema = z.object({
  dataSchema: DataSchemaSchema,
  iterationMode: IterationModeSchema,
  dataset: AutomationDatasetSchema,
});

/** The permission modes an automation's runs can use (PD-18). */
export const AutomationPermissionModeSchema = z.enum(['default', 'acceptEdits', 'plan', 'bypassPermissions']);

export const CreateAutomationSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  triggerType: z.enum(['manual', 'schedule', 'webhook']),
  cronExpression: cronExpressionSchema.optional(),
  timezone: timezoneSchema.optional(),
  missedRunPolicy: missedRunPolicySchema.optional(),
  overlapPolicy: overlapPolicySchema.optional(),
  workflowIds: z.array(z.string().uuid()).min(1, 'At least one workflow is required'),
  variables: z.record(z.unknown()).default({}),
  maxConcurrency: z.number().int().min(1).max(10).default(1),
  onError: z.enum(['continue', 'stop']).default('continue'),
  projectId: z.string().uuid().optional(),
  useWorktree: z.boolean().optional(),
  // ── Track C ──
  dataSchema: DataSchemaSchema.optional(),
  iterationMode: IterationModeSchema.optional(),
  defaultDataset: AutomationDatasetSchema.optional(),
  retryPolicy: AutomationRetryPolicySchema.optional(),
  // PD-18 — unattended runs must declare their permission mode.
  permissionMode: AutomationPermissionModeSchema,
}).refine(
  (data) => {
    if (data.triggerType === 'schedule' && !data.cronExpression) {
      return false;
    }
    return true;
  },
  { message: 'cronExpression is required for schedule triggers', path: ['cronExpression'] },
).refine(
  (data) => {
    // When using the new schema-driven pipeline, iterationMode is required.
    if (data.dataSchema && !data.iterationMode) return false;
    return true;
  },
  { message: 'iterationMode is required when dataSchema is set', path: ['iterationMode'] },
).refine(
  (data) => {
    // Schedule triggers must have a way to source data at run time.
    if (data.triggerType !== 'schedule') return true;
    if (data.dataSchema) return !!data.defaultDataset;
    // Without a schema a schedule trigger runs once with the base variables.
    return true;
  },
  { message: 'Schedule triggers require a defaultDataset when using dataSchema', path: ['defaultDataset'] },
);

export const UpdateAutomationSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  triggerType: z.enum(['manual', 'schedule', 'webhook']).optional(),
  cronExpression: cronExpressionSchema.optional(),
  // Nullable so a caller can fall back to the server zone.
  timezone: timezoneSchema.nullable().optional(),
  missedRunPolicy: missedRunPolicySchema.optional(),
  overlapPolicy: overlapPolicySchema.optional(),
  workflowIds: z.array(z.string().uuid()).min(1).optional(),
  variables: z.record(z.unknown()).optional(),
  maxConcurrency: z.number().int().min(1).max(10).optional(),
  onError: z.enum(['continue', 'stop']).optional(),
  projectId: z.string().uuid().optional(),
  useWorktree: z.boolean().optional(),
  // ── Track C ── (nullable so callers can clear a schema back to a single run)
  dataSchema: DataSchemaSchema.nullable().optional(),
  iterationMode: IterationModeSchema.nullable().optional(),
  defaultDataset: AutomationDatasetSchema.nullable().optional(),
  retryPolicy: AutomationRetryPolicySchema.nullable().optional(),
  permissionMode: AutomationPermissionModeSchema.optional(),
});
