// MAPWAIT-R3: a stage reads the callback of the event wait in ITS OWN map
// item (or iteration), never a sibling item's.

import { parseGraph, type WorkflowGraphInput } from '@generatorai/workflow-spec';
import { describe, expect, it } from 'vitest';
import { compile } from '../../src/domain/workflow-graph/index.js';
import { StageExecutor } from '../../src/services/engine/StageExecutor.js';
import { WorkflowCallbacks } from '../../src/services/engine/WorkflowCallbacks.js';
import { Sim } from '../scheduler/harness.js';

const agent = (key: string, extra: Record<string, unknown> = {}) => ({ key, name: key, kind: 'agent', prompts: [{ label: 'm', text: `do ${key}` }], ...extra });

describe('callback tokens in a map item', () => {
  it('item 0 is handed its own wait callback, not item 1\'s', () => {
    const graph = compile(
      parseGraph({
        formatVersion: 2,
        workflow: { name: 'callbacks' },
        stages: [
          { key: 'm', name: 'm', kind: 'map', map: { items: "['a', 'b']", maxItems: 5, concurrency: 2, workspace: 'shared', merge: 'none' } },
          agent('trigger', { parentKey: 'm' }),
          { key: 'wait_ci', name: 'wait_ci', kind: 'wait', parentKey: 'm', wait: { type: 'event', eventKey: "concat('ci:', item)", onTimeout: 'fail' } },
        ],
        edges: [],
      } as unknown as WorkflowGraphInput),
    );
    const s = new Sim(graph);
    s.boot();
    expect(s.status('m#1/wait_ci')).toBe('waiting');
    const cbs = new WorkflowCallbacks(Buffer.alloc(32, 7));
    const exec = new StageExecutor({ callbacks: cbs } as never);
    const scope = (exec as unknown as { scopeOf(ctx: unknown): Record<string, Record<string, Record<string, unknown>>> }).scopeOf({
      compiled: graph,
      state: s.state,
      instance: s.inst('m#0/trigger'),
      variables: {},
      run: { id: s.state.run.id },
    });
    expect(scope['stages']!['wait_ci']!['callbackToken']).toBe(cbs.token(s.state.run.id, s.inst('m#0/wait_ci').id, 'ci:a'));
  });
});
