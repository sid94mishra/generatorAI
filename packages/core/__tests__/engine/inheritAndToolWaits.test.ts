import { describe, expect, it } from 'vitest';
import type { InstanceState, MapState, RunState } from '../../src/domain/scheduler/types.js';
import { preparePhases } from '../../src/services/engine/lifecycle/prepare.js';
import { WorkflowToolHost } from '../../src/tools/workflows/WorkflowToolHost.js';

const inst = (over: Partial<InstanceState>): InstanceState => ({ scopeId: null, iterationIndex: null, itemIndex: null, ...over }) as InstanceState;

describe('an inherit sub-workflow inside a mount_per_item item (MAPWAIT-R5)', () => {
  it("works in the enclosing item's mounts, not the run's", async () => {
    const map: MapState = {
      kind: 'map',
      phase: 'running',
      count: 1,
      snapshot: { app: 'sha' },
      items: [{ index: 0, key: '0', item: 'a', phase: 'running', status: null, errorCode: null, error: null, workspaceId: 'item-ws', mounts: { app: '/item/app' }, primaryDir: '/item/app', branch: 'item-branch', pr: null }],
    };
    const parentState = {
      run: { id: 'parent' },
      instances: [
        inst({ id: 'map-1', stageKey: 'm', instancePath: 'm', containerState: map }),
        inst({ id: 'sub-1', stageKey: 'sub', instancePath: 'm#0/sub', scopeId: 'map-1', itemIndex: 0 }),
      ],
      iterations: [],
    } as unknown as RunState;
    const parentRun = { id: 'parent', systemVars: { workingDirectory: '/run/app', codebases: { app: { path: '/run/app', branch: 'main' } } } };
    const worktrees = preparePhases.find(([name]) => name === 'worktrees')![1];
    const child = { id: 'child', parentStageRunId: 'sub-1', systemVars: { inheritedWorkspace: { fromRunId: 'parent', workspaceId: 'item-ws' } } };
    const deps = {
      runRepo: { getById: async () => parentRun },
      stores: { runStore: { loadRunState: (id: string) => (id === 'parent' ? parentState : null) } },
    };
    const r = await worktrees({ deps, graph: { workflow: { lifecycle: { codebaseAliases: [], requiresCodebase: false } } }, hooks: async () => ({}) } as never, child as never);
    expect(r.systemVars?.codebases?.['app']?.path).toBe('/item/app');
    expect(r.systemVars?.workingDirectory).toBe('/item/app');
  });
});

describe('a workflow tool blocking on a run (ECON-R7)', () => {
  it("gives the caller's flow keys back for the wait and takes them back after", async () => {
    const events: string[] = [];
    const run = { id: 'r1', name: 'r', status: 'running', trigger: { kind: 'external_agent', principalId: 'p1' }, systemVars: {} };
    const digest = { runId: 'r1', name: 'r', status: 'completed', finalized: true, stages: [], postProcessing: [] };
    const host = new WorkflowToolHost({
      invocation: {
        waitFor: async () => {
          events.push('wait');
          return digest;
        },
        digest: async () => digest,
      },
      approvals: { listPending: async () => [] },
      runs: { getById: async () => run },
      definitions: {},
      stageRuns: {},
      command: async () => ({ ok: true }),
    } as never);
    await host.check(
      { kind: 'external', via: 'mcp', principal: { kind: 'agent', id: 'p1', scopes: [] } } as never,
      { runId: 'r1', wait: true, waitSeconds: 1 },
      {
        turn: {
          yieldKeys: () => {
            events.push('yield');
            return async () => {
              events.push('take back');
            };
          },
        },
      },
    );
    expect(events).toEqual(['yield', 'wait', 'take back']);
  });
});
