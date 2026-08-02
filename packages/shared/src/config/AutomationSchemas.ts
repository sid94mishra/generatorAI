// ────────────────────────────────────────────────────────────────
// AutomationSchemas — Zod validation schemas for automation API
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';

// Cron expression validator — supports standard 5-field cron format:
// minute hour day-of-month month day-of-week
// Each field allows: *, ranges (1-5), lists (1,3,5), steps (*/5), and plain numbers.
const cronFieldPattern = '(\\*|[0-9]{1,2}(-[0-9]{1,2})?)(((\\/[0-9]{1,2})|(,[0-9]{1,2}(-[0-9]{1,2})?))*)';
const cronExpressionRegex = new RegExp(
  `^${cronFieldPattern}(\\s+${cronFieldPattern}){4}$`,
);

// ── Data Source Config Schemas (E1) ──

const DataSourceSchemaValidator = z.object({
  requiredFields: z.array(z.string().max(100)).max(50).optional(),
  maxItems: z.number().int().min(1).max(10_000).optional(),
}).optional();

const ScriptDataSourceSchema = z.object({
  type: z.literal('script'),
  command: z.string().min(1).max(2000),
  workingDirectory: z.string().max(500).optional(),
  timeout: z.number().int().min(1000).max(300_000).optional(), // 1s to 5min
  outputFormat: z.enum(['json_array', 'csv', 'jsonl']).optional(),
  env: z.record(z.string().max(1000)).optional(),
  schema: DataSourceSchemaValidator,
});

const HttpDataSourceSchema = z.object({
  type: z.literal('http'),
  url: z.string().min(1).max(2000),
  method: z.enum(['GET', 'POST']).optional(),
  headers: z.record(z.string().max(1000)).optional(),
  body: z.string().max(50_000).optional(),
  resultPath: z.string().max(200).optional(),
  timeout: z.number().int().min(1000).max(60_000).optional(),
  schema: DataSourceSchemaValidator,
});

const FileDataSourceSchema = z.object({
  type: z.literal('file'),
  filePath: z.string().min(1).max(500),
  format: z.enum(['json_array', 'csv', 'jsonl']).optional(),
  schema: DataSourceSchemaValidator,
});

const StaticDataSourceSchema = z.object({
  type: z.literal('static'),
});

const WorkflowScriptDataSourceSchema = z.object({
  type: z.literal('workflow_script'),
  scriptId: z.string().min(1).max(200),
  profileName: z.string().max(100).optional(),
  iterationVariable: z.string().max(100).optional(),
});

const DataSourceConfigSchema = z.discriminatedUnion('type', [
  StaticDataSourceSchema,
  ScriptDataSourceSchema,
  HttpDataSourceSchema,
  FileDataSourceSchema,
  WorkflowScriptDataSourceSchema,
]);

/** Standalone schema for testing a data source configuration (E1) */
export const TestDataSourceSchema = z.discriminatedUnion('type', [
  ScriptDataSourceSchema,
  HttpDataSourceSchema,
  FileDataSourceSchema,
  WorkflowScriptDataSourceSchema,
]);

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
  '__iteration_index',
  '__iteration_total',
]);

const DataFieldDefSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(dataFieldNameRegex, 'Field name must be a valid identifier')
    .refine((n) => !RESERVED_FIELD_NAMES.has(n), {
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

export const CreateAutomationSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  triggerType: z.enum(['manual', 'schedule', 'webhook']),
  cronExpression: z.string().regex(cronExpressionRegex, 'Invalid cron expression').optional(),
  workflowIds: z.array(z.string().uuid()).min(1, 'At least one workflow is required'),
  inputMode: z.enum(['single', 'loop', 'batch', 'script']).default('single'),
  loopVariable: z.string().max(100).optional(),
  loopItems: z.array(z.unknown()).optional(),
  batchDataFormat: z.enum(['json', 'csv', 'jsonl']).optional(),
  batchData: z.string().max(500_000).optional(), // Up to ~500KB of batch data
  batchColumns: z.array(z.string().max(100)).max(100).optional(),
  batchColumnMapping: z.record(z.string().max(100)).optional().refine(
    (mapping) => {
      if (!mapping) return true;
      const values = Object.values(mapping).filter((v) => v.trim() !== '');
      return new Set(values).size === values.length;
    },
    { message: 'Column mapping cannot have duplicate target variable names' },
  ),
  dataSourceConfig: DataSourceConfigSchema.optional(),
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
    // Legacy refinements only apply when NOT using the schema-driven pipeline.
    if (data.dataSchema) return true;
    if (data.inputMode === 'loop' && !data.loopVariable) return false;
    return true;
  },
  { message: 'loopVariable is required for loop input mode', path: ['loopVariable'] },
).refine(
  (data) => {
    if (data.dataSchema) return true;
    if (data.inputMode === 'loop' && (!data.loopItems || data.loopItems.length === 0)) return false;
    return true;
  },
  { message: 'loopItems must not be empty in loop mode', path: ['loopItems'] },
).refine(
  (data) => {
    if (data.dataSchema) return true;
    if (data.inputMode === 'batch' && !data.batchDataFormat) return false;
    return true;
  },
  { message: 'batchDataFormat is required for batch input mode', path: ['batchDataFormat'] },
).refine(
  (data) => {
    if (data.dataSchema) return true;
    if (data.inputMode === 'batch' && (!data.batchData || data.batchData.trim() === '')) return false;
    return true;
  },
  { message: 'batchData is required for batch input mode', path: ['batchData'] },
).refine(
  (data) => {
    // Cannot provide both static batchData and a dynamic data source
    const hasBatchData = data.batchData && data.batchData.trim() !== '';
    const hasDynamicSource = data.dataSourceConfig && data.dataSourceConfig.type !== 'static';
    return !(hasBatchData && hasDynamicSource);
  },
  { message: 'Cannot specify both batchData and a dynamic dataSourceConfig', path: ['dataSourceConfig'] },
).refine(
  (data) => {
    if (data.dataSchema) return true;
    if (data.inputMode === 'script') {
      return data.dataSourceConfig && data.dataSourceConfig.type !== 'static';
    }
    return true;
  },
  { message: 'dataSourceConfig is required for script input mode', path: ['dataSourceConfig'] },
).refine(
  (data) => {
    // Schedule triggers must have a way to source data at run time.
    if (data.triggerType !== 'schedule') return true;
    if (data.dataSchema) return !!data.defaultDataset;
    // Legacy pipeline: single mode is fine, otherwise the legacy data
    // must be inline on the automation.
    return true;
  },
  { message: 'Schedule triggers require a defaultDataset when using dataSchema', path: ['defaultDataset'] },
);

export const UpdateAutomationSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  triggerType: z.enum(['manual', 'schedule', 'webhook']).optional(),
  cronExpression: z.string().regex(cronExpressionRegex, 'Invalid cron expression').optional(),
  workflowIds: z.array(z.string().uuid()).min(1).optional(),
  inputMode: z.enum(['single', 'loop', 'batch', 'script']).optional(),
  loopVariable: z.string().max(100).optional(),
  loopItems: z.array(z.unknown()).optional(),
  batchDataFormat: z.enum(['json', 'csv', 'jsonl']).optional(),
  batchData: z.string().max(500_000).optional(),
  batchColumns: z.array(z.string().max(100)).max(100).optional(),
  batchColumnMapping: z.record(z.string().max(100)).optional().refine(
    (mapping) => {
      if (!mapping) return true;
      const values = Object.values(mapping).filter((v) => v.trim() !== '');
      return new Set(values).size === values.length;
    },
    { message: 'Column mapping cannot have duplicate target variable names' },
  ),
  dataSourceConfig: DataSourceConfigSchema.optional(),
  variables: z.record(z.unknown()).optional(),
  maxConcurrency: z.number().int().min(1).max(10).optional(),
  onError: z.enum(['continue', 'stop']).optional(),
  projectId: z.string().uuid().optional(),
  useWorktree: z.boolean().optional(),
  // ── Track C ── (nullable so callers can clear these back to legacy)
  dataSchema: DataSchemaSchema.nullable().optional(),
  iterationMode: IterationModeSchema.nullable().optional(),
  defaultDataset: AutomationDatasetSchema.nullable().optional(),
  retryPolicy: AutomationRetryPolicySchema.nullable().optional(),
});
