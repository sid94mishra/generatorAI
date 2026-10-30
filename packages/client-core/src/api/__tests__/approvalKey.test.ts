import { describe, expect, it } from 'vitest';
import type { ApprovalProof } from '@generatorai/shared';
import { createApiClient } from '../client.js';

function recorder(status = 200, body: unknown = { nonce: 'appr.d.n', expiresAt: 1 }) {
  const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
  const fetchImpl = async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl };
}

describe('approval key API (MG-05)', () => {
  it('asks for a nonce, registers and removes the key on the device-scoped routes', async () => {
    const { calls, fetchImpl } = recorder();
    const api = createApiClient(fetchImpl);
    expect(await api.auth.approvalNonce()).toEqual({ nonce: 'appr.d.n', expiresAt: 1 });
    const body = {
      publicJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' } as const,
      keyProtection: 'secure-enclave' as const,
      presence: 'biometry' as const,
      nonce: 'appr.d.n',
      proof: 'sig',
    };
    const empty = recorder(204);
    await createApiClient(empty.fetchImpl).auth.setApprovalKey(body);
    await createApiClient(empty.fetchImpl).auth.removeApprovalKey();
    expect(calls).toEqual([{ path: '/api/auth/approval-nonce', method: 'POST', body: {} }]);
    expect(empty.calls).toEqual([
      { path: '/api/auth/devices/me/approval-key', method: 'PUT', body },
      { path: '/api/auth/devices/me/approval-key', method: 'DELETE', body: undefined },
    ]);
  });

  it('sends the signed proof with a permission answer', async () => {
    const { calls, fetchImpl } = recorder(202, { ok: true });
    const approvalProof = { v: 1, payload: { nonce: 'n' }, signature: 's' } as unknown as ApprovalProof;
    await createApiClient(fetchImpl).chats.respondPermission('c1', 'i1', { behavior: 'allow', approvalProof });
    expect(calls).toEqual([{ path: '/api/chats/c1/interactions/i1/permission', method: 'POST', body: { behavior: 'allow', approvalProof } }]);
  });

  it('signs a stage approval beside the approve command, and a risky stage permission', async () => {
    const { calls, fetchImpl } = recorder(202, { runId: 'r1', command: 'approve' });
    const approvalProof = { v: 1, payload: { nonce: 'n' }, signature: 's' } as unknown as ApprovalProof;
    const api = createApiClient(fetchImpl);
    await api.runs.approveStage('r1', { instanceId: 's1', outcome: 'changes_requested', feedback: 'tighten it', approvalProof });
    await api.runs.stagePermission('r1', 's1', 'i1', { behavior: 'deny', approvalProof });
    expect(calls).toEqual([
      { path: '/api/workflow-runs/r1/commands', method: 'POST', body: { command: 'approve', instanceId: 's1', outcome: 'changes_requested', feedback: 'tighten it', approvalProof } },
      { path: '/api/workflow-runs/r1/instances/s1/interactions/i1/permission', method: 'POST', body: { behavior: 'deny', approvalProof } },
    ]);
  });
});
