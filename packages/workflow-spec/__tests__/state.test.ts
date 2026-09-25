import { describe, expect, it } from 'vitest';
import {
  STAGE_RUN_STATES,
  STAGE_RUN_TRANSITIONS,
  TERMINAL_STAGE_RUN_STATES,
  TERMINAL_WORKFLOW_RUN_STATES,
  WORKFLOW_RUN_STATES,
  WORKFLOW_RUN_TRANSITIONS,
  isLegalStageRunTransition,
  isLegalWorkflowRunTransition,
  stageRunTransitionsFrom,
  workflowRunTransitionsFrom,
  type StageNodeClass,
  type StageRunState,
  type WorkflowRunState,
} from '../src/index.js';

function reachable<S extends string>(start: S, edges: ReadonlyArray<{ from: S; to: S }>): Set<S> {
  const seen = new Set<S>([start]);
  const stack = [start];
  while (stack.length) {
    const s = stack.pop()!;
    for (const e of edges) if (e.from === s && !seen.has(e.to)) (seen.add(e.to), stack.push(e.to));
  }
  return seen;
}

describe('stage-run transitions (G5 §5.9)', () => {
  it('only names declared states', () => {
    for (const t of STAGE_RUN_TRANSITIONS) {
      expect(STAGE_RUN_STATES).toContain(t.from);
      expect(STAGE_RUN_STATES).toContain(t.to);
      expect(['actor', 'executor']).toContain(t.owner);
      expect(t.applies.length).toBeGreaterThan(0);
      expect(t.event).toMatch(/^(sched|exec|user|run|timer):[a-z_]+$/);
    }
  });

  it('has no duplicate rows', () => {
    const keys = STAGE_RUN_TRANSITIONS.map((t) => `${t.from}>${t.to}>${t.event}>${[...t.applies].sort().join(',')}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('terminal states have no exits', () => {
    for (const s of TERMINAL_STAGE_RUN_STATES) expect(stageRunTransitionsFrom(s)).toEqual([]);
  });

  it.each<StageNodeClass>(['work', 'wait', 'container'])('every %s state is reachable from pending and can reach a terminal state', (cls) => {
    const edges = STAGE_RUN_TRANSITIONS.filter((t) => t.applies.includes(cls));
    const used = new Set(edges.flatMap((e) => [e.from, e.to]));
    const fromPending = reachable<StageRunState>('pending', edges);
    for (const s of used) {
      expect(fromPending.has(s), `${cls}: ${s} unreachable`).toBe(true);
      const out = reachable<StageRunState>(s, edges);
      expect(TERMINAL_STAGE_RUN_STATES.some((t) => out.has(t)), `${cls}: ${s} is a dead end`).toBe(true);
    }
  });

  it('the executor only owns in-attempt transitions', () => {
    for (const t of STAGE_RUN_TRANSITIONS.filter((x) => x.owner === 'executor')) {
      expect(['ready', 'starting', 'running', 'validating', 'awaiting_input']).toContain(t.from);
      expect(['starting', 'running', 'validating', 'awaiting_input']).toContain(t.to);
    }
  });

  it('only the actor completes a stage, and only after validation (F-5)', () => {
    const intoCompleted = STAGE_RUN_TRANSITIONS.filter((t) => t.to === 'completed' && t.applies.includes('work'));
    expect(intoCompleted.map((t) => [t.from, t.owner])).toEqual([['validating', 'actor']]);
  });

  it('cancel is possible from every live state (desired state first)', () => {
    for (const s of STAGE_RUN_STATES) {
      if (TERMINAL_STAGE_RUN_STATES.includes(s)) continue;
      if (s === 'validating' || s === 'starting' || s === 'running' || s === 'retry_wait' || s === 'paused' || s === 'pending' || s === 'ready') {
        expect(isLegalStageRunTransition(s, 'cancelled', 'work'), s).toBe(true);
      }
    }
    expect(isLegalStageRunTransition('waiting', 'cancelled', 'wait')).toBe(true);
    expect(isLegalStageRunTransition('awaiting_input', 'cancelled', 'work')).toBe(true);
  });

  it.each<[StageRunState, StageRunState, StageNodeClass, boolean]>([
    ['pending', 'ready', 'work', true],
    ['ready', 'starting', 'work', true],
    ['ready', 'starting', 'container', false],
    ['running', 'completed', 'work', false],
    ['running', 'completed', 'container', true],
    ['completed', 'ready', 'work', false],
    ['failed', 'pending', 'work', false],
    ['waiting', 'completed', 'wait', true],
    ['waiting', 'completed', 'work', false],
    ['retry_wait', 'ready', 'work', true],
  ])('%s → %s (%s): %s', (from, to, cls, legal) => {
    expect(isLegalStageRunTransition(from, to, cls)).toBe(legal);
  });
});

describe('workflow-run transitions (G5 §5.10)', () => {
  it('only names declared states', () => {
    for (const t of WORKFLOW_RUN_TRANSITIONS) {
      expect(WORKFLOW_RUN_STATES).toContain(t.from);
      expect(WORKFLOW_RUN_STATES).toContain(t.to);
      expect(t.event).toMatch(/^(user|sys|timer):[a-z_]+$/);
    }
  });

  it('terminal states have no exits (a retry is a fork)', () => {
    for (const s of TERMINAL_WORKFLOW_RUN_STATES) expect(workflowRunTransitionsFrom(s)).toEqual([]);
    expect(isLegalWorkflowRunTransition('failed', 'created')).toBe(false);
  });

  it('every state is reachable from created and reaches a terminal state', () => {
    const r = reachable<WorkflowRunState>('created', WORKFLOW_RUN_TRANSITIONS);
    for (const s of WORKFLOW_RUN_STATES) {
      expect(r.has(s), s).toBe(true);
      const out = reachable<WorkflowRunState>(s, WORKFLOW_RUN_TRANSITIONS);
      expect(TERMINAL_WORKFLOW_RUN_STATES.some((t) => out.has(t)), s).toBe(true);
    }
  });

  it('completion goes through finalizing (exactly-once post-processing, B-23)', () => {
    const into = WORKFLOW_RUN_TRANSITIONS.filter((t) => t.to === 'completed');
    expect(into.map((t) => t.from)).toEqual(['finalizing']);
  });

  it('every non-terminal state can be cancelled', () => {
    for (const s of WORKFLOW_RUN_STATES) {
      if (TERMINAL_WORKFLOW_RUN_STATES.includes(s) || s === 'cancelling') continue;
      expect(isLegalWorkflowRunTransition(s, 'cancelling'), s).toBe(true);
    }
  });
});
