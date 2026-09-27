// ────────────────────────────────────────────────────────────────
// Who the caller is, and what that lets it do (final review CONVINV-R5,
// R6, R8, R9, R19; LOOP-R10; AGENT-R7): the trigger comes from the device
// record, a retried multipart start hands its files to the service
// instead of staging them, a review batch steers only a stage of its own
// workspace's run, an MCP invite gets the MCP grant, a run-level budget
// raise is run control, and an agent cannot overwrite a published workflow.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { DEFAULT_MCP_SCOPES, DEFAULT_MOBILE_SCOPES, DEFAULT_DEVICE_SCOPES, type Principal } from '@generatorai/auth';
import { createApp } from '../../src/app.js';
import type { Container } from '../../src/composition-root.js';
import { createMockContainer } from '../helpers/testApp.js';
import { createTestSecurityContext, TEST_PRINCIPAL } from '../helpers/testSecurity.js';

const DEF = '11111111-1111-4111-8111-111111111111';

function device(scopes: readonly string[], extra: Partial<Principal> = {}): Principal {
  return { type: 'paired-device', id: 'dev-1', deviceId: 'dev-1', displayName: 'Device', scopes: scopes as Principal['scopes'], transport: 'lan', ...extra };
}

function appAs(principal: Principal, platform = 'mobile') {
  const container = createMockContainer();
  const base = createTestSecurityContext();
  (container as { security: unknown }).security = createTestSecurityContext({
    auth: { authenticate: async () => principal, issueStreamTicket: async () => ({ ticket: 't', expiresAt: Date.now() + 30_000 }), isLegacyKeyConfigured: false },
    devices: { ...base.devices, getDevice: vi.fn().mockResolvedValue({ deviceId: 'dev-1', platform }) },
  } as never);
  return { app: createApp(container), container };
}

const invokeCalls = (container: Container) => (container.workflowInvocationService.invoke as ReturnType<typeof vi.fn>).mock.calls;

describe('the invocation route derives the caller from the device record (CONVINV-R8)', () => {
  it('an MCP device is an external agent whatever the body says; a phone saying mcp is a person', async () => {
    const target = { kind: 'definition', workflowDefinitionId: DEF };
    const mcp = appAs(device(DEFAULT_MCP_SCOPES), 'mcp');
    await request(mcp.app).post('/api/workflow-invocations').set('X-Forwarded-For', '203.0.113.9').send({ target, client: 'web' });
    expect(invokeCalls(mcp.container)[0]![1]).toMatchObject({ trigger: { kind: 'external_agent', via: 'mcp' }, callerPermissionCeiling: 'acceptEdits' });

    const phone = appAs(device(DEFAULT_MOBILE_SCOPES), 'mobile');
    await request(phone.app).post('/api/workflow-invocations').send({ target, client: 'mcp' });
    expect(invokeCalls(phone.container)[0]![1]).toMatchObject({ trigger: { kind: 'user', client: 'mcp' } });
  });
});

describe('multipart starts (CONVINV-R6, R19)', () => {
  it('a retry with the same key sends the same request and hands the files to the service', async () => {
    const { app, container } = appAs(TEST_PRINCIPAL);
    const send = () =>
      request(app)
        .post('/api/workflow-invocations')
        .set('Idempotency-Key', 'k1')
        .field('request', JSON.stringify({ target: { kind: 'definition', workflowDefinitionId: DEF } }))
        .attach('skills', Buffer.from('# s'), 'a.md');
    await send();
    await send();
    const [first, second] = invokeCalls(container);
    expect(first![0]).toEqual(second![0]);
    expect(first![2]).toHaveLength(1);
    expect(container.workflowInvocationService.stageUploads).not.toHaveBeenCalled();
  });

  it('a file over the limit is a 413 in the route envelope', async () => {
    const { app } = appAs(TEST_PRINCIPAL);
    const res = await request(app).post('/api/workflow-invocations/uploads').attach('skills', Buffer.alloc(11 * 1024 * 1024, 97), 'big.md');
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('a review batch sent to a workflow stage (CONVINV-R5)', () => {
  function reviewApp(scopes: readonly string[], runWorkspace: string) {
    const { container } = appAs(device(scopes));
    const c = container as unknown as Record<string, unknown>;
    c['reviewThreadService'] = {
      buildSubmission: vi.fn().mockResolvedValue({ prompt: 'fix it', threadIds: ['t1'], reviewRound: 1 }),
      getThread: vi.fn().mockResolvedValue(null),
      markSubmitted: vi.fn(),
    };
    c['stageConversationService'] = { send: vi.fn().mockResolvedValue({ outcome: 'queued' }) };
    c['stageRunRepo'] = { getById: vi.fn().mockResolvedValue({ id: 'st-1', workflowRunId: 'run-1', status: 'running' }) };
    c['workflowRunRepo'] = { getById: vi.fn().mockResolvedValue({ id: 'run-1', workspaceId: runWorkspace }) };
    return { app: createApp(container), send: c['stageConversationService'] as { send: ReturnType<typeof vi.fn> } };
  }
  const body = { threadIds: ['t1'], target: { kind: 'stage_followup', runId: 'run-1', stageId: 'st-1' } };

  it('needs exec:agent and write:workflows, and a run of this workspace', async () => {
    const phone = reviewApp(DEFAULT_MOBILE_SCOPES, 'ws-1');
    expect((await request(phone.app).post('/api/workspaces/ws-1/review/submit').send(body)).status).toBe(403);

    const other = reviewApp(DEFAULT_DEVICE_SCOPES, 'ws-other');
    expect((await request(other.app).post('/api/workspaces/ws-1/review/submit').send(body)).status).toBe(404);
    expect(other.send.send).not.toHaveBeenCalled();

    const own = reviewApp(DEFAULT_DEVICE_SCOPES, 'ws-1');
    const res = await request(own.app).post('/api/workspaces/ws-1/review/submit').send(body);
    expect(res.status).toBe(200);
    expect(res.body.delivered).toBe(true);
  });
});

describe('MCP invites (CONVINV-R9)', () => {
  it('an mcp invite without scopes asks for the MCP grant', async () => {
    const { app, container } = appAs(TEST_PRINCIPAL);
    vi.mocked(container.security.devices.createPairingGrant).mockRejectedValue(new Error('stop here'));
    await request(app).post('/api/auth/pair').send({ deviceName: 'mcp', platform: 'mcp' });
    const calls = vi.mocked(container.security.devices.createPairingGrant).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]![0].requestedScopes).toEqual([...DEFAULT_MCP_SCOPES]);
    expect(DEFAULT_MCP_SCOPES).toEqual(expect.arrayContaining(['read:chats', 'write:chats']));
  });
});

describe('run control (LOOP-R10) and agent authorship (AGENT-R7)', () => {
  it('a run-level budget raise needs write:workflows; a loop budget raise does not', async () => {
    const { app } = appAs(device(DEFAULT_MOBILE_SCOPES));
    expect((await request(app).post('/api/workflow-runs/run-1/commands').send({ command: 'raise_budget', maxTurns: 5 })).status).toBe(403);
    expect((await request(app).post('/api/workflow-runs/run-1/commands').send({ command: 'raise_budget', instanceId: 'loop-1', maxTurns: 5 })).status).toBe(202);
  });

  it('an agent cannot overwrite or delete a published workflow', async () => {
    const { app, container } = appAs({ type: 'service-account', id: 'sa-1', displayName: 'SA', scopes: DEFAULT_DEVICE_SCOPES, transport: 'lan' });
    vi.mocked(container.workflowDefinitionService.get).mockResolvedValue({ status: 'published', authoredBy: null } as never);
    const put = await request(app).put(`/api/workflow-definitions/${DEF}/graph`).send({ graph: {}, expectedRevision: 1 });
    expect(put.status).toBe(403);
    expect(put.body.error.code).toBe('AGENT_EDIT_NOT_ALLOWED');
    expect((await request(app).delete(`/api/workflow-definitions/${DEF}`)).status).toBe(403);
    expect(container.workflowDefinitionService.saveGraph).not.toHaveBeenCalled();
  });
});
