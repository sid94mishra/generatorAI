// D-155 — which agent stages work in a worktree of their own: those that may
// run while another working stage of their scope does (or whose container
// may), unless they opt out; never inside a map.

import { parseGraph, type WorkflowGraph, type WorkflowGraphInput } from '@generatorai/workflow-spec';
import { describe, expect, it } from 'vitest';
import { worksIsolated } from '../../src/domain/scheduler/isolation.js';
import { compile } from '../../src/domain/workflow-graph/index.js';
import { Sim } from './harness.js';

type StageInput = { key: string; [k: string]: unknown };

function setup(stages: Array<string | StageInput>, edges: Array<[string, string]> = []): { graph: WorkflowGraph; sim: Sim } {
  const graph = parseGraph({
    formatVersion: 2,
    workflow: { name: 'test' },
    stages: stages.map((s) => {
      const base = typeof s === 'string' ? { key: s } : s;
      const agent = !('kind' in base) || base.kind === 'agent';
      return { name: base.key, ...(agent ? { kind: 'agent', prompts: [{ label: 'main', text: `do ${base.key}` }] } : {}), ...base };
    }),
    edges: edges.map(([from, to]) => ({ from, to })),
  } as unknown as WorkflowGraphInput);
  const sim = new Sim(compile(graph));
  sim.boot();
  return { graph, sim };
}

const isolated = (graph: WorkflowGraph, sim: Sim, path: string) => worksIsolated(graph, sim.state, sim.inst(path));
/** A loop's first iteration starts once its start state is captured. */
const startLoop = (sim: Sim, key: string) => sim.send({ type: 'iteration_captured', stageRunId: sim.inst(key).id, k: 0, at: 'start', treeHashes: null, checkpointTurnId: null });

describe('worksIsolated', () => {
  it('forks the stages of a fan-out and none of a chain', () => {
    const { graph, sim } = setup(['spec', 'backend', 'frontend', 'review'], [
      ['spec', 'backend'],
      ['spec', 'frontend'],
      ['backend', 'review'],
      ['frontend', 'review'],
    ]);
    expect(isolated(graph, sim, 'spec')).toBe(false);
    sim.succeed('spec');
    expect(isolated(graph, sim, 'backend')).toBe(true);
    expect(isolated(graph, sim, 'frontend')).toBe(true);
    sim.succeed('backend');
    sim.succeed('frontend');
    expect(isolated(graph, sim, 'review')).toBe(false);
  });

  it('honours workspace: shared and isolated', () => {
    const { graph, sim } = setup([{ key: 'a', workspace: 'shared' }, 'b', { key: 'c', workspace: 'isolated' }], [['a', 'c'], ['b', 'c']]);
    expect(isolated(graph, sim, 'a')).toBe(false);
    expect(isolated(graph, sim, 'b')).toBe(true);
    sim.succeed('a');
    sim.succeed('b');
    expect(isolated(graph, sim, 'c')).toBe(true);
  });

  it('forks a loop body when the loop runs alongside another stage', () => {
    const loop = { key: 'l', kind: 'loop', loop: { maxIterations: 2, onLimit: { mode: 'accept_last' }, exits: [] } };
    const { graph, sim } = setup([loop, { key: 'fix', parentKey: 'l' }, { key: 'check', parentKey: 'l' }, 'docs'], [['fix', 'check']]);
    startLoop(sim, 'l');
    expect(isolated(graph, sim, 'docs')).toBe(true);
    expect(isolated(graph, sim, 'l#0/fix')).toBe(true);
  });

  it('keeps a lone loop body in the run folder', () => {
    const loop = { key: 'l', kind: 'loop', loop: { maxIterations: 2, onLimit: { mode: 'accept_last' }, exits: [] } };
    const { graph, sim } = setup(['plan', loop, { key: 'fix', parentKey: 'l' }, { key: 'check', parentKey: 'l' }], [['plan', 'l'], ['fix', 'check']]);
    sim.succeed('plan');
    startLoop(sim, 'l');
    expect(isolated(graph, sim, 'l#0/fix')).toBe(false);
  });

  it('weighs a planned stage against the other steps of its plan', () => {
    const planner = { key: 'plan', expands: { maxStages: 5 } };
    const { graph, sim } = setup([planner, 'after'], [['plan', 'after']]);
    sim.succeed('plan', {
      data: {
        stages: [
          { key: 'api', name: 'API', prompt: 'Build the API' },
          { key: 'ui', name: 'UI', prompt: 'Build the UI' },
          { key: 'qa', name: 'QA', prompt: 'Test both' },
        ],
        edges: [
          { from: 'api', to: 'qa' },
          { from: 'ui', to: 'qa' },
        ],
      },
    });
    const step = (key: string) => sim.state.instances.find((i) => i.stageKey === key)!;
    expect(worksIsolated(graph, sim.state, step('api'))).toBe(true);
    expect(worksIsolated(graph, sim.state, step('ui'))).toBe(true);
    expect(worksIsolated(graph, sim.state, step('qa'))).toBe(false);
  });
});
