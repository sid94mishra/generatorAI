// Automations rules (MAutomations … MAutomationCreate4; 04 §2.5; M7-04): list filters and rows, the menu, the
// detail's configuration rows, execution views, the six-page wizard draft (MD-66) with its validation, review and
// create / update bodies, and the webhook credentials text. Pure, unit-tested.
import type {
  Automation,
  AutomationExecution,
  AutomationRetryPolicy,
  CreateAutomationParams,
  DataFieldDef,
  DataFieldType,
  StatusState,
  UpdateAutomationParams,
  WorkflowRunPermissionMode,
} from '@generatorai/shared';
import { resolveStatus } from '@generatorai/shared';

import { scheduleFromCron, scheduleSummary, scheduleToCron, cronProblem, type ScheduleDraft } from './scheduleModel';

export type AutomationScope = 'all' | 'enabled' | 'disabled';

export function filterAutomations<T extends { name: string; enabled: boolean; description?: string }>(list: readonly T[], scope: AutomationScope, query: string): T[] {
  const q = query.trim().toLowerCase();
  return list.filter((a) => (scope === 'all' || (scope === 'enabled') === a.enabled) && (!q || a.name.toLowerCase().includes(q) || (a.description ?? '').toLowerCase().includes(q)));
}

export const TRIGGER_LABEL = { manual: 'Manual', schedule: 'Schedule', webhook: 'Webhook' } as const;
export const TRIGGER_ICON = { manual: 'hand', schedule: 'clock', webhook: 'webhook' } as const;

export const PERMISSION_LABEL: Record<WorkflowRunPermissionMode, string> = {
  plan: 'Plan',
  default: 'Default',
  acceptEdits: 'Accept edits',
  bypassPermissions: 'Bypass',
};

/** "Daily 02:00", "Webhook · POST", "Manual". */
export function triggerLine(a: Pick<Automation, 'triggerType' | 'cronExpression'>): string {
  if (a.triggerType === 'schedule') return scheduleSummary(a.cronExpression);
  if (a.triggerType === 'webhook') return 'Webhook · POST';
  return 'Manual';
}

/** Dataset rows the automation runs over: "3 rows", "One run". */
export function datasetLine(a: Pick<Automation, 'defaultDataset' | 'dataSchema'>): string {
  const rows = a.defaultDataset?.parsedRowCount;
  if (typeof rows === 'number' && rows > 0) return `${rows} row${rows === 1 ? '' : 's'}`;
  return 'One run';
}

export function executionStatus(status: AutomationExecution['status'] | string): { state: StatusState; label: string } {
  const r = resolveStatus('automationExecution', status as AutomationExecution['status']);
  return r ? { state: r.state, label: r.label } : { state: 'queued', label: String(status) };
}

/** "2 of 14 failed", "3 of 3 finalized", "Manual · 2 of 3 rows". */
export function executionProgress(e: Pick<AutomationExecution, 'totalIterations' | 'completedIterations' | 'failedIterations'>): string | null {
  if (!e.totalIterations) return null;
  if (e.failedIterations > 0) return `${e.failedIterations} of ${e.totalIterations} failed`;
  return `${e.completedIterations} of ${e.totalIterations} finalized`;
}

export type AutomationMenuId = 'run' | 'run-dataset' | 'edit' | 'duplicate' | 'enable' | 'disable' | 'delete';

export function automationMenu(a: Pick<Automation, 'enabled'>, canEdit: boolean, canRun: boolean): Array<{ id: AutomationMenuId; label: string; icon: string; destructive?: boolean } | { type: 'separator' }> {
  return [
    ...(canRun ? [{ id: 'run' as const, label: 'Run now', icon: 'play' }, { id: 'run-dataset' as const, label: 'Run with dataset…', icon: 'database' }] : []),
    ...(canEdit
      ? [
          { type: 'separator' as const },
          { id: 'edit' as const, label: 'Edit', icon: 'edit' },
          { id: 'duplicate' as const, label: 'Duplicate', icon: 'copy' },
          a.enabled ? { id: 'disable' as const, label: 'Disable', icon: 'power' } : { id: 'enable' as const, label: 'Enable', icon: 'power' },
          { type: 'separator' as const },
          { id: 'delete' as const, label: 'Delete…', icon: 'trash', destructive: true },
        ]
      : []),
  ];
}

// ── Retry ───────────────────────────────────────────────────────

export const DEFAULT_RETRY: AutomationRetryPolicy = { maxAttempts: 3, initialBackoffMs: 1000, backoffMultiplier: 2, maxBackoffMs: 60_000, retryOn: ['workflow_failed', 'timeout'] };

/** "3 attempts · 1s × 2, max 60s · workflow_failed, timeout". */
export function retryLine(r: AutomationRetryPolicy | undefined): string {
  if (!r) return 'No retries';
  return `${r.maxAttempts} attempts · ${r.initialBackoffMs / 1000}s × ${r.backoffMultiplier}, max ${Math.round(r.maxBackoffMs / 1000)}s · ${r.retryOn.join(', ')}`;
}

// ── Wizard (MD-66: six pages) ───────────────────────────────────

export const WIZARD_STEPS = [
  { id: 'basics', label: 'Basics' },
  { id: 'trigger', label: 'Trigger' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'dataset', label: 'Dataset' },
  { id: 'variables', label: 'Variables' },
  { id: 'review', label: 'Review' },
] as const;

export interface VariableRow {
  key: string;
  value: string;
}

export interface AutomationDraft {
  name: string;
  description: string;
  projectId: string | null;
  triggerType: Automation['triggerType'];
  schedule: ScheduleDraft;
  missedRunPolicy: 'skip' | 'run_once';
  overlapPolicy: 'skip' | 'queue';
  workflowIds: string[];
  permissionMode: WorkflowRunPermissionMode;
  fields: DataFieldDef[];
  /** One value per row for a one-field schema; otherwise the raw JSON array. */
  rows: string[];
  datasetJson: string;
  maxConcurrency: number;
  onError: 'continue' | 'stop';
  variables: VariableRow[];
  retry: boolean;
}

export function blankDraft(timezone: string): AutomationDraft {
  return {
    name: '',
    description: '',
    projectId: null,
    triggerType: 'manual',
    schedule: scheduleFromCron(null, timezone),
    missedRunPolicy: 'skip',
    overlapPolicy: 'skip',
    workflowIds: [],
    permissionMode: 'acceptEdits',
    fields: [],
    rows: [],
    datasetJson: '',
    maxConcurrency: 1,
    onError: 'continue',
    variables: [],
    retry: false,
  };
}

function parseRows(data: string | undefined, fields: readonly DataFieldDef[]): { rows: string[]; json: string } {
  if (!data) return { rows: [], json: '' };
  try {
    const parsed = JSON.parse(data) as unknown;
    if (Array.isArray(parsed) && fields.length === 1) {
      const key = fields[0]!.name;
      return { rows: parsed.map((r) => (r && typeof r === 'object' ? String((r as Record<string, unknown>)[key] ?? '') : String(r))), json: '' };
    }
    return { rows: [], json: data };
  } catch {
    return { rows: [], json: data };
  }
}

export function draftFromAutomation(a: Automation, timezone: string): AutomationDraft {
  const fields = a.dataSchema?.fields ?? [];
  const parsed = parseRows(a.defaultDataset?.format === 'json_array' ? a.defaultDataset.data : undefined, fields);
  return {
    name: a.name,
    description: a.description ?? '',
    projectId: a.projectId ?? null,
    triggerType: a.triggerType,
    schedule: scheduleFromCron(a.cronExpression, a.timezone ?? timezone),
    missedRunPolicy: a.missedRunPolicy ?? 'skip',
    overlapPolicy: a.overlapPolicy ?? 'skip',
    workflowIds: [...a.workflowIds],
    permissionMode: a.permissionMode,
    fields: [...fields],
    rows: parsed.rows,
    datasetJson: parsed.json,
    maxConcurrency: a.maxConcurrency,
    onError: a.onError,
    variables: Object.entries(a.variables ?? {}).map(([key, value]) => ({ key, value: typeof value === 'string' ? value : JSON.stringify(value) })),
    retry: Boolean(a.retryPolicy),
  };
}

/** Per-page problems; Continue is blocked while the current page has one. */
export function pageProblem(draft: AutomationDraft, page: number): string | null {
  switch (WIZARD_STEPS[page]?.id) {
    case 'basics':
      return draft.name.trim() ? null : 'Give the automation a name.';
    case 'trigger':
      return draft.triggerType === 'schedule' ? cronProblem(scheduleToCron(draft.schedule)) : null;
    case 'workflow':
      return draft.workflowIds.length ? null : 'Add at least one workflow.';
    case 'dataset': {
      if (draft.fields.some((f) => !f.name.trim())) return 'Every field needs a name.';
      if (draft.datasetJson.trim()) {
        try {
          if (!Array.isArray(JSON.parse(draft.datasetJson))) return 'The dataset must be a JSON array of rows.';
        } catch {
          return "The dataset isn't valid JSON.";
        }
      }
      return null;
    }
    case 'variables':
      return draft.variables.some((v) => v.value.trim() && !v.key.trim()) ? 'Every value needs a name.' : null;
    default:
      return null;
  }
}

function variableValue(raw: string): unknown {
  const t = raw.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t !== '' && !Number.isNaN(Number(t))) return Number(t);
  return raw;
}

export function datasetOf(draft: AutomationDraft): { format: 'json_array'; data: string; parsedRowCount: number } | undefined {
  if (draft.fields.length === 1 && draft.rows.length) {
    const key = draft.fields[0]!.name;
    const rows = draft.rows.map((r) => ({ [key]: draft.fields[0]!.type === 'number' ? Number(r) : r }));
    return { format: 'json_array', data: JSON.stringify(rows), parsedRowCount: rows.length };
  }
  if (draft.datasetJson.trim()) {
    const parsed = JSON.parse(draft.datasetJson) as unknown[];
    return { format: 'json_array', data: draft.datasetJson.trim(), parsedRowCount: parsed.length };
  }
  return undefined;
}

export function createBody(draft: AutomationDraft): CreateAutomationParams {
  const dataset = datasetOf(draft);
  const variables = Object.fromEntries(draft.variables.filter((v) => v.key.trim()).map((v) => [v.key.trim(), variableValue(v.value)]));
  return {
    name: draft.name.trim(),
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
    triggerType: draft.triggerType,
    ...(draft.triggerType === 'schedule'
      ? { cronExpression: scheduleToCron(draft.schedule), timezone: draft.schedule.timezone, missedRunPolicy: draft.missedRunPolicy, overlapPolicy: draft.overlapPolicy }
      : {}),
    workflowIds: draft.workflowIds,
    variables,
    maxConcurrency: draft.maxConcurrency,
    onError: draft.onError,
    ...(draft.projectId ? { projectId: draft.projectId } : {}),
    ...(draft.fields.length ? { dataSchema: { version: 1 as const, format: 'json_array' as const, fields: draft.fields } } : {}),
    ...(dataset ? { defaultDataset: dataset } : {}),
    ...(draft.retry ? { retryPolicy: DEFAULT_RETRY } : {}),
    permissionMode: draft.permissionMode,
  };
}

export function updateBody(draft: AutomationDraft): UpdateAutomationParams {
  const { projectId: _p, ...rest } = createBody(draft);
  return rest as UpdateAutomationParams;
}

export const FIELD_TYPES: readonly DataFieldType[] = ['string', 'number', 'boolean', 'date', 'json'];

/** The review rows (page 6); each names the page that edits it. */
export function reviewRows(draft: AutomationDraft, names: { project: string; workflows: string[] }): Array<{ label: string; value: string; page: number; mono?: boolean }> {
  let dataset: ReturnType<typeof datasetOf>;
  try {
    dataset = datasetOf(draft);
  } catch {
    dataset = undefined;
  }
  return [
    { label: 'Basics', value: `${draft.name || 'Untitled'} · ${names.project}`, page: 0 },
    {
      label: 'Trigger',
      value:
        draft.triggerType === 'schedule'
          ? `${scheduleSummary(scheduleToCron(draft.schedule))} · missed: ${draft.missedRunPolicy === 'skip' ? 'skip' : 'run once'} · overlap: ${draft.overlapPolicy}`
          : TRIGGER_LABEL[draft.triggerType],
      page: 1,
    },
    { label: 'Workflow', value: names.workflows.join(', ') || '—', page: 2 },
    { label: 'Permission', value: PERMISSION_LABEL[draft.permissionMode], page: 2 },
    {
      label: 'Dataset',
      value: [draft.fields.map((f) => f.name).join(', '), dataset ? `${dataset.parsedRowCount} rows` : 'one run', `concurrency ${draft.maxConcurrency}`].filter(Boolean).join(' · '),
      page: 3,
    },
    { label: 'Variables', value: `${draft.variables.filter((v) => v.key.trim()).length} base variables`, page: 4 },
    { label: 'Retry', value: draft.retry ? `Up to ${DEFAULT_RETRY.maxAttempts} attempts` : 'No retries', page: 4 },
  ];
}

// ── Webhook ─────────────────────────────────────────────────────

/** The URL with the token left out (the token goes in `X-Webhook-Token`). */
export function webhookUrl(origin: string | null): string {
  return `${(origin ?? '').replace(/\/+$/, '')}/api/automations/webhooks/<token>`;
}

export function curlSample(fields: readonly DataFieldDef[]): string {
  const body = fields.length ? `{${fields.map((f) => `"${f.name}": ${f.type === 'number' ? 1 : f.type === 'boolean' ? 'true' : '"…"'}`).join(', ')}}` : '{}';
  return [`curl -X POST "$WEBHOOK_URL" \\`, '  -H "X-Webhook-Token: $TOKEN" \\', '  -H "X-Signature-256: sha256=$SIG" \\', `  -d '${body}'`].join('\n');
}
