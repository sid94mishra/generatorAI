import { describe, expect, it } from 'vitest';
import { createAdminApi } from '../admin.js';
import { createApiClient } from '../client.js';

function recorder(status = 202, body: unknown = { runId: 'r1', command: 'pause' }) {
  const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
  const fetchImpl = async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl };
}

describe('run commands API', () => {
  it('admin runs.command posts the command to /commands', async () => {
    const { calls, fetchImpl } = recorder();
    await createAdminApi(fetchImpl).runs.command('r1', { command: 'pause', mode: 'interrupt' });
    expect(calls).toEqual([
      { path: '/api/workflow-runs/r1/commands', method: 'POST', body: { command: 'pause', mode: 'interrupt' } },
    ]);
  });

  it('a re-run is an invocation with a fork target (P04)', async () => {
    const { calls, fetchImpl } = recorder(202, { runId: 'r2' });
    const target = { kind: 'fork' as const, sourceRunId: 'r1', definition: 'pinned' as const, workspace: 'fresh' as const };
    const result = await createAdminApi(fetchImpl).workflows.invoke({ target, variables: {} });
    expect(result).toEqual({ runId: 'r2' });
    expect(calls).toEqual([{ path: '/api/workflow-invocations', method: 'POST', body: { target, variables: {} } }]);
  });

  it('the mobile client approves through the same route', async () => {
    const { calls, fetchImpl } = recorder();
    await createApiClient(fetchImpl).runs.command('r1', {
      command: 'approve',
      instanceId: 's1',
      outcome: 'changes_requested',
      feedback: 'tighten it',
    });
    expect(calls[0]).toEqual({
      path: '/api/workflow-runs/r1/commands',
      method: 'POST',
      body: { command: 'approve', instanceId: 's1', outcome: 'changes_requested', feedback: 'tighten it' },
    });
  });
});
