// ────────────────────────────────────────────────────────────────
// Loops in the run pane (P05 WP-5A.5).
//
// A loop instance (`kind: 'loop'`) repeats its body; each body instance
// carries `scopeId` (the loop instance id) and `iterationIndex` (k, 0-based),
// a wrap-up instance has the scope but no iteration. A PARKED loop is
// `awaiting_input` with `interruptData.kind === 'loop_decision'` and is
// answered with the loop run commands (`run command`), not with approve.
//
// Pure: the run pane renders `stageLines`, `App.tsx` builds the decision
// overlay from `loopDecisionOptions` and turns a choice into a command with
// `loopCommandFor`. Stages are trimmed (`toLoopStages`) before they go into
// the pane's state, so the persisted workbench stays small.
// ────────────────────────────────────────────────────────────────

export interface LoopDecision {
  action: 'pause' | 'exhaust';
  reason: string;
  /** The last finished iteration (0-based; -1 when none finished). */
  k: number;
  iterations: number;
  maxIterations: number | null;
  checkpoints: number[];
}

export interface LoopStage {
  id: string;
  stageKey: string;
  name?: string;
  status: string;
  kind?: string;
  scopeId?: string;
  iterationIndex?: number;
  loop?: { k: number; phase: string; effectiveMax: number; exitReason: string | null; exitAction: string | null };
  decision?: LoopDecision;
  check?: { passed: boolean; exitCode: number | null; timedOut: boolean };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function loopDecisionOf(interruptData: unknown): LoopDecision | null {
  const d = rec(interruptData);
  if (d['kind'] !== 'loop_decision') return null;
  const iterations = num(d['iterations']) ?? 0;
  return {
    action: d['action'] === 'exhaust' ? 'exhaust' : 'pause',
    reason: str(d['reason']) ?? '',
    k: num(d['k']) ?? iterations - 1,
    iterations,
    maxIterations: num(d['maxIterations']),
    checkpoints: Array.isArray(d['checkpoints'])
      ? (d['checkpoints'] as unknown[]).map(num).filter((n): n is number => n !== null)
      : [],
  };
}

/** The fields the run pane needs, from whatever `runs.stages` returned. */
export function toLoopStages(stages: readonly unknown[]): LoopStage[] {
  return stages.map((raw) => {
    const s = rec(raw);
    const out: LoopStage = {
      id: String(s['id'] ?? ''),
      stageKey: String(s['stageKey'] ?? ''),
      status: String(s['status'] ?? ''),
    };
    const name = str(s['name']);
    if (name) out.name = name;
    const kind = str(s['kind']);
    if (kind) out.kind = kind;
    const scopeId = str(s['scopeId']);
    if (scopeId) out.scopeId = scopeId;
    const k = num(s['iterationIndex']);
    if (k !== null) out.iterationIndex = k;
    const ls = rec(s['loopState']);
    const max = num(ls['effectiveMax']);
    if (max !== null) {
      out.loop = {
        k: num(ls['k']) ?? 0,
        phase: str(ls['phase']) ?? '',
        effectiveMax: max,
        exitReason: str(ls['exitReason']),
        exitAction: str(ls['exitAction']),
      };
    }
    if (out.status === 'awaiting_input') {
      const decision = loopDecisionOf(s['interruptData']);
      if (decision) out.decision = decision;
    }
    if (kind === 'check') {
      const o = rec(s['outputData']);
      if (typeof o['passed'] === 'boolean') {
        out.check = { passed: o['passed'], exitCode: num(o['exitCode']), timedOut: o['timedOut'] === true };
      }
    }
    return out;
  });
}

/** Whether the run has anything the plain event timeline cannot show: a loop or a check. */
export function hasControlFlow(stages: readonly LoopStage[]): boolean {
  return stages.some((s) => s.kind === 'loop' || s.kind === 'check');
}

/** The first loop waiting for a decision. */
export function parkedLoop(stages: readonly LoopStage[]): LoopStage | null {
  return stages.find((s) => s.decision !== undefined) ?? null;
}

export function reasonLabel(reason: string | null | undefined): string {
  return reason ? reason.replace(/[_:]+/g, ' ').trim() : '';
}

export function decisionHeadline(decision: LoopDecision): string {
  const reason = reasonLabel(decision.reason);
  if (decision.action === 'exhaust') return reason ? `ran out: ${reason}` : 'ran out';
  return reason ? `paused: ${reason}` : 'paused by a rule';
}

export type LineTone = 'warning' | 'danger' | 'success' | 'muted' | 'default';

export interface StageLine {
  id: string;
  depth: number;
  status: string;
  label: string;
  detail: string;
  tone: LineTone;
}

function toneOf(status: string): LineTone {
  if (status === 'failed') return 'danger';
  if (status === 'awaiting_input' || status === 'paused') return 'warning';
  if (status === 'completed') return 'success';
  if (status === 'skipped' || status === 'cancelled') return 'muted';
  return 'default';
}

function lineFor(stage: LoopStage, depth: number, prefix: string): StageLine {
  const parts: string[] = [];
  let tone = toneOf(stage.status);
  if (stage.kind === 'loop' && stage.loop) {
    parts.push(`loop ${Math.min(stage.loop.k + 1, Math.max(stage.loop.effectiveMax, stage.loop.k + 1))}/${stage.loop.effectiveMax}`);
    if (stage.decision) {
      parts.push(`needs decision (${decisionHeadline(stage.decision)})`);
      tone = 'warning';
    } else if (stage.loop.phase === 'done' && stage.loop.exitReason) {
      const action = stage.loop.exitAction && stage.loop.exitAction !== 'complete' ? `, ${reasonLabel(stage.loop.exitAction)}` : '';
      parts.push(`exit: ${reasonLabel(stage.loop.exitReason)}${action}`);
    } else {
      parts.push(stage.status);
    }
  } else if (stage.check) {
    const code = stage.check.exitCode !== null ? ` (exit ${stage.check.exitCode})` : '';
    parts.push(stage.check.timedOut ? 'check timed out' : `check ${stage.check.passed ? 'passed' : 'failed'}${code}`);
    tone = stage.check.passed ? 'success' : 'danger';
  } else {
    parts.push(stage.status);
  }
  return {
    id: stage.id,
    depth,
    status: stage.status,
    label: `${prefix}${stage.name || stage.stageKey}`,
    detail: parts.join(' · '),
    tone,
  };
}

/**
 * The run's stages as indented lines: every top-level instance, and under
 * each loop its LATEST iteration's body (labelled `#k`), a one-line summary
 * of the earlier iterations, and its wrap-up.
 */
export function stageLines(stages: readonly LoopStage[]): StageLine[] {
  const ids = new Set(stages.map((s) => s.id));
  const children = new Map<string, LoopStage[]>();
  const top: LoopStage[] = [];
  for (const stage of stages) {
    if (stage.scopeId && stage.scopeId !== stage.id && ids.has(stage.scopeId)) {
      const list = children.get(stage.scopeId);
      if (list) list.push(stage);
      else children.set(stage.scopeId, [stage]);
    } else {
      top.push(stage);
    }
  }
  const out: StageLine[] = [];
  const seen = new Set<string>();
  const walk = (list: readonly LoopStage[], depth: number, prefix: string): void => {
    for (const stage of list) {
      if (seen.has(stage.id)) continue;
      seen.add(stage.id);
      out.push(lineFor(stage, depth, prefix));
      const kids = children.get(stage.id);
      if (!kids?.length) continue;
      const ks = [...new Set(kids.map((c) => c.iterationIndex).filter((k): k is number => k !== undefined))].sort((a, b) => a - b);
      const latest = ks[ks.length - 1];
      if (latest !== undefined && ks.length > 1) {
        out.push({
          id: `${stage.id}:earlier`,
          depth: depth + 1,
          status: 'completed',
          label: ks.length === 2 ? `#1 done` : `#1–#${ks.length - 1} done`,
          detail: '',
          tone: 'muted',
        });
      }
      if (latest !== undefined) {
        walk(kids.filter((c) => c.iterationIndex === latest), depth + 1, `#${latest + 1} `);
      }
      walk(kids.filter((c) => c.iterationIndex === undefined), depth + 1, 'wrap-up ');
    }
  };
  walk(top, 0, '');
  return out;
}

// ── Decisions ───────────────────────────────────────────────────

export interface DecisionOption {
  /** The overlay's hotkey. */
  key: string;
  value: string;
  label: string;
  detail?: string;
}

/** What the operator can do with a parked loop, in the overlay's order. */
export function loopDecisionOptions(decision: LoopDecision): DecisionOption[] {
  const earlier = decision.checkpoints.filter((k) => k >= 0 && k < decision.k).sort((a, b) => b - a);
  const options: DecisionOption[] = [
    { key: 'g', value: 'grant:1', label: 'Grant +1 iteration' },
    { key: 'G', value: 'grant:2', label: 'Grant +2 iterations' },
    { key: 'i', value: 'input', label: 'Continue with input…', detail: 'a message for the next iteration' },
  ];
  if (decision.k >= 0) {
    options.push({ key: 'a', value: 'accept', label: `Accept (iteration ${decision.k + 1}, the last)` });
  }
  earlier.forEach((k, index) => {
    options.push({
      key: index < 9 ? String(index + 1) : '',
      value: `accept_iteration:${k}`,
      label: `Accept iteration ${k + 1}`,
      detail: 'restores its workspace checkpoint',
    });
  });
  options.push(
    { key: 'b', value: 'budget', label: 'Raise budget…', detail: 'turns=20 cost=2.5 tokens=200000 minutes=30' },
    { key: 'f', value: 'fail', label: 'Fail the loop' },
  );
  return options;
}

/**
 * Parses the raise-budget text (`turns=20 cost=2.5 tokens=200000 minutes=30`)
 * into the command's fields; null when nothing valid was given.
 */
export function parseBudget(text: string): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const part of text.split(/[\s,]+/)) {
    const [rawKey, rawValue] = part.split('=');
    const key = rawKey?.trim().toLowerCase();
    const value = Number(rawValue);
    if (!key || !Number.isFinite(value) || value <= 0) continue;
    if (key === 'turns') out['maxTurns'] = Math.round(value);
    else if (key === 'cost' || key === 'usd') out['maxCostUsd'] = value;
    else if (key === 'tokens') out['maxTokens'] = Math.round(value);
    else if (key === 'minutes' || key === 'min') out['maxWallClockMs'] = Math.max(1000, Math.round(value * 60_000));
  }
  return Object.keys(out).length > 0 ? out : null;
}
