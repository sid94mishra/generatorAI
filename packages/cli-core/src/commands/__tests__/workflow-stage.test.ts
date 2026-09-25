// `workflow stage|edge …` edit the whole v2 graph: read the record, change
// the graph, save it with the revision that was read. A 409 re-applies the
// change to a fresh read once, then fails.

import { describe, expect, it, vi } from 'vitest';
import type { WorkflowDefinitionRecord, WorkflowGraph } from '@generatorai/workflow-spec';
import { workflowCommands } from '../workflow.js';
import { CliError } from '../../errors/CliError.js';
import type { CliContext } from '../../context/CliContext.js';

const ID = '00000000-0000-0000-0000-000000000001';
const command = (id: string) => workflowCommands().find((c) => c.id === id)!;

function graph(stageKeys: string[], edges: WorkflowGraph['edges'] = []): WorkflowGraph {
  return {
    formatVersion: 2,
    workflow: { name: 'e2e' },
    stages: stageKeys.map((key) => ({ kind: 'agent', key, name: key, prompts: [{ label: 'p', text: `do ${key}` }] })),
    edges,
  } as unknown as WorkflowGraph;
}

function recordOf(g: WorkflowGraph, revision: number): WorkflowDefinitionRecord {
  return { id: ID, status: 'draft', revision, graph: g } as unknown as WorkflowDefinitionRecord;
}

const conflict = () => Object.assign(new Error('Revision conflict'), { status: 409, path: `/api/workflow-definitions/${ID}/graph` });

function fakeContext(records: WorkflowDefinitionRecord[], saveGraph: ReturnType<typeof vi.fn>): CliContext {
  const get = vi.fn();
  for (const r of records) get.mockResolvedValueOnce(r);
  return {
    api: {
      definitions: {
        list: vi.fn(async () => ({ items: [{ id: ID, name: 'e2e', status: 'draft', createdAt: '' }] })),
        get,
        saveGraph,
      },
    },
  } as unknown as CliContext;
}

describe('workflow stage add', () => {
  it('saves the whole graph with the new v2 stage and the revision it read', async () => {
    const saveGraph = vi.fn(async (_id: string, g: WorkflowGraph) => recordOf(g, 4));
    await command('workflow.stage.add').handler(fakeContext([recordOf(graph(['plan']), 3)], saveGraph), {
      args: { workflow: 'e2e' },
      flags: { name: 'Write tests', prompt: 'add tests', model: 'gpt-5', agent: 'user:tester', timeoutMs: 60_000, retryAttempts: 3, guard: 'true' },
    } as never);

    expect(saveGraph).toHaveBeenCalledTimes(1);
    const [id, saved, revision] = saveGraph.mock.calls[0]! as [string, WorkflowGraph, number];
    expect(id).toBe(ID);
    expect(revision).toBe(3);
    expect(saved.stages.map((s) => s.key)).toEqual(['plan', 'write_tests']);
    expect(saved.stages[1]).toMatchObject({
      kind: 'agent',
      key: 'write_tests',
      name: 'Write tests',
      prompts: [{ label: 'prompt', text: 'add tests' }],
      guard: 'true',
      retry: { maxAttempts: 3 },
      timeouts: { attemptMs: 60_000 },
      session: { model: 'gpt-5', agentRef: 'user:tester' },
    });
  });

  it('re-applies the change to a fresh read after one 409, then saves with the new revision', async () => {
    const saveGraph = vi
      .fn()
      .mockRejectedValueOnce(conflict())
      .mockImplementation(async (_id: string, g: WorkflowGraph) => recordOf(g, 6));
    // Someone added `review` between the two reads; the retry must keep it.
    const ctx = fakeContext([recordOf(graph(['plan']), 3), recordOf(graph(['plan', 'review']), 5)], saveGraph);

    await command('workflow.stage.add').handler(ctx, {
      args: { workflow: 'e2e' },
      flags: { name: 'build', prompt: 'build it' },
    } as never);

    expect(saveGraph).toHaveBeenCalledTimes(2);
    const [, saved, revision] = saveGraph.mock.calls[1]! as [string, WorkflowGraph, number];
    expect(revision).toBe(5);
    expect(saved.stages.map((s) => s.key)).toEqual(['plan', 'review', 'build']);
  });

  it('fails with CONFLICT after a second 409 instead of retrying forever', async () => {
    const saveGraph = vi.fn().mockRejectedValue(conflict());
    const ctx = fakeContext([recordOf(graph(['plan']), 3), recordOf(graph(['plan']), 4)], saveGraph);

    const failure = command('workflow.stage.add').handler(ctx, {
      args: { workflow: 'e2e' },
      flags: { name: 'build', prompt: 'build it' },
    } as never);

    await expect(failure).rejects.toBeInstanceOf(CliError);
    await expect(failure).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(saveGraph).toHaveBeenCalledTimes(2);
  });

  it('refuses a graph the validator rejects without sending it', async () => {
    const saveGraph = vi.fn();
    const ctx = fakeContext([recordOf(graph(['plan']), 1)], saveGraph);

    await expect(
      command('workflow.stage.add').handler(ctx, {
        args: { workflow: 'e2e' },
        flags: { name: 'build', prompt: 'x', guard: 'variables.nope ==' },
      } as never),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(saveGraph).not.toHaveBeenCalled();
  });
});

describe('workflow stage remove / edge add', () => {
  it('removing a stage drops its edges and its use as a context source', async () => {
    const start = graph(['plan', 'build', 'ship'], [
      { from: 'plan', to: 'build', on: 'success' },
      { from: 'build', to: 'ship', on: 'success' },
      { from: 'plan', to: 'ship', on: 'success' },
    ] as WorkflowGraph['edges']);
    (start.stages[2] as { context: unknown }).context = { from: ['build', 'plan'], mode: 'summary' };
    const saveGraph = vi.fn(async (_id: string, g: WorkflowGraph) => recordOf(g, 2));

    await command('workflow.stage.remove').handler(fakeContext([recordOf(start, 1)], saveGraph), {
      args: { workflow: 'e2e', stage: 'build' },
      flags: {},
    } as never);

    const saved = saveGraph.mock.calls[0]![1] as WorkflowGraph;
    expect(saved.stages.map((s) => s.key)).toEqual(['plan', 'ship']);
    expect(saved.edges).toEqual([{ from: 'plan', to: 'ship', on: 'success' }]);
    expect(saved.stages[1]!.context.from).toEqual(['plan']);
  });

  it('connects stages by key (or name) with the v2 outcome vocabulary', async () => {
    const saveGraph = vi.fn(async (_id: string, g: WorkflowGraph) => recordOf(g, 2));
    await command('workflow.edge.add').handler(fakeContext([recordOf(graph(['plan', 'build']), 1)], saveGraph), {
      args: { workflow: 'e2e' },
      flags: { from: 'plan', to: 'build', on: 'failure' },
    } as never);

    expect((saveGraph.mock.calls[0]![1] as WorkflowGraph).edges).toEqual([{ from: 'plan', to: 'build', on: 'failure' }]);
  });
});
