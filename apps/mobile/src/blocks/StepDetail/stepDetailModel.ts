// MB-14 step detail model (pure): one tool call of a chat as the detail screen shows it — the step (client-core
// `deriveTimeline` of that call), its place among the chat's steps (↑ / ↓, "Step 4 of 6"), the kind noun of the
// title, the exit code of a shell call when the result says it, and the input / output texts.
import { deriveTimeline, type StreamBlock, type TimelineStep } from '@generatorai/client-core';
import type { StepKind } from '@generatorai/shared/ui-contract';

type ToolCall = Extract<StreamBlock, { type: 'tool_call' }>;

const NOUNS: Partial<Record<StepKind, string>> = {
  run: 'Command',
  edit: 'Edit',
  read: 'Read',
  search: 'Search',
  browser: 'Browser',
  computer: 'Computer',
  delegate: 'Task',
  memory: 'Memory',
  plan: 'Plan',
  widget: 'Widget',
};

export interface StepDetailView {
  step: TimelineStep;
  call: ToolCall;
  index: number;
  total: number;
  previous: { callId: string; label: string } | null;
  next: { callId: string; label: string } | null;
  noun: string;
  exitCode: number | null;
  input: string;
  output: string;
  shell: boolean;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** What the step was given: the command for shells, else the pretty arguments. */
export function stepInput(call: Pick<ToolCall, 'args'>): string {
  const args = record(call.args);
  const command = args?.['command'];
  if (typeof command === 'string') return command;
  if (call.args === undefined || call.args === null) return '';
  try {
    return JSON.stringify(call.args, null, 2);
  } catch {
    return String(call.args);
  }
}

/** What the step returned, as text (string results verbatim; `{ output | stdout | content }` objects unwrapped). */
export function stepOutput(call: Pick<ToolCall, 'result'>): string {
  const r = call.result;
  if (r === undefined || r === null) return '';
  if (typeof r === 'string') return r;
  const o = record(r);
  for (const key of ['output', 'stdout', 'content', 'text', 'error']) {
    const v = o?.[key];
    if (typeof v === 'string' && v) return v;
  }
  try {
    return JSON.stringify(r, null, 2);
  } catch {
    return String(r);
  }
}

export function stepExitCode(call: Pick<ToolCall, 'result'>): number | null {
  const o = record(call.result);
  const v = o?.['exitCode'] ?? o?.['exit_code'] ?? o?.['code'];
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

/** The last `max` lines of a long output, and how many there are (MB-14 "last N of M lines"). */
export function outputTail(text: string, max = 40): { text: string; shown: number; total: number } {
  const lines = text.replace(/\s+$/, '').split('\n');
  return lines.length <= max ? { text: lines.join('\n'), shown: lines.length, total: lines.length } : { text: lines.slice(-max).join('\n'), shown: max, total: lines.length };
}

const labelOf = (call: ToolCall): string => {
  const step = deriveTimeline([call], { active: false })[0];
  return step ? `${step.verb} ${step.target}`.trim() : call.tool;
};

export function stepDetailView(calls: readonly ToolCall[], callId: string, live: boolean): StepDetailView | null {
  const index = calls.findIndex((c) => c.callId === callId);
  if (index < 0) return null;
  const call = calls[index]!;
  const step = deriveTimeline([call], { active: live })[0];
  if (!step) return null;
  const prev = calls[index - 1];
  const next = calls[index + 1];
  return {
    step,
    call,
    index,
    total: calls.length,
    previous: prev ? { callId: prev.callId, label: labelOf(prev) } : null,
    next: next ? { callId: next.callId, label: labelOf(next) } : null,
    noun: NOUNS[step.kind] ?? 'Step',
    exitCode: stepExitCode(call),
    input: stepInput(call),
    output: stepOutput(call),
    shell: step.isShell === true,
  };
}
