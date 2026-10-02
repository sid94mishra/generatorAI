// Pure step presentation (MB-11 StepRow, MB-13 StepGroupCard, MB-17 DelegationGroup): the "tool block" title in
// words, its sub-line, the runs a steps segment splits into, and the outcome line of one step.
import { formatStepDuration, type TimelineStep } from '@generatorai/client-core';
import { STEP_VERBS, type StepKind } from '@generatorai/shared/ui-contract';

/** A steps segment in order: tool steps fold into one tool block, delegations into a DelegationGroup. */
export type StepRun = { type: 'tools'; id: string; steps: TimelineStep[] } | { type: 'delegation'; id: string; steps: TimelineStep[] };

export function stepRuns(steps: readonly TimelineStep[]): StepRun[] {
  const out: StepRun[] = [];
  for (const step of steps) {
    const type = step.kind === 'delegate' ? 'delegation' : 'tools';
    const last = out[out.length - 1];
    if (last && last.type === type) last.steps.push(step);
    else out.push({ type, id: `${type}-${step.id}`, steps: [step] });
  }
  return out;
}

const counted = (steps: readonly TimelineStep[]) => steps.filter((s) => s.kind !== 'note' && s.kind !== 'think');

/** "Read 3 files, ran 2 commands, edited 1 file" — one phrase per kind, in the order each kind first ran. */
export function toolBlockTitle(steps: readonly TimelineStep[]): string {
  const order: StepKind[] = [];
  const counts = new Map<StepKind, number>();
  for (const s of counted(steps)) {
    if (!counts.has(s.kind)) order.push(s.kind);
    counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
  }
  const phrases = order.map((kind, i) => {
    const phrase = STEP_VERBS[kind].group(counts.get(kind)!);
    return i === 0 ? phrase : phrase.charAt(0).toLowerCase() + phrase.slice(1);
  });
  return phrases.join(', ') || 'Worked';
}

export interface ToolBlockSummary {
  title: string;
  running: boolean;
  failed: number;
  /** Mono "6 steps · 2m 44s". */
  meta: string;
  /** The step in flight (running blocks show it under the title). */
  current?: TimelineStep;
}

export function toolBlockSummary(steps: readonly TimelineStep[]): ToolBlockSummary {
  const list = counted(steps);
  const current = [...list].reverse().find((s) => s.status === 'running' || s.status === 'waiting');
  const failed = list.filter((s) => s.status === 'failed').length;
  const total = list.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
  const duration = total > 0 ? formatStepDuration(total) : null;
  const meta = [`${list.length} step${list.length === 1 ? '' : 's'}`, duration].filter(Boolean).join(' · ');
  if (current) {
    const live = STEP_VERBS[current.kind].groupLive;
    return { title: `${live}… ${list.length} so far`, running: true, failed, meta, current };
  }
  return { title: toolBlockTitle(steps), running: false, failed, meta };
}

/** The spoken name of a tool block (MB-13 a11y). */
export function toolBlockLabel(summary: ToolBlockSummary): string {
  return ['Tool steps', summary.title, summary.failed ? `${summary.failed} failed` : null, summary.meta].filter(Boolean).join(', ');
}

/** The optional second line of a step: an outcome in words, or the step's own meta. */
export function stepOutcome(step: TimelineStep): { text: string; tone: 'err' | 'ok' | 'fg-3' | 'warn' } | null {
  if (step.status === 'waiting') return { text: 'Waiting for you', tone: 'warn' };
  if (step.status === 'failed' && step.kind !== 'error' && step.kind !== 'warning') {
    const first = step.errorText?.split('\n')[0]?.trim();
    return { text: first && first.length <= 60 ? first : 'Failed', tone: 'err' };
  }
  if (step.meta) return { text: step.meta, tone: /passed|succeeded/i.test(step.meta) ? 'ok' : 'fg-3' };
  return null;
}

/** Inline failure excerpt (MB-16): at most 12 lines, and whether more exist. */
export function errorExcerpt(text: string | undefined, max = 12): { lines: string[]; more: boolean } | null {
  if (!text?.trim()) return null;
  const lines = text.replace(/\s+$/, '').split('\n');
  return { lines: lines.slice(0, max), more: lines.length > max };
}
