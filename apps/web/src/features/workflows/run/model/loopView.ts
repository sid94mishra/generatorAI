// ────────────────────────────────────────────────────────────────
// loopView — a loop instance (P05) as the run page shows it.
//
// Pure helpers shared by the timeline (deriveRunView), the runtime
// graph node and the event timeline: the `n/max` badge, the exit rules
// with their streaks ("tests_pass 0/1 · no_fewer_failures 1/2"), the
// parked decision (`interruptData.kind === 'loop_decision'`) and the
// shape of loop instance paths (`<loop>#<k>/<body>`, `<loop>#wrapup/<body>`).
// ────────────────────────────────────────────────────────────────

import type { StageRun } from '@generatorai/shared';
import type { StageSpec } from '@generatorai/workflow-spec';
import type { LoopDecisionView, LoopRuleView, LoopView } from './types.js';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** A parked loop's decision payload, or undefined when the instance is not parked on one. */
export function loopDecisionOf(interruptData: unknown): LoopDecisionView | undefined {
  if (!isRecord(interruptData) || interruptData['kind'] !== 'loop_decision') return undefined;
  const d = interruptData;
  const usage = isRecord(d['usage']) ? d['usage'] : {};
  const budget = isRecord(d['budget']) ? d['budget'] : {};
  const pick = <K extends string>(src: Record<string, unknown>, keys: readonly K[]) => {
    const out: Partial<Record<K, number>> = {};
    for (const key of keys) {
      const v = num(src[key]);
      if (v !== undefined) out[key] = v;
    }
    return out;
  };
  return {
    action: typeof d['action'] === 'string' ? d['action'] : 'pause',
    reason: typeof d['reason'] === 'string' ? d['reason'] : '',
    k: num(d['k']) ?? -1,
    iterations: num(d['iterations']) ?? 0,
    maxIterations: num(d['maxIterations']) ?? 0,
    usage: pick(usage, ['turns', 'costUsd', 'inputTokens', 'outputTokens'] as const),
    budget: pick(budget, ['maxTurns', 'maxCostUsd', 'maxTokens', 'maxWallClockMs'] as const),
    checkpoints: Array.isArray(d['checkpoints']) ? d['checkpoints'].filter((k): k is number => typeof k === 'number') : [],
    scores: Array.isArray(d['scores'])
      ? d['scores'].flatMap((s) => (isRecord(s) && typeof s['k'] === 'number'
        ? [{ k: s['k'], score: typeof s['score'] === 'number' ? s['score'] : null }]
        : []))
      : [],
  };
}

/** A loop instance's view; undefined for any other kind. */
export function deriveLoopView(sr: StageRun, def: StageSpec | undefined): LoopView | undefined {
  if (sr.kind !== 'loop' && def?.kind !== 'loop') return undefined;
  const spec = def?.kind === 'loop' ? def.loop : undefined;
  const ls = sr.loopState;
  const exits = spec?.exits ?? [];
  const rules: LoopRuleView[] = exits.map((rule, i) => ({
    reason: rule.reason,
    action: rule.action,
    consecutive: rule.consecutive ?? 1,
    streak: ls?.streaks?.[i] ?? 0,
    when: rule.when,
  }));
  const decision = sr.status === 'awaiting_input' ? loopDecisionOf(sr.interruptData) : undefined;
  return {
    k: ls ? ls.k : -1,
    max: ls?.effectiveMax ?? spec?.maxIterations ?? 0,
    phase: ls?.phase ?? 'starting',
    rules,
    exitReason: ls?.exitReason ?? null,
    exitAction: ls?.exitAction ?? null,
    operatorInput: ls?.operatorInput ?? null,
    ...(decision ? { decision } : {}),
  };
}

/** `n/max`: the current iteration (1-based) of the effective maximum. */
export function loopBadge(loop: LoopView): string {
  return `${Math.max(0, loop.k + 1)}/${loop.max}`;
}

/** "tests_pass 0/1 · no_fewer_failures 1/2". */
export function loopRulesText(loop: LoopView): string {
  return loop.rules.map((r) => `${r.reason} ${r.streak}/${r.consecutive}`).join(' · ');
}

/** Why a finished (or parked) loop stopped, in words. */
export function loopExitText(loop: LoopView): string | null {
  if (!loop.exitReason && !loop.exitAction) return null;
  const reason = loop.exitReason ?? 'unknown';
  switch (loop.exitAction) {
    case 'complete': return `Exited: ${reason}`;
    case 'fail': return `Failed: ${reason}`;
    case 'pause': return `Paused: ${reason}`;
    case 'exhaust': return `Exhausted: ${reason}`;
    case 'accept_last': return `Accepted the last iteration (${reason})`;
    case 'accept_best': return `Accepted the best iteration (${reason})`;
    default: return loop.exitAction ? `${loop.exitAction}: ${reason}` : reason;
  }
}

/** The parts of a loop body instance path, or null for a path outside any loop. */
export function parseLoopPath(instancePath: string): { loopPath: string; iteration: number | 'wrapup'; bodyKey: string } | null {
  const m = /^(.+)#(\d+|wrapup)\/([^/#]+)$/.exec(instancePath);
  if (!m) return null;
  return { loopPath: m[1]!, iteration: m[2] === 'wrapup' ? 'wrapup' : Number(m[2]), bodyKey: m[3]! };
}

/** " (iteration 2)" / " (wrap-up)" for a loop body instance; "" otherwise. */
export function iterationSuffix(sr: Pick<StageRun, 'instancePath' | 'iterationIndex'>): string {
  if (typeof sr.iterationIndex === 'number') return ` (iteration ${sr.iterationIndex + 1})`;
  const parsed = parseLoopPath(sr.instancePath);
  if (!parsed) return '';
  return parsed.iteration === 'wrapup' ? ' (wrap-up)' : ` (iteration ${parsed.iteration + 1})`;
}
