import { describe, expect, it, vi } from 'vitest';
import { workflowCommands } from '../workflow.js';
import type { CliContext } from '../../context/CliContext.js';

const WORKFLOW = { id: 'wf_1', name: 'e2e', status: 'active', createdAt: 0 };

const stageAdd = workflowCommands().find((c) => c.id === 'workflow.stage.add')!;
const stageUpdate = workflowCommands().find((c) => c.id === 'workflow.stage.update')!;
const stageVariables = workflowCommands().find((c) => c.id === 'workflow.stage.variables')!;
const hookAdd = workflowCommands().find((c) => c.id === 'workflow.stage.hook.add')!;
const hookRemove = workflowCommands().find((c) => c.id === 'workflow.stage.hook.remove')!;
const edgeAdd = workflowCommands().find((c) => c.id === 'workflow.edge.add')!;

const HOOK = {
  id: 'pre_run-lint',
  name: 'lint',
  phase: 'pre_run',
  type: 'script',
  priority: 0,
  enabled: true,
  failurePolicy: 'abort',
  timeoutMs: 30000,
  retries: 0,
  config: { type: 'script', command: 'pnpm lint' },
};

function fakeContext(overrides: {
  addStage?: ReturnType<typeof vi.fn>;
  addEdge?: ReturnType<typeof vi.fn>;
  updateStage?: ReturnType<typeof vi.fn>;
  stages?: Array<Record<string, unknown>>;
}): CliContext {
  return {
    api: {
      definitions: {
        list: vi.fn(async () => [WORKFLOW]),
        get: vi.fn(async () => ({
          ...WORKFLOW,
          stages: overrides.stages ?? [
            { id: 's1', name: 'plan' },
            { id: 's2', name: 'build' },
          ],
        })),
        addStage: overrides.addStage ?? vi.fn(async () => ({ id: 'stage_1' })),
        addEdge: overrides.addEdge ?? vi.fn(async () => ({ id: 'edge_1' })),
        updateStage: overrides.updateStage ?? vi.fn(async () => ({ id: 's1' })),
      },
    },
  } as unknown as CliContext;
}

describe('workflow stage add', () => {
  it("caps --retries at the server's limit of 10 via the command schema", () => {
    const result = stageAdd.schema!.safeParse({
      args: { workflow: 'e2e' },
      flags: { name: 'plan', retries: '20' },
    });
    expect(result.success).toBe(false);
  });

  it('sends prompts/harnessConfigOverrides/timeoutMs/retryPolicy, not prompt/model/timeoutSeconds/maxRetries', async () => {
    const addStage = vi.fn(async () => ({ id: 'stage_1' }));
    const ctx = fakeContext({ addStage });

    await stageAdd.handler(ctx, {
      args: { workflow: 'e2e' },
      flags: { name: 'plan', prompt: 'do the thing', model: 'gpt-5', timeout: 60, retries: 2 },
    } as never);

    expect(addStage).toHaveBeenCalledWith('wf_1', {
      name: 'plan',
      prompts: [{ label: 'prompt', text: 'do the thing', waitForCompletion: true }],
      harnessConfigOverrides: { model: 'gpt-5' },
      timeoutMs: 60_000,
      retryPolicy: { maxRetries: 2, backoffMs: 1000, backoffMultiplier: 2 },
    });
  });
});

// ── Stage variables / condition / hooks (Phase 7 item 4) ───────────
//
// `CreateStageSchema` has always accepted `variables`, `condition` and
// `hooks`; no CLI surface set any of them, so a terminal user could not give
// a stage a variable or a run condition at all.

describe('workflow stage variables and condition', () => {
  it('turns --var name=value into the variables record, parsing JSON values', async () => {
    const addStage = vi.fn(async () => ({ id: 'stage_1' }));
    await stageAdd.handler(fakeContext({ addStage }), {
      args: { workflow: 'e2e' },
      flags: { name: 'plan', var: ['retries=3', 'label=build it', 'opts={"deep":true}'] },
    } as never);

    expect(addStage.mock.calls[0]?.[1]).toMatchObject({
      variables: { retries: 3, label: 'build it', opts: { deep: true } },
    });
  });

  it('rejects a --var without an =', async () => {
    await expect(
      stageAdd.handler(fakeContext({}), {
        args: { workflow: 'e2e' },
        flags: { name: 'plan', var: ['justaname'] },
      } as never),
    ).rejects.toThrow('name=value');
  });

  it('sends a StageCondition, and refuses an expression condition with no expression', async () => {
    const addStage = vi.fn(async () => ({ id: 'stage_1' }));
    await stageAdd.handler(fakeContext({ addStage }), {
      args: { workflow: 'e2e' },
      flags: { name: 'plan', condition: 'expression', conditionExpression: 'vars.ok == true' },
    } as never);
    expect(addStage.mock.calls[0]?.[1]).toMatchObject({
      condition: { type: 'expression', expression: 'vars.ok == true' },
    });

    await expect(
      stageAdd.handler(fakeContext({}), {
        args: { workflow: 'e2e' },
        flags: { name: 'plan', condition: 'expression' },
      } as never),
    ).rejects.toThrow('--condition-expression');
  });

  it('merges --var into the stage\'s existing variables on update, and replaces them with --clear-vars', async () => {
    // The route PUTs the whole record — a partial update that did not merge
    // would silently drop every variable the caller did not name.
    const stages = [{ id: 's1', name: 'plan', variables: { keep: 1, over: 'old' } }];
    const updateStage = vi.fn(async () => ({ id: 's1' }));

    await stageUpdate.handler(fakeContext({ updateStage, stages }), {
      args: { workflow: 'e2e', stage: 'plan' },
      flags: { var: ['over=new'] },
    } as never);
    expect(updateStage.mock.calls[0]?.[2]).toEqual({ variables: { keep: 1, over: 'new' } });

    const replacing = vi.fn(async () => ({ id: 's1' }));
    await stageUpdate.handler(fakeContext({ updateStage: replacing, stages }), {
      args: { workflow: 'e2e', stage: 'plan' },
      flags: { var: ['only=1'], clearVars: true },
    } as never);
    expect(replacing.mock.calls[0]?.[2]).toEqual({ variables: { only: 1 } });
  });

  it('lists a stage\'s variables with non-string values rendered as JSON', async () => {
    const stages = [{ id: 's1', name: 'plan', variables: { n: 3, s: 'text' } }];
    const result = await stageVariables.handler(fakeContext({ stages }), {
      args: { workflow: 'e2e', stage: 'plan' },
      flags: {},
    } as never);

    expect(result.data).toEqual([
      { name: 'n', value: '3' },
      { name: 's', value: 'text' },
    ]);
  });
});

describe('workflow stage hooks', () => {
  it('appends to the existing hook array rather than replacing it', async () => {
    // `updateStage` PUTs `hooks` whole; sending only the new one would
    // silently detach every hook the stage already had.
    const stages = [{ id: 's1', name: 'plan', hooks: [HOOK] }];
    const updateStage = vi.fn(async () => ({ id: 's1' }));

    await hookAdd.handler(fakeContext({ updateStage, stages }), {
      args: { workflow: 'e2e', stage: 'plan' },
      flags: {
        name: 'notify',
        phase: 'post_run',
        type: 'http',
        config: '{"url":"https://example.test/hook","method":"POST"}',
        priority: 0,
        timeout: 30000,
        retries: 0,
        failurePolicy: 'continue',
      },
    } as never);

    const sent = updateStage.mock.calls[0]?.[2] as { hooks: Array<Record<string, unknown>> };
    expect(sent.hooks).toHaveLength(2);
    expect(sent.hooks[0]).toEqual(HOOK);
    expect(sent.hooks[1]).toMatchObject({
      id: 'post_run-notify',
      name: 'notify',
      phase: 'post_run',
      enabled: true,
      failurePolicy: 'continue',
      config: { type: 'http', url: 'https://example.test/hook', method: 'POST' },
    });
  });

  it('rejects a config the route schema would reject, naming the missing field', async () => {
    // An `http` hook config without `method` is a 400 from the route with a
    // zod path the user cannot map back to the flag they typed. Checking
    // against the same schema here turns it into a sentence.
    await expect(
      hookAdd.handler(fakeContext({}), {
        args: { workflow: 'e2e', stage: 'plan' },
        flags: {
          name: 'notify',
          phase: 'post_run',
          type: 'http',
          config: '{"url":"https://example.test/hook"}',
          priority: 0,
          timeout: 30000,
          retries: 0,
          failurePolicy: 'abort',
        },
      } as never),
    ).rejects.toThrow('not a valid http hook config');
  });

  it('refuses a --config whose "type" disagrees with --type', async () => {
    await expect(
      hookAdd.handler(fakeContext({}), {
        args: { workflow: 'e2e', stage: 'plan' },
        flags: {
          name: 'x',
          phase: 'pre_run',
          type: 'script',
          config: '{"type":"http","url":"u"}',
          priority: 0,
          timeout: 1,
          retries: 0,
          failurePolicy: 'abort',
        },
      } as never),
    ).rejects.toThrow('does not match --type');
  });

  it('refuses a duplicate hook name on the same stage', async () => {
    const stages = [{ id: 's1', name: 'plan', hooks: [HOOK] }];
    await expect(
      hookAdd.handler(fakeContext({ stages }), {
        args: { workflow: 'e2e', stage: 'plan' },
        flags: {
          name: 'lint',
          phase: 'pre_run',
          type: 'script',
          config: '{"command":"x"}',
          priority: 0,
          timeout: 1,
          retries: 0,
          failurePolicy: 'abort',
        },
      } as never),
    ).rejects.toThrow('already has a hook named');
  });

  it('removes one hook by name and keeps the rest', async () => {
    const other = { ...HOOK, id: 'post_run-notify', name: 'notify', phase: 'post_run' };
    const stages = [{ id: 's1', name: 'plan', hooks: [HOOK, other] }];
    const updateStage = vi.fn(async () => ({ id: 's1' }));

    await hookRemove.handler(fakeContext({ updateStage, stages }), {
      args: { workflow: 'e2e', stage: 'plan', hook: 'lint' },
      flags: {},
    } as never);

    expect(updateStage.mock.calls[0]?.[2]).toEqual({ hooks: [other] });
  });

  it('offers every phase the server schema accepts, not a hand-written subset', () => {
    // A phase this CLI does not offer is one no terminal user can attach a
    // hook to — so the list is read off the schema, never retyped.
    const choices = hookAdd.flags.find((f) => f.name === 'phase')?.choices ?? [];
    expect(choices).toContain('pre_run');
    expect(choices).toContain('on_session_cancelled');
    expect(choices.length).toBeGreaterThan(20);
  });
});

describe('workflow edge add', () => {
  it('sends only fromStageId/toStageId/edgeType — there is no --condition flag any more', async () => {
    const addEdge = vi.fn(async () => ({ id: 'edge_1' }));
    const ctx = fakeContext({ addEdge });

    await edgeAdd.handler(ctx, {
      args: { workflow: 'e2e' },
      flags: { from: 'plan', to: 'build', on: 'on_success' },
    } as never);

    expect(addEdge).toHaveBeenCalledWith('wf_1', { fromStageId: 's1', toStageId: 's2', edgeType: 'on_success' });
    expect(edgeAdd.flags.some((f) => f.name === 'condition')).toBe(false);
  });
});
