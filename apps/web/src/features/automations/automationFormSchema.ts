// ────────────────────────────────────────────────────────────────
// CreateAutomationPage form — values, defaults and validation (D-38:
// TanStack Form 1 + zod 4 for forms with > 5 fields; `CreateAutomationPage`
// had 40 `useState`s before this port).
//
// The wizard's "Input mode" (Dataset step) is one ChoiceCardGrid of four
// real states instead of the legacy checkbox + a 3-button iteration-mode
// picker: `single` (no dataset), `each_row`, `group_by` and `whole_dataset`
// (schema-driven `iterationMode.kind: 'single'` — renamed so it never reads
// as the same thing as the top-level "single run" state). `automationFormToParams`
// maps `inputMode` onto the real `dataSchema`/`iterationMode` API shape;
// nothing here is a field the server does not have (D-36).
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import type {
  Automation,
  AutomationCodebase,
  AutomationErrorPolicy,
  AutomationMissedRunPolicy,
  AutomationOverlapPolicy,
  AutomationRetryPolicy,
  AutomationTriggerType,
  CreateAutomationParams,
  DataSchema,
} from '@generatorai/shared';
import { validateCronExpression } from '@generatorai/shared';

export type AutomationDatasetMode = 'single' | 'each_row' | 'group_by' | 'whole_dataset';

export interface AutomationFormValues {
  name: string;
  description: string;
  projectId: string;
  /** D-103: the project codebases runs mount, each with the branch typed for it ('' = its default). */
  codebases: AutomationCodebase[];
  triggerType: AutomationTriggerType;
  cronExpression: string;
  timezone: string;
  missedRunPolicy: AutomationMissedRunPolicy;
  overlapPolicy: AutomationOverlapPolicy;
  workflowIds: string[];
  maxConcurrency: number;
  onError: AutomationErrorPolicy;
  permissionMode: CreateAutomationParams['permissionMode'];
  variablesText: string;
  inputMode: AutomationDatasetMode;
  dataSchemaText: string;
  groupByFieldsText: string;
  groupVariable: string;
  defaultDatasetFormat: 'json_array' | 'csv' | 'jsonl';
  defaultDatasetText: string;
  retryEnabled: boolean;
  retryMaxAttempts: number;
  retryInitialBackoffMs: number;
  retryBackoffMultiplier: number;
  retryMaxBackoffMs: number;
  retryOnFailed: boolean;
  retryOnTimeout: boolean;
  retryOnNetwork: boolean;
}

const DEFAULT_DATA_SCHEMA_TEXT = JSON.stringify(
  {
    version: 1,
    format: 'json_array',
    fields: [
      { name: 'id', type: 'string', required: true },
      { name: 'priority', type: 'string' },
    ],
  },
  null,
  2,
);

export function emptyAutomationForm(): AutomationFormValues {
  return {
    name: '',
    description: '',
    projectId: '',
    codebases: [],
    triggerType: 'manual',
    cronExpression: '0 9 * * *',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    missedRunPolicy: 'skip',
    overlapPolicy: 'skip',
    workflowIds: [],
    maxConcurrency: 1,
    onError: 'continue',
    permissionMode: 'acceptEdits',
    variablesText: '{}',
    inputMode: 'single',
    dataSchemaText: DEFAULT_DATA_SCHEMA_TEXT,
    groupByFieldsText: '',
    groupVariable: 'items',
    defaultDatasetFormat: 'json_array',
    defaultDatasetText: '',
    retryEnabled: false,
    retryMaxAttempts: 3,
    retryInitialBackoffMs: 1000,
    retryBackoffMultiplier: 2,
    retryMaxBackoffMs: 60_000,
    retryOnFailed: true,
    retryOnTimeout: true,
    retryOnNetwork: true,
  };
}

function inputModeOf(automation: Pick<Automation, 'dataSchema' | 'iterationMode'>): AutomationDatasetMode {
  if (!automation.dataSchema || !automation.iterationMode) return 'single';
  if (automation.iterationMode.kind === 'single') return 'whole_dataset';
  return automation.iterationMode.kind;
}

export function automationToForm(automation: Automation): AutomationFormValues {
  const base = emptyAutomationForm();
  const mode = automation.iterationMode;
  return {
    ...base,
    name: automation.name,
    description: automation.description ?? '',
    projectId: automation.projectId ?? '',
    codebases: automation.codebases ?? [],
    triggerType: automation.triggerType,
    cronExpression: automation.cronExpression ?? base.cronExpression,
    timezone: automation.timezone ?? base.timezone,
    missedRunPolicy: automation.missedRunPolicy ?? 'skip',
    overlapPolicy: automation.overlapPolicy ?? 'skip',
    workflowIds: automation.workflowIds,
    maxConcurrency: automation.maxConcurrency,
    onError: automation.onError,
    permissionMode: automation.permissionMode,
    variablesText: JSON.stringify(automation.variables ?? {}, null, 2),
    inputMode: inputModeOf(automation),
    dataSchemaText: automation.dataSchema ? JSON.stringify(automation.dataSchema, null, 2) : base.dataSchemaText,
    groupByFieldsText: mode?.kind === 'group_by' ? mode.fields.join(', ') : '',
    groupVariable: mode?.kind === 'group_by' ? (mode.groupVariable ?? 'items') : mode?.kind === 'single' ? (mode.datasetVariable ?? 'items') : 'items',
    defaultDatasetFormat: automation.defaultDataset?.format ?? 'json_array',
    defaultDatasetText: automation.defaultDataset?.data ?? '',
    retryEnabled: Boolean(automation.retryPolicy),
    retryMaxAttempts: automation.retryPolicy?.maxAttempts ?? base.retryMaxAttempts,
    retryInitialBackoffMs: automation.retryPolicy?.initialBackoffMs ?? base.retryInitialBackoffMs,
    retryBackoffMultiplier: automation.retryPolicy?.backoffMultiplier ?? base.retryBackoffMultiplier,
    retryMaxBackoffMs: automation.retryPolicy?.maxBackoffMs ?? base.retryMaxBackoffMs,
    retryOnFailed: automation.retryPolicy?.retryOn.includes('workflow_failed') ?? true,
    retryOnTimeout: automation.retryPolicy?.retryOn.includes('timeout') ?? true,
    retryOnNetwork: automation.retryPolicy?.retryOn.includes('network') ?? true,
  };
}

function groupByFields(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parsed JSON for `variablesText`/`dataSchemaText`, or `undefined` on invalid JSON (the schema catches it). */
function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The `CreateAutomationParams`/`UpdateAutomationParams` payload. Throws only
 * for JSON the schema already rejects (`validateAutomationForm` must run
 * first — same discipline as `agentFormToParams`).
 */
export function automationFormToParams(values: AutomationFormValues): CreateAutomationParams {
  const params: CreateAutomationParams = {
    name: values.name.trim(),
    description: values.description.trim() || undefined,
    triggerType: values.triggerType,
    cronExpression: values.triggerType === 'schedule' ? values.cronExpression.trim() : undefined,
    timezone: values.triggerType === 'schedule' ? values.timezone : undefined,
    missedRunPolicy: values.triggerType === 'schedule' ? values.missedRunPolicy : undefined,
    overlapPolicy: values.triggerType === 'schedule' ? values.overlapPolicy : undefined,
    workflowIds: values.workflowIds,
    variables: JSON.parse(values.variablesText || '{}') as Record<string, unknown>,
    maxConcurrency: values.maxConcurrency,
    onError: values.onError,
    permissionMode: values.permissionMode,
    projectId: values.projectId || undefined,
  };
  const codebases = automationCodebasesOf(values);
  if (codebases.length > 0) params.codebases = codebases;

  if (values.inputMode !== 'single') {
    params.dataSchema = JSON.parse(values.dataSchemaText) as DataSchema;
    params.iterationMode =
      values.inputMode === 'each_row'
        ? { kind: 'each_row' }
        : values.inputMode === 'group_by'
          ? { kind: 'group_by', fields: groupByFields(values.groupByFieldsText), groupVariable: values.groupVariable.trim() || undefined }
          : { kind: 'single', datasetVariable: values.groupVariable.trim() || undefined };
    if (values.defaultDatasetText.trim()) {
      params.defaultDataset = { format: values.defaultDatasetFormat, data: values.defaultDatasetText };
    }
  }

  if (values.retryEnabled) {
    const retryOn: AutomationRetryPolicy['retryOn'] = [];
    if (values.retryOnFailed) retryOn.push('workflow_failed');
    if (values.retryOnTimeout) retryOn.push('timeout');
    if (values.retryOnNetwork) retryOn.push('network');
    params.retryPolicy = {
      maxAttempts: values.retryMaxAttempts,
      initialBackoffMs: Math.max(100, values.retryInitialBackoffMs),
      backoffMultiplier: Math.max(1, values.retryBackoffMultiplier),
      maxBackoffMs: Math.max(1000, values.retryMaxBackoffMs),
      retryOn,
    };
  }

  return params;
}

/** D-103: the selected codebases with their branches trimmed (an empty branch is the default); none without a project. */
export function automationCodebasesOf(values: Pick<AutomationFormValues, 'projectId' | 'codebases'>): AutomationCodebase[] {
  if (!values.projectId) return [];
  return values.codebases.map((c) => (c.baseRef?.trim() ? { alias: c.alias, baseRef: c.baseRef.trim() } : { alias: c.alias }));
}

/** Toggle a codebase in or out of the selection, or change its branch, keeping the project's order. */
export function patchAutomationCodebase(
  selection: readonly AutomationCodebase[],
  order: readonly string[],
  alias: string,
  patch: { selected?: boolean; baseRef?: string },
): AutomationCodebase[] {
  const current = selection.find((c) => c.alias === alias);
  let next = [...selection];
  if (patch.selected === false) next = next.filter((c) => c.alias !== alias);
  else if (patch.selected === true && !current) next.push({ alias });
  if (patch.baseRef !== undefined) next = next.map((c) => (c.alias === alias ? { ...c, baseRef: patch.baseRef } : c));
  return next.sort((a, b) => order.indexOf(a.alias) - order.indexOf(b.alias));
}

/**
 * Validates an `AutomationFormValues` draft. Every rule mirrors a real
 * constraint `AutomationService`/`CreateAutomationParams` also enforces —
 * a save that got past this previously surfaced only as a generic 400.
 */
export const automationFormSchema = z
  .object({
    name: z.string(),
    triggerType: z.enum(['manual', 'schedule', 'webhook']),
    cronExpression: z.string(),
    workflowIds: z.array(z.string()),
    variablesText: z.string(),
    inputMode: z.enum(['single', 'each_row', 'group_by', 'whole_dataset']),
    dataSchemaText: z.string(),
    groupByFieldsText: z.string(),
    retryEnabled: z.boolean(),
    retryMaxAttempts: z.number(),
    retryOnFailed: z.boolean(),
    retryOnTimeout: z.boolean(),
    retryOnNetwork: z.boolean(),
  })
  .passthrough()
  .superRefine((values, ctx) => {
    if (!values.name.trim()) {
      ctx.addIssue({ code: 'custom', path: ['name'], message: 'Name is required.' });
    }
    if (values.workflowIds.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['workflowIds'], message: 'Select at least one workflow.' });
    }
    if (values.triggerType === 'schedule') {
      const cronResult = validateCronExpression(values.cronExpression.trim());
      if (!cronResult.ok) {
        ctx.addIssue({ code: 'custom', path: ['cronExpression'], message: cronResult.error });
      }
    }
    if (tryParseJson(values.variablesText || '{}') === undefined) {
      ctx.addIssue({ code: 'custom', path: ['variablesText'], message: 'Variables must be valid JSON.' });
    }
    if (values.inputMode !== 'single') {
      const schema = tryParseJson(values.dataSchemaText);
      if (schema === undefined) {
        ctx.addIssue({ code: 'custom', path: ['dataSchemaText'], message: 'Data schema must be valid JSON.' });
      }
      if (values.inputMode === 'group_by' && groupByFields(values.groupByFieldsText).length === 0) {
        ctx.addIssue({ code: 'custom', path: ['groupByFieldsText'], message: 'Grouped rows needs at least one field.' });
      }
    }
    if (values.retryEnabled) {
      if (values.retryMaxAttempts < 2) {
        ctx.addIssue({ code: 'custom', path: ['retryMaxAttempts'], message: 'Retry needs at least 2 attempts (or turn it off).' });
      }
      if (!values.retryOnFailed && !values.retryOnTimeout && !values.retryOnNetwork) {
        ctx.addIssue({ code: 'custom', path: ['retryOnFailed'], message: 'Retry policy needs at least one error class selected.' });
      }
    }
  });

/** Human-readable validation errors for the draft, in a stable field order. */
export function validateAutomationForm(values: AutomationFormValues): string[] {
  const result = automationFormSchema.safeParse(values);
  if (result.success) return [];
  return [...new Set(result.error.issues.map((issue) => issue.message))];
}
