// Loop regressions of the final review (LOOP-R1..R5, R7, R13), driven
// through decide() with the loop preset templates.

import { describe, expect, it } from 'vitest';
import { parseGraph, type WorkflowGraphInput } from '@generatorai/workflow-spec';
import { presetTemplates } from '@generatorai/workflow-spec/presets';
import { classified } from '../../src/domain/errors/StageError.js';
import { compile } from '../../src/domain/workflow-graph/index.js';
import { only, Sim } from './harness.js';

function template(id: string) {
  const t = presetTemplates().find((x) => x.id === id)!;
  return compile(parseGraph(t.graph as unknown as WorkflowGraphInput));
}

function captured(s: Sim, loopKey: string, k: number, at: 'start' | 'end', treeHashes: Record<string, string | null> | null = null, checkpointTurnId: string | null = null) {
  return s.send({ type: 'iteration_captured', stageRunId: s.inst(loopKey).id, k, at, treeHashes, checkpointTurnId });
}

describe('loop signals and budgets', () => {
  it('R1: tool calls reported as usage ticks count, so L3 no_progress does not fire on a working agent', () => {
    const s = new Sim(template('goal-loop'), { variables: { objective: 'o', verification: 'v', constraints: 'c' } });
    s.boot();
    captured(s, 'goal', 0, 'start', { primary: 'h0' });
    for (let k = 0; k < 2; k++) {
      const work = `goal#${k}/work`;
      s.exec(work, 'starting');
      s.exec(work, 'running');
      for (let n = 0; n < 5; n++) s.send({ type: 'usage_tick', stageRunId: s.inst(work).id, attemptNo: s.inst(work).currentAttempt, usage: { toolCalls: 1 } });
      s.succeed(work, { text: 'worked' }, { turns: 1 });
      s.succeed(`goal#${k}/assess`, { data: { status: 'not_met', gaps: ['g'] } }, { turns: 1 });
      captured(s, 'goal', k, 'end', { primary: `h${k + 1}` });
    }
    expect(s.inst('goal#0/work').usage.toolCalls).toBe(5);
    expect(s.state.iterations.find((r) => r.k === 1)?.signals?.stages['work']?.toolCalls).toBe(5);
    expect(s.status('goal')).toBe('running');
  });

  it('R2: the hard cap (1.25x) fails the in-flight body AND aborts its executor', () => {
    const s = new Sim(template('fix-review-loop'), { variables: { issue_url: 'u' } });
    s.boot();
    s.succeed('triage', { data: { summary: 's', plan: ['p'] } });
    captured(s, 'fix_review', 0, 'start');
    const fix = 'fix_review#0/fix';
    s.exec(fix, 'starting');
    s.exec(fix, 'running');
    const d = s.send({ type: 'usage_tick', stageRunId: s.inst(fix).id, attemptNo: s.inst(fix).currentAttempt, usage: { turns: 400 } });
    expect(s.status(fix)).toBe('failed');
    expect(only(d, 'abort')).toEqual([{ t: 'abort', stageRunId: s.inst(fix).id, attemptNo: 1, reason: 'budget' }]);
  });

  it('R3: the wrap-up may spend its one-turn allowance; one that fails into a pause still applies onLimit', () => {
    const s = new Sim(template('goal-loop'), { variables: { objective: 'o', verification: 'v', constraints: 'c' } });
    s.boot();
    captured(s, 'goal', 0, 'start');
    s.succeed('goal#0/work', { text: 'w' }, { turns: 300 });
    s.succeed('goal#0/assess', { data: { status: 'not_met', gaps: ['g'] } }, { turns: 150 });
    captured(s, 'goal', 0, 'end');
    const wrap = 'goal#wrapup/work';
    expect(s.inst('goal').loopState?.phase).toBe('wrapping_up');
    s.exec(wrap, 'starting');
    s.exec(wrap, 'running');
    s.send({ type: 'usage_tick', stageRunId: s.inst(wrap).id, attemptNo: s.inst(wrap).currentAttempt, usage: { turns: 1 } });
    expect(s.status(wrap)).toBe('running');
    // A second turn goes past the allowance: the wrap-up stops, and the loop still ends by its onLimit.
    s.send({ type: 'usage_tick', stageRunId: s.inst(wrap).id, attemptNo: s.inst(wrap).currentAttempt, usage: { turns: 1 } });
    expect(s.status(wrap)).toBe('cancelled');
    expect(s.inst('goal').loopState?.phase).not.toBe('wrapping_up');
    expect(s.status('goal')).toBe('awaiting_input');
  });

  it('R4 + R7: without mounts workspaceChanged is null, and accept_best accepts an earlier iteration without a restore', () => {
    const s = new Sim(template('refine-until-score'), { variables: { version: '1.0' } });
    s.boot();
    captured(s, 'refine', 0, 'start', {});
    const scores = [7, 5, 5, 5];
    for (let k = 0; k < 4 && s.status('refine') === 'running'; k++) {
      s.succeed(`refine#${k}/draft`, { text: `notes v${k}` });
      s.succeed(`refine#${k}/critique`, { data: { score: scores[k], issues: [`i${k}`] } });
      captured(s, 'refine', k, 'end', {}, null);
    }
    expect(s.state.iterations.map((r) => r.signals?.workspaceChanged)).toEqual(s.state.iterations.map(() => null));
    expect(s.status('refine')).toBe('completed');
    expect((s.inst('refine').output as { last: Record<string, unknown> }).last['draft']).toBe('notes v0');
  });

  it('R5: a failing check fails (not pauses), so onBodyFailure next_iteration applies', () => {
    const g = compile(
      parseGraph({
        formatVersion: 2,
        workflow: { name: 't' },
        stages: [
          { key: 'l', name: 'l', kind: 'loop', loop: { maxIterations: 3, onBodyFailure: 'next_iteration', exits: [{ when: 'stages.t.output.passed', action: 'complete', reason: 'ok' }] } },
          { key: 't', name: 't', kind: 'check', parentKey: 'l', check: { command: 'node', args: ['x.js'], failOnNonZero: true } },
        ],
        edges: [],
      } as unknown as WorkflowGraphInput),
    );
    const s = new Sim(g);
    s.boot();
    captured(s, 'l', 0, 'start');
    s.fail('l#0/t', classified('check_failed', 'node exited with 1'));
    expect(s.status('l#0/t')).toBe('failed');
    captured(s, 'l', 0, 'end');
    expect(s.inst('l').loopState?.k).toBe(1);
    expect(s.status('l#1/t')).toBe('ready');
  });

  it('R13: after a budget abort, accept_last picks the last COMPLETED iteration', () => {
    const g = compile(
      parseGraph({
        formatVersion: 2,
        workflow: { name: 't' },
        stages: [
          { key: 'l', name: 'l', kind: 'loop', budget: { maxTurns: 10 }, loop: { maxIterations: 5, onLimit: { mode: 'accept_last' }, exits: [{ when: 'false', action: 'complete', reason: 'never' }] } },
          { key: 'w', name: 'w', kind: 'agent', parentKey: 'l', prompts: [{ label: 'm', text: 'work' }] },
        ],
        edges: [],
      } as unknown as WorkflowGraphInput),
    );
    const s = new Sim(g);
    s.boot();
    captured(s, 'l', 0, 'start');
    s.succeed('l#0/w', { text: 'first' }, { turns: 2 });
    captured(s, 'l', 0, 'end');
    s.exec('l#1/w', 'starting');
    s.exec('l#1/w', 'running');
    s.send({ type: 'usage_tick', stageRunId: s.inst('l#1/w').id, attemptNo: 1, usage: { turns: 20 } });
    expect(s.status('l#1/w')).toBe('failed');
    captured(s, 'l', 1, 'end');
    expect(s.status('l')).toBe('completed');
    expect((s.inst('l').output as { last: Record<string, unknown> }).last['w']).toBe('first');
  });
});
