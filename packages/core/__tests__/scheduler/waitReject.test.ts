// A rejected approval wait stops the run unless it routes the rejection (`onReject: complete`): a "Ship it?" gate
// rejected completed with outcome rejected, the run completed and its post-processing committed and opened a PR.
import { describe, expect, it } from 'vitest';
import { parseGraph, type WorkflowGraphInput } from '@generatorai/workflow-spec';
import { compile } from '../../src/domain/workflow-graph/index.js';
import { Sim } from './harness.js';

const agent = (key: string) => ({ key, name: key, kind: 'agent', prompts: [{ label: 'main', text: `do ${key}` }] });

const ship = (onReject?: 'fail' | 'complete') => ({
  key: 'ship',
  name: 'Ship it?',
  kind: 'wait',
  wait: { type: 'approval', prompt: { label: 'ship', text: 'Ship it?' }, ...(onReject ? { onReject } : {}) },
});

function rejectShip(onReject?: 'fail' | 'complete'): Sim {
  const input = {
    formatVersion: 2,
    workflow: { name: 'test' },
    stages: [agent('build'), ship(onReject), agent('after')],
    edges: [{ from: 'build', to: 'ship' }, { from: 'ship', to: 'after' }],
  } as unknown as WorkflowGraphInput;
  const s = new Sim(compile(parseGraph(input)));
  s.boot();
  s.succeed('build');
  expect(s.status('ship')).toBe('waiting');
  s.send({ type: 'command', command: { command: 'approve', instanceId: s.inst('ship').id, outcome: 'rejected' } });
  return s;
}

describe('approval wait — Reject', () => {
  it('fails the stage by default, and the run fails without running what follows', () => {
    const s = rejectShip();
    expect(s.inst('ship')).toMatchObject({ status: 'failed', statusReason: 'rejected' });
    expect(['skipped', 'cancelled', 'pending']).toContain(s.status('after'));
    expect(s.state.run.outcome).toBe('failed');
  });

  it('completes with outcome rejected when the wait routes it', () => {
    const s = rejectShip('complete');
    expect(s.status('ship')).toBe('completed');
    expect(s.inst('ship').output).toMatchObject({ outcome: 'rejected' });
  });
});
