// ────────────────────────────────────────────────────────────────
// Loop model — how a run's loop, body, wrap-up and check instances read on
// the phone (P05 WP-5A.5).
//
// A loop instance (`kind: 'loop'`, instancePath `<loop>`) repeats its body;
// each body instance carries `scopeId` (the loop instance id) and
// `iterationIndex` (k, 0-based); a wrap-up instance has the scope but no
// iteration. A PARKED loop is `awaiting_input` with
// `interruptData.kind === 'loop_decision'` and is answered with the loop run
// commands (grant, raise budget, continue with input, accept, accept an
// iteration, fail) — never with the approval card.
//
// Maps, waits and sub-workflows (P05 5B): a map's items group under it like
// iterations (by `itemIndex`, labelled with their key); a wait reads its type
// and, as an approval, is answered with the `approve` command and its form;
// a sub-workflow names its child run.
//
// Pure, so the grouping and the decision options are testable without React
// Native. The run query's rows carry these fields (the server sends the full
// stage run); `StageRunSummary` only lacks their declarations.
// ────────────────────────────────────────────────────────────────

import type { StageRunSummary } from '@generatorai/client-core';
import type { LoopStateView, MapStateView, SubworkflowStateView } from '@generatorai/shared';

/** A stage run with the P05 control-flow fields the server sends. */
export type RunStage = StageRunSummary & {
  kind?: string;
  scopeId?: string | null;
  iterationIndex?: number | null;
  loopState?: Partial<LoopStateView> | null;
  itemIndex?: number | null;
  itemKey?: string | null;
  mapState?: MapStateView | null;
  subworkflowState?: SubworkflowStateView | null;
  callback?: { url: string; token: string } | null;
};

export function isMapStage(stage: RunStage): boolean {
  return stage.kind === 'map';
}

/** A map's progress, "3/7" (items settled of all). */
export function mapBadge(stage: RunStage): string | null {
  const ms = stage.mapState;
  if (!ms) return null;
  return `${ms.items.filter((i) => i.phase === 'done').length}/${ms.count}`;
}

/** An item's label: its key. */
export function itemLabel(map: RunStage, index: number): string {
  return map.mapState?.items[index]?.key ?? String(index + 1);
}

export interface WaitView {
  type: 'approval' | 'event' | 'timer';
  label: string | null;
  prompt: string | null;
  form: Record<string, unknown> | null;
  eventKey: string | null;
  until: number | null;
  outcome: string | null;
}

/** A wait instance's question (while waiting) and outcome (once resolved). */
export function waitOf(stage: RunStage): WaitView | null {
  if (stage.kind !== 'wait') return null;
  const d = rec(stage.interruptData);
  const o = rec(stage.outputData);
  const type = d['type'] === 'event' || d['type'] === 'timer' ? d['type'] : 'approval';
  const form = rec(d['form']);
  return {
    type,
    label: typeof d['label'] === 'string' ? d['label'] : null,
    prompt: typeof d['prompt'] === 'string' ? d['prompt'] : null,
    form: Object.keys(form).length > 0 ? form : null,
    eventKey: typeof d['eventKey'] === 'string' ? d['eventKey'] : null,
    until: num(d['until']),
    outcome: typeof o['outcome'] === 'string' ? o['outcome'] : null,
  };
}

/** A waiting approval wait (answered with `approve`, P05 §4.3). */
export function isApprovalWait(stage: RunStage): boolean {
  return stage.status === 'waiting' && waitOf(stage)?.type === 'approval';
}

/** The flat string / number / boolean / enum fields of a wait form; null when the form needs raw JSON. */
export function formFields(form: Record<string, unknown> | null): Array<{ name: string; type: 'string' | 'number' | 'boolean'; options: string[] | null; required: boolean }> | null {
  if (!form) return [];
  const props = rec(form['properties']);
  if (Object.keys(props).length === 0) return null;
  const required = new Set(Array.isArray(form['required']) ? (form['required'] as unknown[]).map(String) : []);
  const out: Array<{ name: string; type: 'string' | 'number' | 'boolean'; options: string[] | null; required: boolean }> = [];
  for (const [name, raw] of Object.entries(props)) {
    const p = rec(raw);
    const options = Array.isArray(p['enum']) && p['enum'].every((x) => typeof x === 'string') ? (p['enum'] as string[]) : null;
    const type = options ? 'string' : p['type'] === 'number' || p['type'] === 'integer' ? 'number' : p['type'] === 'boolean' ? 'boolean' : p['type'] === 'string' ? 'string' : null;
    if (!type) return null;
    out.push({ name, type, options, required: required.has(name) });
  }
  return out;
}

export function isLoopStage(stage: RunStage): boolean {
  return stage.kind === 'loop';
}

export function isCheckStage(stage: RunStage): boolean {
  return stage.kind === 'check';
}

// ── Parked loop ────────────────────────────────────────────────

export interface LoopDecisionView {
  /** `pause`: an exit rule asked for a person; `exhaust`: a limit was hit with onLimit=pause. */
  action: 'pause' | 'exhaust';
  reason: string;
  /** The last finished iteration (0-based; -1 when none finished). */
  k: number;
  iterations: number;
  maxIterations: number | null;
  /** Iterations whose workspace was checkpointed. */
  checkpoints: number[];
  scores: Array<{ k: number; score: number | null }>;
  budget: Record<string, number>;
  usage: Record<string, unknown>;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** The parked loop's payload, or null when `interruptData` is not a loop decision. */
export function loopDecisionOf(interruptData: unknown): LoopDecisionView | null {
  const d = rec(interruptData);
  if (d['kind'] !== 'loop_decision') return null;
  const budget: Record<string, number> = {};
  for (const [key, value] of Object.entries(rec(d['budget']))) {
    const n = num(value);
    if (n !== null) budget[key] = n;
  }
  const iterations = num(d['iterations']) ?? 0;
  return {
    action: d['action'] === 'exhaust' ? 'exhaust' : 'pause',
    reason: typeof d['reason'] === 'string' ? d['reason'] : '',
    k: num(d['k']) ?? iterations - 1,
    iterations,
    maxIterations: num(d['maxIterations']),
    checkpoints: Array.isArray(d['checkpoints'])
      ? (d['checkpoints'] as unknown[]).map(num).filter((n): n is number => n !== null)
      : [],
    scores: Array.isArray(d['scores'])
      ? (d['scores'] as unknown[]).flatMap((s) => {
          const k = num(rec(s)['k']);
          return k === null ? [] : [{ k, score: num(rec(s)['score']) }];
        })
      : [],
    budget,
    usage: rec(d['usage']),
  };
}

/** A loop waiting for an operator decision. */
export function isParkedLoop(stage: RunStage): boolean {
  return stage.status === 'awaiting_input' && loopDecisionOf(stage.interruptData) !== null;
}

/**
 * The iterations `accept_iteration` can take: every checkpointed one plus
 * the last (which needs no restore). Oldest first.
 */
export function acceptableIterations(view: LoopDecisionView): number[] {
  const out = new Set(view.checkpoints.filter((k) => k >= 0 && k <= view.k));
  if (view.k >= 0) out.add(view.k);
  return [...out].sort((a, b) => a - b);
}

/** `max_iterations` → `max iterations`. */
export function reasonLabel(reason: string | null | undefined): string {
  return reason ? reason.replace(/[_:]+/g, ' ').trim() : '';
}

/** The card's one-line "why": the loop hit a limit, or a rule paused it. */
export function decisionHeadline(view: LoopDecisionView): string {
  const reason = reasonLabel(view.reason);
  if (view.action === 'exhaust') return reason ? `Ran out: ${reason}` : 'The loop ran out';
  return reason ? `Paused: ${reason}` : 'A rule paused the loop';
}

/** Spend so far against the budget, as short parts ("12/20 turns", "$0.42/$1.00"). */
export function budgetParts(view: LoopDecisionView): string[] {
  const parts: string[] = [];
  const turns = num(view.usage['turns']);
  const cost = num(view.usage['costUsd']);
  const tokens = (num(view.usage['inputTokens']) ?? 0) + (num(view.usage['outputTokens']) ?? 0);
  const of = (limit: number | undefined, fmt: (n: number) => string) => (limit !== undefined ? `/${fmt(limit)}` : '');
  if (turns !== null || view.budget['maxTurns'] !== undefined) {
    parts.push(`${turns ?? 0}${of(view.budget['maxTurns'], String)} turns`);
  }
  if (cost !== null || view.budget['maxCostUsd'] !== undefined) {
    const usd = (n: number) => `$${n.toFixed(2)}`;
    parts.push(`${usd(cost ?? 0)}${of(view.budget['maxCostUsd'], usd)}`);
  }
  if (tokens > 0 || view.budget['maxTokens'] !== undefined) {
    const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
    parts.push(`${k(tokens)}${of(view.budget['maxTokens'], k)} tokens`);
  }
  if (view.budget['maxWallClockMs'] !== undefined) {
    parts.push(`${Math.round(view.budget['maxWallClockMs'] / 60_000)} min limit`);
  }
  return parts;
}

/** A refusal's text for the operator — the server's code prefix made readable. */
export function loopCommandError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  if (text.includes('checkpoint_unavailable')) {
    const detail = text.split('checkpoint_unavailable:')[1]?.trim();
    return `That iteration has no workspace checkpoint to restore.${detail ? ` ${detail}` : ''}`;
  }
  return text;
}

// ── Status rows ────────────────────────────────────────────────

/** `3/5`: the current (or last) iteration against the effective maximum. */
export function loopBadge(stage: RunStage): string | null {
  const ls = stage.loopState;
  if (!ls || typeof ls.effectiveMax !== 'number') return null;
  const k = typeof ls.k === 'number' ? ls.k : 0;
  return `${Math.min(k + 1, Math.max(ls.effectiveMax, k + 1))}/${ls.effectiveMax}`;
}

/** Why a finished loop stopped ("exit: tests pass · accept"), or null while it runs. */
export function loopExitLabel(stage: RunStage): string | null {
  const ls = stage.loopState;
  if (!ls || ls.phase !== 'done' || !ls.exitReason) return null;
  const action = ls.exitAction && ls.exitAction !== 'complete' ? ` · ${reasonLabel(ls.exitAction)}` : '';
  return `exit: ${reasonLabel(ls.exitReason)}${action}`;
}

export interface CheckResult {
  passed: boolean;
  exitCode: number | null;
  timedOut: boolean;
  stdoutTail: string;
  stderrTail: string;
}

/** A check stage's verdict, or null before it has one. */
export function checkResultOf(stage: RunStage): CheckResult | null {
  if (!isCheckStage(stage) || !stage.outputData) return null;
  const d = stage.outputData;
  if (typeof d['passed'] !== 'boolean') return null;
  return {
    passed: d['passed'],
    exitCode: num(d['exitCode']),
    timedOut: d['timedOut'] === true,
    stdoutTail: typeof d['stdoutTail'] === 'string' ? d['stdoutTail'] : '',
    stderrTail: typeof d['stderrTail'] === 'string' ? d['stderrTail'] : '',
  };
}

/** "Passed · exit 0", "Failed · exit 1", "Timed out". */
export function checkLabel(result: CheckResult): string {
  if (result.timedOut) return 'Timed out';
  const code = result.exitCode !== null ? ` · exit ${result.exitCode}` : '';
  return `${result.passed ? 'Passed' : 'Failed'}${code}`;
}

// ── Grouping ───────────────────────────────────────────────────

export interface StageNode {
  stage: RunStage;
  /** Set on a loop: its body by iteration (oldest first) and its wrap-up. */
  loop?: {
    iterations: Array<{ k: number; nodes: StageNode[] }>;
    wrapUp: StageNode[];
  };
}

/**
 * The run's stages as a tree: top-level instances in the server's order, each
 * loop holding its body instances grouped by iteration and its wrap-up.
 * An instance whose scope is not in the list stays at the top level, so
 * nothing the server sent is ever hidden.
 */
export function stageTree(stages: readonly RunStage[]): StageNode[] {
  const ids = new Set(stages.map((s) => s.id));
  const children = new Map<string, RunStage[]>();
  const top: RunStage[] = [];
  for (const stage of stages) {
    const scope = stage.scopeId ?? null;
    if (scope && scope !== stage.id && ids.has(scope)) {
      const list = children.get(scope);
      if (list) list.push(stage);
      else children.set(scope, [stage]);
    } else {
      top.push(stage);
    }
  }

  const seen = new Set<string>();
  const build = (stage: RunStage): StageNode => {
    seen.add(stage.id);
    const kids = (children.get(stage.id) ?? []).filter((c) => !seen.has(c.id));
    if (kids.length === 0 && !isLoopStage(stage) && !isMapStage(stage)) return { stage };
    const byK = new Map<number, RunStage[]>();
    const wrap: RunStage[] = [];
    for (const kid of kids) {
      // A loop's body by iteration; a map's by item (P05 §4.1).
      const k = typeof kid.iterationIndex === 'number' ? kid.iterationIndex : typeof kid.itemIndex === 'number' ? kid.itemIndex : null;
      if (k === null) wrap.push(kid);
      else {
        const list = byK.get(k);
        if (list) list.push(kid);
        else byK.set(k, [kid]);
      }
    }
    return {
      stage,
      loop: {
        iterations: [...byK.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([k, list]) => ({ k, nodes: list.map(build) })),
        wrapUp: wrap.map(build),
      },
    };
  };
  return top.map(build);
}

/** Every parked loop in the run, in the order they appear. */
export function parkedLoops(stages: readonly RunStage[]): RunStage[] {
  return stages.filter(isParkedLoop);
}
