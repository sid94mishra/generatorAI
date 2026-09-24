// ────────────────────────────────────────────────────────────────
// Automation detail — pure view logic.
//
// Kept free of React Native (and of runtime imports from client-core) so
// vitest can exercise it in node: next-run wording, trigger description,
// execution tone / activity, and the tap-intent idempotency key.
//
// Tested in src/__tests__/automationModel.test.ts.
// ────────────────────────────────────────────────────────────────

import type {
  AutomationExecutionStatus,
  AutomationRunItemStatus,
  AutomationTriggerType,
} from '@generatorai/shared';

/** What the wire actually carries for a timestamp (ISO string or epoch ms). */
export type WireTime = string | number | null | undefined;

/** The subset of `GET /api/automations/:id` the detail screen reads. */
export interface AutomationView {
  id: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  triggerType: AutomationTriggerType | string;
  cronExpression?: string | null;
  timezone?: string | null;
  nextRunAt?: WireTime;
  lastRunAt?: WireTime;
  workflowIds?: string[] | null;
  inputMode?: string | null;
  dataSchema?: unknown;
  defaultDataset?: unknown;
  executions?: ExecutionView[];
}

export interface ExecutionView {
  id: string;
  automationId?: string;
  status: AutomationExecutionStatus | string;
  triggeredBy?: AutomationTriggerType | string;
  totalIterations?: number;
  completedIterations?: number;
  failedIterations?: number;
  error?: string | null;
  startedAt?: WireTime;
  completedAt?: WireTime;
  createdAt?: WireTime;
}

export interface ExecutionRunView {
  id?: string;
  workflowRunId: string;
  workflowDefinitionId: string;
  iterationIndex?: number;
  iterationLabel?: string | null;
  status: AutomationRunItemStatus | string;
  attemptCount?: number;
}

export type ExecutionTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export function toMs(value: WireTime): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// ── Next run ───────────────────────────────────────────────────

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n: number) => String(n).padStart(2, '0');

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Wall-clock time of a future instant, in the phone's local zone. Written by
 * hand rather than with `toLocaleString` so the width does not change across
 * Hermes versions and the output is testable.
 */
export function absoluteLabel(at: number, now: number): string {
  const d = new Date(at);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const dayDiff = Math.round((startOfLocalDay(at) - startOfLocalDay(now)) / 86_400_000);
  if (dayDiff === 0) return `today ${time}`;
  if (dayDiff === 1) return `tomorrow ${time}`;
  if (dayDiff > 1 && dayDiff < 7) return `${WEEKDAYS[d.getDay()]} ${time}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${time}`;
}

/** "Next run in 25m · today 14:30", or null when there is nothing scheduled. */
export function nextRunLabel(nextRunAt: WireTime, now: number = Date.now()): string | null {
  const at = toMs(nextRunAt);
  if (at === null) return null;
  const delta = at - now;
  // The scheduler polls; a slot a few seconds overdue is simply about to fire.
  if (delta < 60_000) return 'Next run due now';
  const minutes = Math.floor(delta / 60_000);
  let relative: string;
  if (minutes < 60) relative = `${minutes}m`;
  else if (minutes < 24 * 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    relative = m ? `${h}h ${m}m` : `${h}h`;
  } else relative = `${Math.floor(minutes / (24 * 60))}d`;
  return `Next run in ${relative} · ${absoluteLabel(at, now)}`;
}

// ── Trigger ────────────────────────────────────────────────────

/** One line saying how this automation fires. */
export function triggerDescription(a: Pick<AutomationView, 'triggerType' | 'cronExpression' | 'timezone'>): string {
  if (a.triggerType === 'schedule') {
    const cron = a.cronExpression?.trim();
    if (!cron) return 'Schedule';
    const tz = a.timezone?.trim();
    return tz ? `Schedule · ${cron} (${tz})` : `Schedule · ${cron}`;
  }
  if (a.triggerType === 'webhook') return 'Webhook';
  return 'Manual';
}

export function triggeredByLabel(source: string | undefined | null): string {
  if (source === 'schedule') return 'Schedule';
  if (source === 'webhook') return 'Webhook';
  if (source === 'manual') return 'Manual';
  return 'Unknown';
}

/**
 * The trigger route refuses a schema-driven automation that has no dataset
 * to fall back on — the phone has no way to author one, so the button says
 * so instead of failing on tap.
 */
export function needsInputs(a: Pick<AutomationView, 'dataSchema' | 'defaultDataset'>): boolean {
  return Boolean(a.dataSchema) && !a.defaultDataset;
}

/** Workflow ids to list. */
export function workflowIdsOf(a: Pick<AutomationView, 'workflowIds'>): string[] {
  return Array.isArray(a.workflowIds) ? a.workflowIds.filter((x) => typeof x === 'string' && x) : [];
}

// ── Executions ─────────────────────────────────────────────────

/** Still in flight — worth polling for. `pending` counts: it is about to run. */
export function isExecutionActive(status: string | undefined | null): boolean {
  return status === 'pending' || status === 'running';
}

export function executionTone(status: string | undefined | null): ExecutionTone {
  switch (status) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'danger';
    // A batch that mostly failed must not read as a success.
    case 'partial':
      return 'warning';
    case 'pending':
    case 'running':
      return 'info';
    default:
      return 'neutral';
  }
}

export function executionStatusLabel(status: string | undefined | null): string {
  switch (status) {
    case 'partial':
      return 'Partly failed';
    case 'pending':
      return 'Starting';
    case undefined:
    case null:
    case '':
      return 'Unknown';
    default:
      return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
  }
}

/** "3/5 done · 1 failed", or null when the server reported no counts. */
export function executionCounts(e: Pick<ExecutionView, 'totalIterations' | 'completedIterations' | 'failedIterations'>): string | null {
  const total = e.totalIterations ?? 0;
  if (total <= 0) return null;
  const done = e.completedIterations ?? 0;
  const failed = e.failedIterations ?? 0;
  const noun = total === 1 ? 'iteration' : 'iterations';
  return failed > 0 ? `${done}/${total} ${noun} · ${failed} failed` : `${done}/${total} ${noun}`;
}

export function executionTime(e: Pick<ExecutionView, 'startedAt' | 'createdAt'>): number | null {
  return toMs(e.startedAt) ?? toMs(e.createdAt);
}

/** Newest first; executions without any time sink to the bottom. */
export function sortExecutions<T extends ExecutionView>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => (executionTime(b) ?? -Infinity) - (executionTime(a) ?? -Infinity));
}

export function executionPollInterval(list: readonly Pick<ExecutionView, 'status'>[] | undefined, ms = 5_000): number | false {
  return (list ?? []).some((e) => isExecutionActive(e.status)) ? ms : false;
}

/** The execution id a trigger response names (a fresh execution or an idempotent replay). */
export function executionIdOf(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null;
  const id = (response as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

// ── Idempotency ────────────────────────────────────────────────

/**
 * Key for ONE tap intent. The screen keeps it until the mutation settles so
 * a double tap (or a retry after a dropped response) replays instead of
 * starting a second execution.
 */
export function makeIdempotencyKey(
  automationId: string,
  now: () => number = Date.now,
  random: () => number = Math.random,
): string {
  const suffix = Math.floor(random() * 0x100000000)
    .toString(36)
    .padStart(7, '0');
  return `${automationId}:${now()}:${suffix}`;
}
