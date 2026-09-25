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

  it('admin runs.fork posts the request (default {}) to /fork', async () => {
    const { calls, fetchImpl } = recorder(201, { id: 'r2' });
    const fork = await createAdminApi(fetchImpl).runs.fork('r1');
    expect(fork).toEqual({ id: 'r2' });
    expect(calls).toEqual([{ path: '/api/workflow-runs/r1/fork', method: 'POST', body: {} }]);
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
