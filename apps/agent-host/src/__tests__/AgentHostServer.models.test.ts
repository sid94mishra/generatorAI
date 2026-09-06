// ────────────────────────────────────────────────────────────────
// A12 — the three "Phase-B stubs" round-trip to the host.
//
// `AgentHostClient.getModels()` returned `[]` and `selectAgent()` did nothing,
// so enabling the out-of-process host emptied the model picker and silently
// ignored agent selection. The host has the provider; these requests ask it.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import type { AgentHostResponse, ModelsResponse, AgentsResponse, RequestError } from '@generatorai/shared';
import { AgentHostServer } from '../AgentHostServer.js';
import { FakeHarness, recordingLogger } from './helpers/fakeHarness.js';

async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((r) => setImmediate(r));
}

function makeTransport() {
  const sent: AgentHostResponse[] = [];
  const send = (msg: AgentHostResponse, callback: (err: Error | null) => void): boolean => {
    sent.push(msg);
    setImmediate(() => callback(null));
    return true;
  };
  return { send, sent, byReq: (reqId: string) => sent.find((m) => 'reqId' in m && (m as { reqId?: string }).reqId === reqId) };
}

let reqCounter = 0;
const nextReqId = () => `models-req-${++reqCounter}`;

describe('AgentHostServer — models and agents over IPC (A12)', () => {
  let harness: FakeHarness;
  let transport: ReturnType<typeof makeTransport>;
  let server: AgentHostServer;

  beforeEach(() => {
    harness = new FakeHarness();
    transport = makeTransport();
    server = new AgentHostServer({ logger: recordingLogger(), send: transport.send });
    server.registerHarness(harness.asHarness());
  });

  it('list_models answers with the provider catalog', async () => {
    const reqId = nextReqId();
    server.onMessage({ type: 'list_models', reqId });
    await flush();
    const resp = transport.byReq(reqId) as ModelsResponse | undefined;
    expect(resp?.type).toBe('models');
    expect(resp?.models).toEqual([{ id: 'fake-1', name: 'Fake One', provider: 'fake' }]);
  });

  it('select_agent forwards to the session conversation and acks; list_agents reflects it', async () => {
    const spawnId = nextReqId();
    server.onMessage({ type: 'spawn_session', reqId: spawnId, sessionId: 's1', params: {} });
    await flush();
    expect(transport.byReq(spawnId)?.type).toBe('ack');

    const selectId = nextReqId();
    server.onMessage({ type: 'select_agent', reqId: selectId, sessionId: 's1', agentName: 'reviewer' });
    await flush();
    expect(transport.byReq(selectId)?.type).toBe('ack');
    expect([...harness.selectedAgents.values()]).toEqual(['reviewer']);

    const listId = nextReqId();
    server.onMessage({ type: 'list_agents', reqId: listId, sessionId: 's1' });
    await flush();
    const agents = transport.byReq(listId) as AgentsResponse | undefined;
    expect(agents?.type).toBe('agents');
    expect(agents?.agents.map((a) => a.name)).toEqual(['default', 'reviewer']);
  });

  it('select_agent and list_agents for an unknown session are errors, not silence', async () => {
    const a = nextReqId();
    server.onMessage({ type: 'select_agent', reqId: a, sessionId: 'nope', agentName: 'x' });
    const b = nextReqId();
    server.onMessage({ type: 'list_agents', reqId: b, sessionId: 'nope' });
    await flush();
    expect((transport.byReq(a) as RequestError | undefined)?.code).toBe('SESSION_NOT_FOUND');
    expect((transport.byReq(b) as RequestError | undefined)?.code).toBe('SESSION_NOT_FOUND');
  });
});
