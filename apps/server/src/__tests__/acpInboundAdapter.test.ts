// ────────────────────────────────────────────────────────────────
// W10 — AcpInboundAdapter unit tests
//
// Tests the JSON-RPC handling and AgentEvent → ACP chunk mapping
// without a real harness or EventBus. Uses mocks throughout.
// ────────────────────────────────────────────────────────────────

import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { AcpInboundAdapter } from '../acp/AcpInboundAdapter.js';
import type { AcpHarnessBridge } from '../acp/AcpInboundAdapter.js';

// ── Helpers ──────────────────────────────────────────────────────

type EventHandler = (event: { kind: string; data: Record<string, unknown>; sessionId: string }) => void;

interface MockEventBus {
  subscribe: (sessionId: string, handler: EventHandler, name?: string) => () => void;
}

function makeOutput(): { lines: string[]; writable: Writable } {
  const lines: string[] = [];
  const writable = new Writable({
    write(chunk, _enc, cb) {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) lines.push(line.trim());
      }
      cb();
    },
  });
  return { lines, writable };
}

function parseLines(lines: string[]): unknown[] {
  return lines.map((l) => JSON.parse(l));
}

interface TestContext {
  adapter: AcpInboundAdapter;
  harness: AcpHarnessBridge & {
    createConversation: ReturnType<typeof vi.fn>;
    sendPrompt: ReturnType<typeof vi.fn>;
    abortConversation: ReturnType<typeof vi.fn>;
  };
  eventBus: MockEventBus & { subscribe: ReturnType<typeof vi.fn> };
  output: { lines: string[]; writable: Writable };
  /** Trigger an event on a specific conversationId. */
  emitEvent: (conversationId: string, kind: string, data: Record<string, unknown>) => void;
}

function makeContext(): TestContext {
  const handlers = new Map<string, EventHandler>();

  const harness = {
    createConversation: vi.fn(async ({ conversationId }: { conversationId: string }) => ({
      conversationId,
    })),
    sendPrompt: vi.fn(async () => undefined),
    abortConversation: vi.fn(async () => undefined),
  };

  const eventBus = {
    subscribe: vi.fn((sessionId: string, handler: EventHandler) => {
      handlers.set(sessionId, handler);
      return () => handlers.delete(sessionId);
    }),
  };

  const output = makeOutput();

  const adapter = new AcpInboundAdapter({
    harness,
    eventBus: eventBus as unknown as import('@generatorai/core').EventBus,
    output: output.writable,
    onExit: vi.fn(),
  });

  const emitEvent = (conversationId: string, kind: string, data: Record<string, unknown>) => {
    const handler = handlers.get(conversationId);
    if (handler) handler({ kind, data, sessionId: conversationId } as Parameters<EventHandler>[0]);
  };

  return { adapter, harness, eventBus, output, emitEvent };
}

async function sendLine(adapter: AcpInboundAdapter, msg: object): Promise<void> {
  const stream = new PassThrough();
  adapter.start(stream);
  stream.push(JSON.stringify(msg) + '\n');
  // Give async handlers a chance to run
  await new Promise((r) => setImmediate(r));
}

// ── Tests ────────────────────────────────────────────────────────

describe('AcpInboundAdapter', () => {
  describe('initialize', () => {
    it('responds with negotiated version 0.2 when client requests 0.2', async () => {
      const ctx = makeContext();
      await sendLine(ctx.adapter, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '0.2', clientInfo: { name: 'TestClient' } },
      });
      const msgs = parseLines(ctx.output.lines) as Array<{ result?: { protocolVersion?: string } }>;
      const init = msgs.find((m) => (m as { id?: number }).id === 1);
      expect(init).toBeDefined();
      expect(init?.result?.protocolVersion).toBe('0.2');
    });

    it('negotiates down to 0.1 when client requests 0.1', async () => {
      const ctx = makeContext();
      await sendLine(ctx.adapter, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '0.1' },
      });
      const msgs = parseLines(ctx.output.lines) as Array<{ id?: number; result?: { protocolVersion?: string } }>;
      const init = msgs.find((m) => m.id === 1);
      expect(init?.result?.protocolVersion).toBe('0.1');
    });

    it('rejects an unsupported version', async () => {
      const ctx = makeContext();
      await sendLine(ctx.adapter, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '9.9' },
      });
      const msgs = parseLines(ctx.output.lines) as Array<{ id?: number; error?: { code?: number } }>;
      const resp = msgs.find((m) => m.id === 1);
      expect(resp?.error?.code).toBeDefined();
    });

    it('rejects turn before initialize', async () => {
      const ctx = makeContext();
      await sendLine(ctx.adapter, {
        jsonrpc: '2.0',
        id: 2,
        method: 'turn',
        params: { sessionId: 'sess-1', messages: [{ role: 'user', content: 'hi' }] },
      });
      const msgs = parseLines(ctx.output.lines) as Array<{ id?: number; error?: { code?: number } }>;
      const resp = msgs.find((m) => m.id === 2);
      expect(resp?.error).toBeDefined();
    });
  });

  describe('turn', () => {
    async function initAndTurn(ctx: TestContext, sessionId = 'sess-1'): Promise<void> {
      const stream = new PassThrough();
      ctx.adapter.start(stream);
      // initialize
      stream.push(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '0.2' },
        }) + '\n',
      );
      await new Promise((r) => setImmediate(r));
      // turn
      stream.push(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'turn',
          params: { sessionId, messages: [{ role: 'user', content: 'Hello' }] },
        }) + '\n',
      );
      await new Promise((r) => setImmediate(r));
    }

    it('calls harness.createConversation on first turn', async () => {
      const ctx = makeContext();
      await initAndTurn(ctx);
      expect(ctx.harness.createConversation).toHaveBeenCalledOnce();
    });

    it('responds with stream_start', async () => {
      const ctx = makeContext();
      await initAndTurn(ctx);
      const msgs = parseLines(ctx.output.lines) as Array<{ id?: number; result?: { type?: string; sessionId?: string } }>;
      const start = msgs.find((m) => m.id === 2);
      expect(start?.result?.type).toBe('stream_start');
      expect(start?.result?.sessionId).toBe('sess-1');
    });

    it('maps harness.token event to ACP text chunk', async () => {
      const ctx = makeContext();
      await initAndTurn(ctx);
      // Grab the conversationId the harness was called with
      const { conversationId } = ctx.harness.createConversation.mock.calls[0]![0]!;
      ctx.emitEvent(conversationId, 'harness.token', { text: 'Hello world' });
      await new Promise((r) => setImmediate(r));
      const msgs = parseLines(ctx.output.lines) as Array<{
        method?: string;
        params?: { chunk?: { type?: string; content?: string } };
      }>;
      const chunk = msgs.find((m) => m.method === 'turn/chunk');
      expect(chunk?.params?.chunk?.type).toBe('text');
      expect(chunk?.params?.chunk?.content).toBe('Hello world');
    });

    it('maps harness.tool_start to ACP tool_call chunk', async () => {
      const ctx = makeContext();
      await initAndTurn(ctx);
      const { conversationId } = ctx.harness.createConversation.mock.calls[0]![0]!;
      ctx.emitEvent(conversationId, 'harness.tool_start', {
        tool: 'Read',
        args: { file_path: '/foo.ts' },
        callId: 'call-1',
      });
      await new Promise((r) => setImmediate(r));
      const msgs = parseLines(ctx.output.lines) as Array<{
        method?: string;
        params?: { chunk?: { type?: string; name?: string; callId?: string; input?: unknown } };
      }>;
      const chunk = msgs.find((m) => m.method === 'turn/chunk');
      expect(chunk?.params?.chunk?.type).toBe('tool_call');
      expect(chunk?.params?.chunk?.name).toBe('Read');
      expect(chunk?.params?.chunk?.callId).toBe('call-1');
    });

    it('maps harness.cancelled to ACP cancelled chunk', async () => {
      const ctx = makeContext();
      await initAndTurn(ctx);
      const { conversationId } = ctx.harness.createConversation.mock.calls[0]![0]!;
      ctx.emitEvent(conversationId, 'harness.cancelled', { reason: 'user_abort' });
      await new Promise((r) => setImmediate(r));
      const msgs = parseLines(ctx.output.lines) as Array<{
        method?: string;
        params?: { chunk?: { type?: string; reason?: string } };
      }>;
      const cancelChunk = msgs.find(
        (m) => m.method === 'turn/chunk' && (m.params?.chunk as { type?: string })?.type === 'cancelled',
      );
      expect(cancelChunk).toBeDefined();
      expect(cancelChunk?.params?.chunk?.reason).toBe('user_abort');
    });

    it('maps chat.message_complete to ACP done chunk', async () => {
      const ctx = makeContext();
      await initAndTurn(ctx);
      const { conversationId } = ctx.harness.createConversation.mock.calls[0]![0]!;
      ctx.emitEvent(conversationId, 'chat.message_complete', {
        usage: { inputTokens: 100, outputTokens: 50 },
      });
      await new Promise((r) => setImmediate(r));
      const msgs = parseLines(ctx.output.lines) as Array<{
        method?: string;
        params?: { chunk?: { type?: string; usage?: { inputTokens?: number; outputTokens?: number } } };
      }>;
      const doneChunk = msgs.find(
        (m) => m.method === 'turn/chunk' && (m.params?.chunk as { type?: string })?.type === 'done',
      );
      expect(doneChunk).toBeDefined();
      expect(doneChunk?.params?.chunk?.usage?.inputTokens).toBe(100);
    });
  });

  describe('cancel', () => {
    it('calls harness.abortConversation and responds with cancelled:true', async () => {
      const ctx = makeContext();
      const stream = new PassThrough();
      ctx.adapter.start(stream);
      stream.push(
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '0.2' } }) + '\n',
      );
      await new Promise((r) => setImmediate(r));
      stream.push(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'turn',
          params: { sessionId: 'sess-cancel', messages: [{ role: 'user', content: 'hi' }] },
        }) + '\n',
      );
      await new Promise((r) => setImmediate(r));
      stream.push(
        JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'cancel', params: { sessionId: 'sess-cancel' } }) + '\n',
      );
      await new Promise((r) => setImmediate(r));
      expect(ctx.harness.abortConversation).toHaveBeenCalledOnce();
      const msgs = parseLines(ctx.output.lines) as Array<{ id?: number; result?: { cancelled?: boolean } }>;
      const cancelResp = msgs.find((m) => m.id === 3);
      expect(cancelResp?.result?.cancelled).toBe(true);
    });
  });

  describe('parse error handling', () => {
    it('returns parse error on malformed JSON', async () => {
      const ctx = makeContext();
      const stream = new PassThrough();
      ctx.adapter.start(stream);
      stream.push('not-json\n');
      await new Promise((r) => setImmediate(r));
      const msgs = parseLines(ctx.output.lines) as Array<{ error?: { code?: number } }>;
      expect(msgs[0]?.error?.code).toBe(-32700);
    });
  });
});
