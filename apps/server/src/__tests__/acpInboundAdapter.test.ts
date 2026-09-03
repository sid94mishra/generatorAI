// ────────────────────────────────────────────────────────────────
// W10 — AcpInboundAdapter tests
//
// These drive the adapter with a REAL `@agentclientprotocol/sdk` client
// (`acp.client()`), not a hand-rolled JSON blob. That is deliberate: the
// previous suite passed against an adapter that spoke a protocol which
// does not exist, because both sides of every assertion were invented in
// this file. Anything the SDK would reject on the wire now fails here.
//
// Two transports are exercised:
//   - in-process (`agentApp.connect(clientApp)`), the SDK's own documented
//     mechanism for tests, used for the streaming/permission/lifecycle work
//   - real newline-delimited JSON over web streams (`ndJsonStream`), used to
//     assert the literal bytes for protocol-version negotiation and for the
//     "a notification gets no response" JSON-RPC rule
//
// The mock EventBus delivers ONLY on the key it was subscribed with, and
// the mock bridge returns a `chatId` and an `eventSessionId` that are
// different strings. An adapter that subscribes with the wrong one streams
// nothing and every streaming test below times out.
// ────────────────────────────────────────────────────────────────

/* W10 */

import * as acp from '@agentclientprotocol/sdk';
import type { EventBus } from '@generatorai/core';
import type { PersistedEvent } from '@generatorai/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AcpInboundAdapter } from '../acp/AcpInboundAdapter.js';
import type { AcpHarnessBridge, AcpSessionHandle } from '../acp/AcpInboundAdapter.js';

// ── Fixtures ─────────────────────────────────────────────────────

/** The two ids are DIFFERENT on purpose — see the file header. */
const CHAT_ID = 'chat-acp-1';
const EVENT_SESSION_ID = 'session-acp-1';
const CWD = '/workspace/project';

type Emit = (kind: string, data?: Record<string, unknown>) => void;

/**
 * Minimal EventBus stand-in.
 *
 * `emit` fans out to the handlers registered for exactly that key, which is
 * what makes a wrong subscription key observable as silence.
 */
class FakeEventBus {
  readonly handlers = new Map<string, Set<(event: PersistedEvent) => void>>();
  readonly subscribedKeys: string[] = [];
  readonly unsubscribedKeys: string[] = [];
  private seq = 0;

  subscribe(sessionId: string, handler: (event: PersistedEvent) => void): () => void {
    this.subscribedKeys.push(sessionId);
    let set = this.handlers.get(sessionId);
    if (!set) {
      set = new Set();
      this.handlers.set(sessionId, set);
    }
    set.add(handler);
    return () => {
      this.unsubscribedKeys.push(sessionId);
      set.delete(handler);
    };
  }

  emit(sessionId: string, kind: string, data: Record<string, unknown> = {}): void {
    const handlers = this.handlers.get(sessionId);
    if (!handlers) return;
    const event: PersistedEvent = {
      id: ++this.seq,
      sessionId,
      sequenceId: this.seq,
      kind: kind as PersistedEvent['kind'],
      data,
      timestamp: Date.now(),
    };
    for (const handler of [...handlers]) handler(event);
  }

  asEventBus(): EventBus {
    return this as unknown as EventBus;
  }
}

interface Fixture {
  adapter: AcpInboundAdapter;
  bus: FakeEventBus;
  bridge: {
    createSession: ReturnType<typeof vi.fn>;
    sendPrompt: ReturnType<typeof vi.fn>;
    cancelTurn: ReturnType<typeof vi.fn>;
    releaseSession: ReturnType<typeof vi.fn>;
    decidePlan: ReturnType<typeof vi.fn>;
  };
  diagnostics: string[];
}

interface FixtureOptions {
  /**
   * Runs when the bridge receives a prompt. Emitting from here mirrors the
   * real world: harness events only start once the prompt is accepted.
   */
  script?: (emit: Emit) => void | Promise<void>;
  sendPromptRejects?: Error;
  cancelTurnRejects?: Error;
  /** Omit `decidePlan` entirely, as when plan mode is disabled. */
  withoutDecidePlan?: boolean;
}

function makeFixture(opts: FixtureOptions = {}): Fixture {
  const bus = new FakeEventBus();
  const diagnostics: string[] = [];

  const handle: AcpSessionHandle = { chatId: CHAT_ID, eventSessionId: EVENT_SESSION_ID };
  const emit: Emit = (kind, data = {}) => bus.emit(EVENT_SESSION_ID, kind, data);

  const bridge = {
    createSession: vi.fn(async () => handle),
    sendPrompt: vi.fn(async () => {
      if (opts.sendPromptRejects) throw opts.sendPromptRejects;
      // Detached so `sendPrompt` resolves first, exactly like the real service:
      // it returns once the turn is accepted, not once it is finished.
      if (opts.script) void Promise.resolve().then(() => opts.script?.(emit));
    }),
    cancelTurn: vi.fn(async () => {
      if (opts.cancelTurnRejects) throw opts.cancelTurnRejects;
    }),
    releaseSession: vi.fn(async () => undefined),
    decidePlan: vi.fn(async () => undefined),
  };

  const bridgePort: AcpHarnessBridge = opts.withoutDecidePlan
    ? {
        createSession: bridge.createSession,
        sendPrompt: bridge.sendPrompt,
        cancelTurn: bridge.cancelTurn,
        releaseSession: bridge.releaseSession,
      }
    : (bridge as unknown as AcpHarnessBridge);

  const adapter = new AcpInboundAdapter({
    bridge: bridgePort,
    eventBus: bus.asEventBus(),
    agentName: 'GeneratorAI-test',
    agentVersion: '9.9.9',
    onDiagnostic: (m) => diagnostics.push(m),
  });

  return { adapter, bus, bridge, diagnostics };
}

// ── In-process client harness ────────────────────────────────────

interface Connected {
  /** ClientContext for calling agent-side methods. */
  agent: acp.ClientContext;
  close: () => void;
  /** Permission requests the agent sent us, in order. */
  permissionRequests: acp.RequestPermissionRequest[];
}

/**
 * Connect a real `acp.client()` to the adapter in-process.
 *
 * The ADAPTER must be the connecting side: `AgentApp.connect(clientApp)` is
 * what yields the `AgentConnection` the adapter needs in order to push
 * `session/update` at all. The client picks its own connection up through
 * `onConnect`, which `connect()` fires for the peer.
 */
async function connectClient(
  adapter: AcpInboundAdapter,
  respondToPermission?: (
    req: acp.RequestPermissionRequest,
  ) => acp.RequestPermissionResponse,
): Promise<Connected> {
  const permissionRequests: acp.RequestPermissionRequest[] = [];
  const clientApp = acp.client({ name: 'test-client' });

  clientApp.onRequest(acp.methods.client.session.requestPermission, (ctx) => {
    permissionRequests.push(ctx.params);
    return (
      respondToPermission?.(ctx.params) ?? {
        outcome: { outcome: 'cancelled' as const },
      }
    );
  });

  let resolveConn: (c: acp.ClientConnection) => void;
  const ready = new Promise<acp.ClientConnection>((r) => {
    resolveConn = r;
  });
  clientApp.onConnect((connection) => {
    resolveConn(connection);
  });

  adapter.start(clientApp);
  const connection = await ready;
  return {
    agent: connection.agent,
    close: () => connection.close(),
    permissionRequests,
  };
}

/** initialize + session/new, returning the live ActiveSession. */
async function startSession(
  client: Connected,
  cwd = CWD,
): Promise<acp.ActiveSession> {
  await client.agent.request(acp.methods.agent.initialize, {
    protocolVersion: acp.PROTOCOL_VERSION,
    clientInfo: { name: 'test-client', version: '1.0.0' },
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
  });
  return client.agent.buildSession(cwd).start();
}

/** Drain every update until the turn stops, keeping both. */
async function drain(
  session: acp.ActiveSession,
): Promise<{ updates: acp.SessionUpdate[]; stopReason: acp.StopReason }> {
  const updates: acp.SessionUpdate[] = [];
  for (;;) {
    const message = await session.nextUpdate();
    if (message.kind === 'stop') return { updates, stopReason: message.stopReason };
    updates.push(message.update);
  }
}

// ── ndJSON wire harness ──────────────────────────────────────────

interface Wire {
  send: (message: unknown) => Promise<void>;
  /** Resolves with the next line the agent writes, or null after `ms`. */
  nextLine: (ms?: number) => Promise<Record<string, unknown> | null>;
  close: () => Promise<void>;
}

function openWire(adapter: AcpInboundAdapter): Wire {
  const toAgent = new TransformStream<Uint8Array, Uint8Array>();
  const fromAgent = new TransformStream<Uint8Array, Uint8Array>();
  adapter.start(acp.ndJsonStream(fromAgent.writable, toAgent.readable));

  const writer = toAgent.writable.getWriter();
  const reader = fromAgent.readable.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffered = '';

  return {
    async send(message) {
      await writer.write(encoder.encode(`${JSON.stringify(message)}\n`));
    },
    async nextLine(ms = 250) {
      for (;;) {
        const newline = buffered.indexOf('\n');
        if (newline >= 0) {
          const line = buffered.slice(0, newline).trim();
          buffered = buffered.slice(newline + 1);
          if (line) return JSON.parse(line) as Record<string, unknown>;
          continue;
        }
        const chunk = await Promise.race([
          reader.read(),
          new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms)),
        ]);
        if (chunk === 'timeout') return null;
        if (chunk.done) return null;
        buffered += decoder.decode(chunk.value, { stream: true });
      }
    },
    async close() {
      await writer.close().catch(() => undefined);
      await reader.cancel().catch(() => undefined);
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AcpInboundAdapter — initialize', () => {
  it('answers the INTEGER protocol version on the real wire', async () => {
    // Regression for the fatal bug: the adapter declared string versions
    // ['0.2','0.1'] and answered `protocolVersion: 1` with
    // `-32001 Unsupported protocol version`, so every real client
    // disconnected on its first message.
    const { adapter } = makeFixture();
    const wire = openWire(adapter);

    await wire.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: acp.PROTOCOL_VERSION },
    });

    const response = await wire.nextLine();
    expect(response).not.toBeNull();
    expect(response?.['error']).toBeUndefined();
    const result = response?.['result'] as acp.InitializeResponse;
    expect(result.protocolVersion).toBe(1);
    expect(typeof result.protocolVersion).toBe('number');

    await wire.close();
    await adapter.stop();
  });

  it('never errors on an unknown version — it answers with its own', async () => {
    // ACP negotiates by answering, not by rejecting: the client decides
    // whether to disconnect.
    const { adapter, diagnostics } = makeFixture();
    const wire = openWire(adapter);

    await wire.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: 99 },
    });

    const response = await wire.nextLine();
    expect(response?.['error']).toBeUndefined();
    expect((response?.['result'] as acp.InitializeResponse).protocolVersion).toBe(
      acp.PROTOCOL_VERSION,
    );
    expect(diagnostics.join('\n')).toContain('99');

    await wire.close();
    await adapter.stop();
  });

  it('reports agentInfo and advertises no capability it does not serve', async () => {
    const { adapter } = makeFixture();
    const client = await connectClient(adapter);

    const result = await client.agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
    });

    expect(result.agentInfo).toEqual({ name: 'GeneratorAI-test', version: '9.9.9' });
    expect(result.agentCapabilities?.loadSession).toBe(false);
    expect(result.agentCapabilities?.promptCapabilities).toEqual({
      image: false,
      audio: false,
      embeddedContext: false,
    });

    client.close();
    await adapter.stop();
  });

  it('records but never uses the client fs/terminal capabilities (L16 Tier-B)', async () => {
    const { adapter, diagnostics } = makeFixture();
    const client = await connectClient(adapter);
    await startSession(client);

    expect(diagnostics.join('\n')).toContain('Tier-B');

    client.close();
    await adapter.stop();
  });

  it('rejects session/new before initialize', async () => {
    const { adapter, bridge } = makeFixture();
    const client = await connectClient(adapter);

    await expect(
      client.agent.request(acp.methods.agent.session.new, { cwd: CWD, mcpServers: [] }),
    ).rejects.toThrow(/not initialized/i);
    expect(bridge.createSession).not.toHaveBeenCalled();

    client.close();
    await adapter.stop();
  });
});

describe('AcpInboundAdapter — session/new', () => {
  it('subscribes on the EVENT session id, not the chat id', async () => {
    // The pre-fix adapter subscribed to an id it invented
    // (`acp-${sessionId}-${Date.now()}`), which nothing ever publishes on.
    const { adapter, bus, bridge } = makeFixture();
    const client = await connectClient(adapter);
    const session = await startSession(client);

    expect(session.sessionId).toBe(CHAT_ID);
    expect(bus.subscribedKeys).toEqual([EVENT_SESSION_ID]);
    expect(bus.subscribedKeys).not.toContain(CHAT_ID);
    expect(bridge.createSession).toHaveBeenCalledWith({ cwd: CWD });

    client.close();
    await adapter.stop();
  });

  it('forwards additionalDirectories to the bridge', async () => {
    const { adapter, bridge } = makeFixture();
    const client = await connectClient(adapter);
    await client.agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
    });
    await client.agent
      .buildSession(CWD)
      .withAdditionalDirectories(['/workspace/extra'])
      .start();

    expect(bridge.createSession).toHaveBeenCalledWith({
      cwd: CWD,
      additionalDirectories: ['/workspace/extra'],
    });

    client.close();
    await adapter.stop();
  });
});

describe('AcpInboundAdapter — streaming session/prompt', () => {
  it('streams agent_message_chunk updates and stops on harness.idle', async () => {
    // The acceptance bar: a real SDK client observing real session/update
    // notifications. If the subscription key were wrong this would hang.
    const { adapter, bridge } = makeFixture({
      script: (emit) => {
        emit('harness.token', { text: 'Hello ' });
        emit('harness.token', { text: 'world' });
        emit('harness.idle');
      },
    });
    const client = await connectClient(adapter);
    const session = await startSession(client);

    const done = drain(session);
    await session.prompt('say hi');
    const { updates, stopReason } = await done;

    expect(bridge.sendPrompt).toHaveBeenCalledWith(CHAT_ID, 'say hi');
    expect(stopReason).toBe('end_turn');
    expect(updates).toEqual([
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello ' } },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'world' } },
    ]);

    client.close();
    await adapter.stop();
  });

  it('streams NOTHING when events are published on the chat id', async () => {
    // The inverse of the test above, and the one that would have caught the
    // original bug: publishing on the wrong key must produce silence, so a
    // green streaming test cannot come from a bus that echoes any id.
    const { adapter, bus } = makeFixture({ script: () => undefined });
    const client = await connectClient(adapter);
    const session = await startSession(client);

    const promptPromise = session.prompt('say hi');
    let settled = false;
    void promptPromise.then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 20));

    // Wrong key — a token AND a terminal event, both ignored.
    bus.emit(CHAT_ID, 'harness.token', { text: 'ghost' });
    bus.emit(CHAT_ID, 'harness.idle');
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);

    // The correct key is what actually finishes the turn.
    bus.emit(EVENT_SESSION_ID, 'harness.idle');
    expect((await promptPromise).stopReason).toBe('end_turn');

    // …and the 'ghost' chunk was never streamed: the only queued message on
    // the client is the stop.
    expect((await session.nextUpdate()).kind).toBe('stop');

    client.close();
    await adapter.stop();
  });

  it('maps reasoning deltas to agent_thought_chunk', async () => {
    const { adapter } = makeFixture({
      script: (emit) => {
        emit('harness.reasoning_delta', { text: 'thinking…' });
        emit('harness.idle');
      },
    });
    const client = await connectClient(adapter);
    const session = await startSession(client);

    const done = drain(session);
    await session.prompt('hi');
    const { updates } = await done;

    expect(updates).toEqual([
      { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking…' } },
    ]);

    client.close();
    await adapter.stop();
  });

  it('does not double a message that was already streamed as tokens', async () => {
    // `harness.message_complete` restates the whole segment the tokens built.
    const { adapter } = makeFixture({
      script: (emit) => {
        emit('harness.token', { text: 'Hello world' });
        emit('harness.message_complete', { content: 'Hello world' });
        emit('harness.idle');
      },
    });
    const client = await connectClient(adapter);
    const session = await startSession(client);

    const done = drain(session);
    await session.prompt('hi');
    const { updates } = await done;

    expect(updates).toHaveLength(1);
    expect(await Promise.resolve(updates[0])).toEqual({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Hello world' },
    });

    client.close();
    await adapter.stop();
  });

  it('emits message_complete when the provider streamed no tokens', async () => {
    const { adapter } = makeFixture({
      script: (emit) => {
        emit('harness.message_complete', { content: 'Non-streaming answer' });
        emit('harness.idle');
      },
    });
    const client = await connectClient(adapter);
    const session = await startSession(client);

    const done = drain(session);
    await session.prompt('hi');
    const { updates } = await done;

    expect(updates).toEqual([
      {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Non-streaming answer' },
      },
    ]);

    client.close();
    await adapter.stop();
  });

  it('pairs tool_call and tool_call_update on the same toolCallId', async () => {
    const { adapter } = makeFixture({
      script: (emit) => {
        emit('harness.tool_start', { tool: 'Read', args: { file_path: '/a.ts' }, callId: 'c1' });
        emit('harness.tool_complete', { tool: 'Read', result: { ok: true }, callId: 'c1' });
        emit('harness.idle');
      },
    });
    const client = await connectClient(adapter);
    const session = await startSession(client);

    const done = drain(session);
    await session.prompt('read it');
    const { updates } = await done;

    expect(updates).toEqual([
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'c1',
        title: 'Read',
        kind: 'read',
        status: 'in_progress',
        rawInput: { file_path: '/a.ts' },
      },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'c1',
        status: 'completed',
        rawOutput: { ok: true },
      },
    ]);

    client.close();
    await adapter.stop();
  });

  it('pairs tool events by name when callId is absent', async () => {
    // `callId` is optional on both harness tool events. The pre-fix adapter
    // used `call-${Date.now()}` on start and '' on complete, so nothing could
    // ever be paired.
    const { adapter } = makeFixture({
      script: (emit) => {
        emit('harness.tool_start', { tool: 'Bash', args: { command: 'ls' } });
        emit('harness.tool_complete', { tool: 'Bash', result: 'out', success: false });
        emit('harness.idle');
      },
    });
    const client = await connectClient(adapter);
    const session = await startSession(client);

    const done = drain(session);
    await session.prompt('run');
    const { updates } = await done;

    const start = updates[0] as { toolCallId: string; kind: string };
    const end = updates[1] as { toolCallId: string; status: string };
    expect(start.toolCallId).toBe(end.toolCallId);
    expect(start.kind).toBe('execute');
    expect(end.status).toBe('failed');

    client.close();
    await adapter.stop();
  });

  it('reports usage on the PromptResponse', async () => {
    const { adapter } = makeFixture({
      script: (emit) => {
        emit('harness.usage', { model: 'm', inputTokens: 100, outputTokens: 50 });
        emit('harness.idle');
      },
    });
    const client = await connectClient(adapter);
    const session = await startSession(client);

    const response = await session.prompt('hi');
    expect(response.stopReason).toBe('end_turn');
    expect(response.usage).toEqual({ totalTokens: 150, inputTokens: 100, outputTokens: 50 });

    client.close();
    await adapter.stop();
  });

  it('delivers every chunk BEFORE the prompt response resolves', async () => {
    const { adapter } = makeFixture({
      script: (emit) => {
        emit('harness.token', { text: 'a' });
        emit('harness.token', { text: 'b' });
        emit('harness.idle');
      },
    });
    const client = await connectClient(adapter);
    const session = await startSession(client);

    // Ordering is observable through ActiveSession's queue: the two chunks must
    // be queued ahead of the stop message.
    const promptPromise = session.prompt('hi');
    const first = await session.nextUpdate();
    const second = await session.nextUpdate();
    const third = await session.nextUpdate();
    await promptPromise;

    expect(first.kind).toBe('session_update');
    expect(second.kind).toBe('session_update');
    expect(third.kind).toBe('stop');

    client.close();
    await adapter.stop();
  });

  it('fails the turn when the harness errors', async () => {
    const { adapter } = makeFixture({
      script: (emit) => {
        emit('harness.error', { message: 'model exploded' });
      },
    });
    const client = await connectClient(adapter);
    const session = await startSession(client);

    await expect(session.prompt('hi')).rejects.toThrow(/model exploded/);

    client.close();
    await adapter.stop();
  });

  it('rejects a second concurrent prompt for the same session', async () => {
    const { adapter, bus } = makeFixture({ script: () => undefined });
    const client = await connectClient(adapter);
    const session = await startSession(client);

    const first = session.prompt('one');
    await new Promise((r) => setTimeout(r, 20));
    await expect(session.prompt('two')).rejects.toThrow(/already in progress/i);

    bus.emit(EVENT_SESSION_ID, 'harness.idle');
    await first;

    client.close();
    await adapter.stop();
  });

  it('rejects a prompt for an unknown session', async () => {
    const { adapter } = makeFixture();
    const client = await connectClient(adapter);
    await client.agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
    });

    await expect(
      client.agent.request(acp.methods.agent.session.prompt, {
        sessionId: 'nope',
        prompt: [{ type: 'text', text: 'hi' }],
      }),
    ).rejects.toThrow(/Unknown session/i);

    client.close();
    await adapter.stop();
  });

  it('surfaces a sendPrompt failure as a JSON-RPC error', async () => {
    const { adapter } = makeFixture({ sendPromptRejects: new Error('harness offline') });
    const client = await connectClient(adapter);
    const session = await startSession(client);

    await expect(session.prompt('hi')).rejects.toThrow(/harness offline/);

    client.close();
    await adapter.stop();
  });

  it('flattens resource_link blocks into the prompt text', async () => {
    const { adapter, bridge } = makeFixture({
      script: (emit) => emit('harness.idle'),
    });
    const client = await connectClient(adapter);
    const session = await startSession(client);

    await session.prompt([
      { type: 'text', text: 'look at' },
      { type: 'resource_link', uri: 'file:///a.ts', name: 'a.ts' },
    ]);

    expect(bridge.sendPrompt).toHaveBeenCalledWith(CHAT_ID, 'look at\n@file:///a.ts');

    client.close();
    await adapter.stop();
  });
});

describe('AcpInboundAdapter — session/cancel', () => {
  it('is a notification and gets NO JSON-RPC response', async () => {
    // JSON-RPC 2.0 forbids responding to a notification. The pre-fix adapter
    // replied with `id: null`, which is a malformed response object.
    const { adapter } = makeFixture();
    const wire = openWire(adapter);

    await wire.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: acp.PROTOCOL_VERSION },
    });
    expect(await wire.nextLine()).not.toBeNull();

    await wire.send({
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: { sessionId: 'anything' },
    });
    expect(await wire.nextLine()).toBeNull();

    await wire.close();
    await adapter.stop();
  });

  it('aborts the turn and stops with stopReason cancelled', async () => {
    const { adapter, bridge, bus } = makeFixture({
      script: (emit) => {
        emit('harness.token', { text: 'partial' });
      },
    });
    const client = await connectClient(adapter);
    const session = await startSession(client);

    const promptPromise = session.prompt('long task');
    await new Promise((r) => setTimeout(r, 20));

    await client.agent.notify(acp.methods.agent.session.cancel, { sessionId: CHAT_ID });
    await new Promise((r) => setTimeout(r, 20));
    expect(bridge.cancelTurn).toHaveBeenCalledWith(CHAT_ID);

    // The harness still goes idle after the abort; that must read as cancelled.
    bus.emit(EVENT_SESSION_ID, 'harness.idle');
    expect((await promptPromise).stopReason).toBe('cancelled');

    client.close();
    await adapter.stop();
  });

  it('settles the turn itself when the abort never reaches the harness', async () => {
    const { adapter, diagnostics } = makeFixture({
      script: () => undefined,
      cancelTurnRejects: new Error('abort failed'),
    });
    const client = await connectClient(adapter);
    const session = await startSession(client);

    const promptPromise = session.prompt('long task');
    await new Promise((r) => setTimeout(r, 20));
    await client.agent.notify(acp.methods.agent.session.cancel, { sessionId: CHAT_ID });

    // No terminal harness event is coming, so the adapter must not hang.
    expect((await promptPromise).stopReason).toBe('cancelled');
    expect(diagnostics.join('\n')).toContain('abort failed');

    client.close();
    await adapter.stop();
  });

  it('maps harness.cancelled to stopReason cancelled', async () => {
    const { adapter } = makeFixture({
      script: (emit) => emit('harness.cancelled', { reason: 'user_abort' }),
    });
    const client = await connectClient(adapter);
    const session = await startSession(client);

    expect((await session.prompt('hi')).stopReason).toBe('cancelled');

    client.close();
    await adapter.stop();
  });
});

describe('AcpInboundAdapter — session/request_permission', () => {
  it('raises a permission request for a plan gate and echoes the chosen optionId', async () => {
    const { adapter, bridge, bus } = makeFixture({
      script: (emit) => {
        emit('chat.plan.review_requested', {
          chatId: CHAT_ID,
          planId: 'plan-1',
          interactionId: 'int-1',
          revision: 1,
          summary: 'Refactor the parser\nmore detail',
          actions: ['exit_only', 'implement_interactive'],
        });
      },
    });

    const client = await connectClient(adapter, () => ({
      outcome: { outcome: 'selected' as const, optionId: 'implement_interactive' },
    }));
    const session = await startSession(client);

    const promptPromise = session.prompt('plan it');
    await vi.waitFor(() => expect(bridge.decidePlan).toHaveBeenCalled());

    const request = client.permissionRequests[0]!;
    expect(request.sessionId).toBe(CHAT_ID);
    expect(request.toolCall).toEqual({
      toolCallId: 'int-1',
      title: 'Refactor the parser',
      kind: 'think',
      status: 'pending',
    });
    expect(request.options.map((o) => o.optionId)).toEqual([
      'exit_only',
      'implement_interactive',
      'reject',
    ]);
    expect(bridge.decidePlan).toHaveBeenCalledWith(CHAT_ID, 'plan-1', {
      approved: true,
      action: 'implement_interactive',
    });

    bus.emit(EVENT_SESSION_ID, 'harness.idle');
    await promptPromise;
    client.close();
    await adapter.stop();
  });

  it('treats the reject option as a rejection', async () => {
    const { adapter, bridge } = makeFixture({
      script: (emit) => {
        emit('chat.plan.review_requested', {
          chatId: CHAT_ID,
          planId: 'plan-1',
          interactionId: 'int-1',
          summary: 'Do the thing',
          actions: ['exit_only'],
        });
        emit('harness.idle');
      },
    });
    const client = await connectClient(adapter, () => ({
      outcome: { outcome: 'selected' as const, optionId: 'reject' },
    }));
    const session = await startSession(client);

    await session.prompt('plan it');
    await vi.waitFor(() => expect(bridge.decidePlan).toHaveBeenCalled());
    expect(bridge.decidePlan).toHaveBeenCalledWith(CHAT_ID, 'plan-1', { approved: false });

    client.close();
    await adapter.stop();
  });

  it('refuses an optionId it never advertised', async () => {
    const { adapter, bridge } = makeFixture({
      script: (emit) => {
        emit('chat.plan.review_requested', {
          chatId: CHAT_ID,
          planId: 'plan-1',
          interactionId: 'int-1',
          summary: 'Do the thing',
          actions: ['exit_only'],
        });
        emit('harness.idle');
      },
    });
    const client = await connectClient(adapter, () => ({
      outcome: { outcome: 'selected' as const, optionId: 'implement_autopilot' },
    }));
    const session = await startSession(client);

    await session.prompt('plan it');
    await vi.waitFor(() => expect(bridge.decidePlan).toHaveBeenCalled());
    // Not advertised (the gate only offered exit_only) → must not be honoured.
    expect(bridge.decidePlan).toHaveBeenCalledWith(CHAT_ID, 'plan-1', { approved: false });

    client.close();
    await adapter.stop();
  });

  it('raises no permission request when plan mode is unavailable', async () => {
    const { adapter } = makeFixture({
      withoutDecidePlan: true,
      script: (emit) => {
        emit('chat.plan.review_requested', {
          chatId: CHAT_ID,
          planId: 'plan-1',
          interactionId: 'int-1',
          summary: 'Do the thing',
          actions: ['exit_only'],
        });
        emit('harness.idle');
      },
    });
    const client = await connectClient(adapter);
    const session = await startSession(client);

    await session.prompt('plan it');
    expect(client.permissionRequests).toHaveLength(0);

    client.close();
    await adapter.stop();
  });
});

describe('AcpInboundAdapter — lifecycle and cleanup', () => {
  it('start() is idempotent', async () => {
    const { adapter } = makeFixture();
    const clientApp = acp.client({ name: 'c' });
    const first = adapter.start(clientApp);
    const second = adapter.start(acp.client({ name: 'other' }));
    expect(second).toBe(first);
    await adapter.stop();
  });

  it('session/close unsubscribes and releases the harness conversation', async () => {
    const { adapter, bus, bridge } = makeFixture();
    const client = await connectClient(adapter);
    await startSession(client);
    expect(adapter.sessionCount).toBe(1);

    await client.agent.request(acp.methods.agent.session.close, { sessionId: CHAT_ID });

    expect(adapter.sessionCount).toBe(0);
    expect(bus.unsubscribedKeys).toEqual([EVENT_SESSION_ID]);
    expect(bridge.releaseSession).toHaveBeenCalledWith({
      chatId: CHAT_ID,
      eventSessionId: EVENT_SESSION_ID,
    });

    client.close();
    await adapter.stop();
  });

  it('releases every session when the client disconnects', async () => {
    const { adapter, bus, bridge } = makeFixture();
    const client = await connectClient(adapter);
    await startSession(client);
    expect(adapter.sessionCount).toBe(1);

    client.close();
    await vi.waitFor(() => expect(adapter.sessionCount).toBe(0));

    expect(bus.unsubscribedKeys).toEqual([EVENT_SESSION_ID]);
    expect(bridge.releaseSession).toHaveBeenCalledOnce();

    await adapter.stop();
  });

  it('stop() releases every session and is idempotent', async () => {
    const { adapter, bus, bridge } = makeFixture();
    const client = await connectClient(adapter);
    await startSession(client);

    await adapter.stop();
    await adapter.stop();

    expect(adapter.sessionCount).toBe(0);
    expect(bus.unsubscribedKeys).toEqual([EVENT_SESSION_ID]);
    expect(bridge.releaseSession).toHaveBeenCalledOnce();
    client.close();
  });

  it('stops delivering events after a session is released', async () => {
    const { adapter, bus } = makeFixture();
    const client = await connectClient(adapter);
    await startSession(client);
    await client.agent.request(acp.methods.agent.session.close, { sessionId: CHAT_ID });

    // The unsubscribe must have actually detached the handler.
    expect(bus.handlers.get(EVENT_SESSION_ID)?.size ?? 0).toBe(0);

    client.close();
    await adapter.stop();
  });
});
