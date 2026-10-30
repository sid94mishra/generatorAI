// ────────────────────────────────────────────────────────────────
// groupSteps — fold runs of related tool calls into one collapsible row.
//
// An agent that reads eight files in a row used to cost the transcript eight
// timeline rows before it said a single word. Nobody reads those rows one by
// one; they want "read 8 files" and the option to look. So consecutive steps
// of the same KIND (read / search / edit / run / generic tool / memory) fold
// into a `StepGroup` once there are at least `MIN_GROUP` of them. Thinking,
// sub-agents, warnings and errors always stand alone — they are the rows a
// reader stops on.
//
// A group is pure data derived from the steps it holds; `StepGroupRow`
// renders it and expands to the ordinary `StepRow`s beneath. The group's id
// is its first step's id, so an open group stays open (same React key) while
// a live turn keeps appending to it.
// ────────────────────────────────────────────────────────────────

import { STEP_VERBS } from '@generatorai/shared/ui-contract';
import type { StepKind, StepStatus, TimelineStep } from './types.js';

/** Runs shorter than this render as plain rows. */
export const MIN_GROUP = 2;

export interface StepGroup {
  type: 'group';
  id: string;
  kind: StepKind;
  steps: TimelineStep[];
  /** Headline, e.g. "Read 5 files", "Searched 3 times". */
  label: string;
  /** Sub-line: the distinct targets, most recent first, joined. */
  summary: string;
  status: StepStatus;
  /** How many of the steps failed. */
  failed: number;
  /** Aggregate +/− across file ops (edit groups only). */
  fileOps?: { files: number; additions: number; deletions: number };
  durationMs?: number;
}

export type TimelineEntry = { type: 'step'; step: TimelineStep } | StepGroup;

function groupStatus(steps: TimelineStep[]): StepStatus {
  // Live states win — a group with anything still running IS running.
  if (steps.some((s) => s.status === 'running')) return 'running';
  if (steps.some((s) => s.status === 'waiting')) return 'waiting';
  if (steps.some((s) => s.status === 'pending')) return 'pending';
  if (steps.some((s) => s.status === 'failed')) return 'failed';
  return 'done';
}

/** Distinct targets, newest first, capped so the sub-line stays one line. */
function summarize(steps: TimelineStep[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const t = steps[i]!.target.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 4) break;
  }
  const rest = countTargets(steps) - out.length;
  return rest > 0 ? `${out.join(', ')} +${rest} more` : out.join(', ');
}

function countTargets(steps: TimelineStep[]): number {
  const s = new Set<string>();
  for (const st of steps) if (st.target.trim()) s.add(st.target.trim());
  return s.size;
}

function buildGroup(steps: TimelineStep[]): StepGroup {
  const kind = steps[0]!.kind;
  const status = groupStatus(steps);
  const failed = steps.filter((s) => s.status === 'failed').length;
  const labels = STEP_VERBS[kind];
  const distinct = kind === 'read' || kind === 'edit' ? countTargets(steps) || steps.length : steps.length;
  // A run of one generic/MCP tool is named after that tool ("navigate_page ×3")
  // — "3 tool calls" says nothing the reader can use.
  const sameVerb = kind === 'tool' && steps.every((s) => s.verb === steps[0]!.verb) ? steps[0]!.verb : null;
  const label = status === 'running'
    ? (sameVerb ? `${sameVerb} · running (${steps.length})` : `${labels.groupLive} (${steps.length})`)
    : (sameVerb ? `${sameVerb} ×${steps.length}` : labels.group(distinct));
  let fileOps: StepGroup['fileOps'];
  if (kind === 'edit') {
    const files = new Set<string>();
    let additions = 0;
    let deletions = 0;
    for (const s of steps) {
      if (!s.fileOp) continue;
      files.add(s.fileOp.filePath);
      additions += s.fileOp.additions;
      deletions += s.fileOp.deletions;
    }
    if (files.size > 0) fileOps = { files: files.size, additions, deletions };
  }
  let durationMs = 0;
  let hasDuration = false;
  for (const s of steps) {
    if (s.durationMs != null) {
      durationMs += s.durationMs;
      hasDuration = true;
    }
  }
  return {
    type: 'group',
    id: `group-${steps[0]!.id}`,
    kind,
    steps,
    label,
    summary: summarize(steps),
    status,
    failed,
    ...(fileOps ? { fileOps } : {}),
    ...(hasDuration ? { durationMs } : {}),
  };
}

/**
 * Fold a step list into render entries. Pure and cheap (one pass), so
 * callers can run it on every derivation.
 */
export function groupSteps(steps: readonly TimelineStep[]): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  let run: TimelineStep[] = [];
  const flush = () => {
    if (run.length === 0) return;
    if (run.length >= MIN_GROUP) out.push(buildGroup(run));
    else for (const s of run) out.push({ type: 'step', step: s });
    run = [];
  };
  for (const step of steps) {
    // A step with children (an Agent call) is a container in its own right.
    const groupable = STEP_VERBS[step.kind].groupable && !(step.children && step.children.length > 0);
    if (!groupable) {
      flush();
      out.push({ type: 'step', step });
      continue;
    }
    if (run.length > 0 && run[0]!.kind !== step.kind) flush();
    run.push(step);
  }
  flush();
  return out;
}
