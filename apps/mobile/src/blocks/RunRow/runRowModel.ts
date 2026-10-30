// MB-49 RunRow model (03 MB-49; MD-25, MD-27): what one run row says. Inside a workflow the title is the status word
// (the glyph + word rule, MD-28) and the meta is the start time · version · trigger; elsewhere the title is the run
// (or its workflow) and the status word leads the meta. No "#248" until the server numbers runs (MG-29). The
// trailing duration is the finished run's length, or the elapsed time of a live one. Pure, unit-tested.
import { epochOr, runTitle } from '@generatorai/client-core';
import { resolveStatus, type ResolvedStatus } from '@generatorai/shared';

export interface RunRowInput {
  id: string;
  workflowDefinitionId: string;
  name?: string | null;
  status: string;
  createdAt: unknown;
  startedAt?: unknown;
  completedAt?: unknown;
  updatedAt?: unknown;
  trigger?: { kind: string; [key: string]: unknown } | null;
  ancestorRunId?: string | null;
  definitionVersionId?: string | null;
  error?: string | null;
}

export interface RunRowView {
  title: string;
  status: ResolvedStatus;
  meta: string[];
  /** "12m 40s" (finished) or "4:12" (live); null before it started. */
  duration: string | null;
  live: boolean;
  label: string;
}

const LIVE = new Set(['created', 'pending', 'starting', 'running', 'waiting', 'paused', 'finalizing', 'cancelling']);
const stamp = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** "Manual", "Automation", "Chat", "Fork"… — the WF-20 trigger chip's word. */
export function triggerLabel(trigger: RunRowInput['trigger'], ancestorRunId?: string | null): string | null {
  if (ancestorRunId || trigger?.kind === 'fork') return 'Fork';
  switch (trigger?.kind) {
    case 'user':
      return trigger['client'] === 'cli' || trigger['client'] === 'tui' ? 'CLI' : 'Manual';
    case 'automation':
      return 'Automation';
    case 'chat':
      return 'Chat';
    case 'orchestrator':
      return 'Orchestrator';
    case 'stage':
      return 'Sub-workflow';
    case 'external_agent':
      return 'Agent';
    default:
      return trigger ? null : 'Manual';
  }
}

/** A finished length, short: "45s", "6m 12s", "1h 3m". */
export function shortDuration(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

/** "Oct 3, 14:07" — a run's name on screens until runs are numbered (MG-29). */
export function runStamp(at: unknown): string {
  const t = epochOr(at as never, NaN);
  return Number.isNaN(t) ? '' : stamp.format(t);
}

export function runRowView(run: RunRowInput, opts: { context: 'workflow' | 'any'; versionLabel?: string | null; workflowName?: string; now?: number }): RunRowView {
  const status = resolveStatus('workflowRun', run.status as never) ?? resolveStatus('workflowRun', 'pending')!;
  const live = LIVE.has(run.status);
  const started = epochOr(run.startedAt as never, NaN);
  const ended = live ? (opts.now ?? Date.now()) : epochOr((run.completedAt ?? run.updatedAt) as never, NaN);
  const duration = Number.isNaN(started) || Number.isNaN(ended) ? null : shortDuration(ended - started);
  const when = runStamp(run.startedAt ?? run.createdAt);
  const trigger = triggerLabel(run.trigger, run.ancestorRunId);
  const version = opts.versionLabel ?? null;
  if (opts.context === 'workflow') {
    const meta = [when, version, trigger].filter((x): x is string => Boolean(x));
    return { title: status.label, status, meta, duration, live, label: [status.label, ...meta, duration].filter(Boolean).join(', ') };
  }
  const title = runTitle(run.name, opts.workflowName ?? 'Workflow run');
  const meta = [status.label, ...(opts.workflowName && title !== opts.workflowName ? [opts.workflowName] : []), when, trigger].filter((x): x is string => Boolean(x));
  return { title, status, meta, duration, live, label: [title, ...meta, duration].filter(Boolean).join(', ') };
}
