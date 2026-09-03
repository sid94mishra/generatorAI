import { describe, expect, it } from 'vitest';
import type { Api } from '@generatorai/cli-core';
import { openerFor } from '../open.js';

// Phase 6 item 6 — the automation pane used to be a static JSON dump
// (`kind: 'inspector'`, no attachment). These pin the two real decisions
// `open.ts`'s `automations` opener now makes: sorting executions
// newest-first, and picking which one (if any) to attach the pane's live
// stream to.
describe('automations opener', () => {
  const opener = openerFor('automations')!;

  function fakeApi(executions: Array<Record<string, unknown>>): Api {
    return {
      automations: {
        get: async () => ({ id: 'a1', name: 'Nightly', enabled: true, triggerType: 'schedule' }),
        executions: async () => executions,
      },
    } as unknown as Api;
  }

  it('sorts executions newest-first by createdAt', async () => {
    const content = await opener.build(
      { id: 'a1', name: 'Nightly' },
      fakeApi([
        { id: 'e1', status: 'completed', createdAt: 1000 },
        { id: 'e2', status: 'completed', createdAt: 3000 },
        { id: 'e3', status: 'completed', createdAt: 2000 },
      ]),
    );
    const executions = (content.state as { executions: Array<{ id: string }> }).executions;
    expect(executions.map((e) => e.id)).toEqual(['e2', 'e3', 'e1']);
  });

  it("attaches the pane's live stream to a still-running execution, scoped by the EXECUTION's id (not the automation's)", async () => {
    const content = await opener.build(
      { id: 'a1', name: 'Nightly' },
      fakeApi([
        { id: 'e1', status: 'completed', createdAt: 1000 },
        { id: 'e2', status: 'running', createdAt: 2000 },
      ]),
    );
    expect(content.attachment).toEqual({ scope: 'automation', id: 'e2' });
  });

  it('also attaches to a still-pending execution, not only a running one', async () => {
    const content = await opener.build(
      { id: 'a1', name: 'Nightly' },
      fakeApi([{ id: 'e1', status: 'pending', createdAt: 1000 }]),
    );
    expect(content.attachment).toEqual({ scope: 'automation', id: 'e1' });
  });

  it('attaches to nothing when every execution is already terminal', async () => {
    const content = await opener.build(
      { id: 'a1', name: 'Nightly' },
      fakeApi([
        { id: 'e1', status: 'completed', createdAt: 1000 },
        { id: 'e2', status: 'failed', createdAt: 2000 },
        { id: 'e3', status: 'cancelled', createdAt: 3000 },
      ]),
    );
    expect(content.attachment).toBeUndefined();
  });

  it('attaches to nothing when there are no executions at all', async () => {
    const content = await opener.build({ id: 'a1', name: 'Nightly' }, fakeApi([]));
    expect(content.attachment).toBeUndefined();
    expect((content.state as { executions: unknown[] }).executions).toEqual([]);
  });

  it('degrades to an empty execution list rather than throwing when the fetch fails', async () => {
    const api = {
      automations: {
        get: async () => ({ id: 'a1', name: 'Nightly' }),
        executions: async () => {
          throw new Error('network error');
        },
      },
    } as unknown as Api;
    const content = await opener.build({ id: 'a1', name: 'Nightly' }, api);
    expect((content.state as { executions: unknown[] }).executions).toEqual([]);
    expect(content.attachment).toBeUndefined();
  });
});
