// ────────────────────────────────────────────────────────────────
// OpenCodeProvider — regression tests
// ────────────────────────────────────────────────────────────────
//
// W38 — every test runs against a REAL server on a real loopback port, so
// socket lifetime, SSE framing, headers and timeouts are exercised over a real
// connection rather than against a stubbed `fetch`.
//
// Two harnesses are used:
//   • `fixtures/fakeOpenCodeServe.mjs`, a stand-in implementing the real route
//     set and the real event ordering, spawned as a child process. Used for
//     end-to-end behaviour.
//   • A bespoke `node:http` server, for cases that need to observe exactly what
//     went on the wire or to misbehave deliberately.
//
// This suite was rewritten alongside the provider. The previous version
// asserted a contract `opencode serve` does not offer — that
// `POST /session/{id}/message` answers with an SSE stream, and that
// `POST /session` accepts `model` and `systemPrompt` — so it passed while the
// integration could not have worked against a real server. See
// `OPENCODE_OPERATIONS` in the generated protocol for which routes stream.
//
// Each `describe` below names the defect it pins.

import { describe, expect, it, afterEach } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { OpenCodeProvider } from '../OpenCodeProvider.js';
import {
  runCapabilityDeclarationConformance,
  runConversationLifecycleConformance,
  runFullConformance,
} from '../../../conformance/index.js';
import { OPENCODE_OPERATIONS } from '../../../protocol/opencode.generated.js';
import type { AgentEvent } from '@generatorai/shared';
import type { CreateConversationParams } from '@generatorai/core';
import type { OpenCodeProviderOptions } from '../../../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVE_FIXTURE = join(__dirname, 'fixtures', 'fakeOpenCodeServe.mjs');

/** One recorded request: what the provider actually put on the wire. */
interface Recorded {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: unknown;
}

interface Harness {
  baseUrl: string;
  requests: Recorded[];
  /** Responses still open server-side. Drains as the client releases them. */
  openResponses: Set<ServerResponse>;
  close(): Promise<void>;
}

type Handler = (req: IncomingMessage, res: ServerResponse, body: unknown, h: Harness) => void;

let servers: Server[] = [];
const live: OpenCodeProvider[] = [];

async function startHarness(handler: Handler): Promise<Harness> {
  const requests: Recorded[] = [];
  const openResponses = new Set<ServerResponse>();
  const harness = { requests, openResponses } as Harness;

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown;
      try { body = raw ? JSON.parse(raw) : undefined; } catch { body = raw; }
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      openResponses.add(res);
      res.on('close', () => openResponses.delete(res));
      handler(req, res, body, harness);
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  harness.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  harness.close = () => new Promise<void>((r) => server.close(() => r()));
  return harness;
}

/** Open an SSE response and return a pusher for it. */
function sse(res: ServerResponse): { send: (o: unknown) => void; end: () => void } {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  // Flush the headers NOW. Node buffers them until the first body write, so a
  // `writeHead`-only helper leaves the client's `fetch` unresolved — which is
  // not how any real SSE server behaves, and made these tests hang rather than
  // exercise what they meant to.
  res.write(': open\n\n');
  return {
    send: (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`),
    end: () => res.end(),
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function makeProvider(opts: OpenCodeProviderOptions): OpenCodeProvider {
  const p = new OpenCodeProvider(opts);
  live.push(p);
  return p;
}

/** A provider wired to the real fixture server, started by the provider itself. */
async function startedAgainstFixture(
  overrides: Partial<OpenCodeProviderOptions> = {},
): Promise<OpenCodeProvider> {
  const p = makeProvider({
    autoStart: true,
    binaryPath: process.execPath,
    serveArgs: [SERVE_FIXTURE, 'serve', '--port', '0'],
    defaultProviderId: 'opencode',
    ...overrides,
  });
  await p.initialize();
  return p;
}

function collect(provider: OpenCodeProvider, conversationId: string): { events: AgentEvent[]; stop: () => void } {
  const events: AgentEvent[] = [];
  const stop = provider.onConversationEvent(conversationId, (e) => events.push(e));
  return { events, stop };
}

const CONV = (id: string): CreateConversationParams => ({ conversationId: id }) as CreateConversationParams;

afterEach(async () => {
  await Promise.all(live.splice(0).map((p) => p.shutdown().catch(() => { /* best effort */ })));
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

// ── The generated table is the contract this provider is built on ──

describe('OpenCodeProvider — the routes it uses are the ones upstream declares', () => {
  it('the prompt route is NOT a stream, and /event is', () => {
    // The whole previous implementation rested on the opposite belief: it read
    // the prompt response body as SSE. That parser matched no frames in a JSON
    // object, so every turn returned empty content having emitted no tokens.
    expect(OPENCODE_OPERATIONS['session.prompt'].sse).toBe(false);
    expect(OPENCODE_OPERATIONS['session.prompt'].method).toBe('POST');
    expect(OPENCODE_OPERATIONS['event.subscribe'].sse).toBe(true);
    expect(OPENCODE_OPERATIONS['event.subscribe'].path).toBe('/event');
  });

  it('abort is a POST to /abort, not a DELETE of the message', () => {
    expect(OPENCODE_OPERATIONS['session.abort']).toEqual({
      method: 'POST', path: '/session/{sessionID}/abort', sse: false,
    });
  });

  it('models come from the providers route — there is no GET /model', () => {
    expect(OPENCODE_OPERATIONS['config.providers'].path).toBe('/config/providers');
    // Widened deliberately: the generated `path` is a literal union, so
    // comparing it to '/model' is a compile error precisely BECAUSE no such
    // route exists. Keeping the runtime check makes the guarantee survive an
    // upstream document that later adds one.
    const paths: string[] = Object.values(OPENCODE_OPERATIONS).map((o) => o.path);
    expect(paths).not.toContain('/model');
  });
});

// ── Lifecycle ──

describe('OpenCodeProvider — lifecycle against a real server', () => {
  it('initialize() succeeds, ping() confirms it, and the conformance suite passes', async () => {
    const p = await startedAgainstFixture();
    expect(p.getClientState()).toBe('running');
    await expect(p.ping()).resolves.toBe(true);
    await expect(runConversationLifecycleConformance(p)).resolves.toBeUndefined();
  }, 30_000);

  it('initialize() fails with a helpful error when nothing is listening', async () => {
    const p = makeProvider({ baseUrl: 'http://127.0.0.1:1' });
    await expect(p.initialize()).rejects.toThrow(/cannot reach opencode serve/i);
    expect(p.getClientState()).toBe('error');
  }, 15_000);

  it('refuses to guess an address when given neither baseUrl nor autoStart', async () => {
    // `opencode serve` binds an ephemeral port by default, so the old
    // `http://localhost:4096` default pointed at nothing on a stock install and
    // reported it as "server unreachable".
    const p = makeProvider({});
    await expect(p.initialize()).rejects.toThrow(/no `baseUrl` given/i);
  }, 15_000);

  it('declares computerUse, so the L9 capability suite passes', () => {
    const p = makeProvider({ baseUrl: 'http://127.0.0.1:1' });
    expect(p.capabilities().computerUse).toBe(false);
    expect(() => runCapabilityDeclarationConformance(p)).not.toThrow();
  });

  it('passes ALL FIVE W44 conformance suites', async () => {
    const p = await startedAgainstFixture();
    await expect(runFullConformance(p, {
      toolCall: { prompt: 'TOOL_OK please', expectedToolResult: 'file body' },
      // In band: the server ends the turn itself with no local abort.
      cancellationInBand: { prompt: 'SERVER_CANCEL now' },
      cancellationCallerAbort: {
        prompt: 'HANG forever',
        duringTurn: (h, id) => (h as OpenCodeProvider).abortConversation(id),
      },
      truncation: { prompt: 'TOOL_TRUNCATE now' },
    })).resolves.toBeUndefined();
  }, 60_000);
});

// ── Defect: the turn produced no tokens at all ──

describe('OpenCodeProvider — a turn streams tokens and returns its text', () => {
  it('emits harness.token and resolves with the assistant text', async () => {
    const p = await startedAgainstFixture();
    await p.createConversation(CONV('c-turn'));
    const { events, stop } = collect(p, 'c-turn');
    const res = await p.sendPromptAndWait('c-turn', 'say hello');
    stop();

    expect(res.content).toBe('hello ');
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('harness.token');
    expect(kinds[kinds.length - 1]).toBe('harness.idle');
  }, 30_000);

  it('derives DELTAS from cumulative part text instead of replaying the whole message', async () => {
    // `part.text` grows: the fixture sends "hel" then "hello ". Emitting the
    // field verbatim would show the user "hel" followed by "hello " — the
    // prefix twice — instead of "hel" then "lo ".
    const p = await startedAgainstFixture();
    await p.createConversation(CONV('c-delta'));
    const { events, stop } = collect(p, 'c-delta');
    await p.sendPromptAndWait('c-delta', 'say hello');
    stop();

    const tokens = events
      .filter((e): e is Extract<AgentEvent, { kind: 'harness.token' }> => e.kind === 'harness.token')
      .map((e) => e.data.text);
    expect(tokens).toEqual(['hel', 'lo ']);
    expect(tokens.join('')).toBe('hello ');
  }, 30_000);

  it('does not stream the echoed user message back as model output', async () => {
    const p = await startedAgainstFixture();
    await p.createConversation(CONV('c-echo'));
    const { events, stop } = collect(p, 'c-echo');
    await p.sendPromptAndWait('c-echo', 'UNIQUE_USER_PROMPT');
    stop();
    const streamed = events
      .filter((e): e is Extract<AgentEvent, { kind: 'harness.token' }> => e.kind === 'harness.token')
      .map((e) => e.data.text)
      .join('');
    expect(streamed).not.toContain('UNIQUE_USER_PROMPT');
  }, 30_000);
});

// ── Defect: model / system prompt were sent where they are ignored ──

describe('OpenCodeProvider — the requested model actually reaches the server', () => {
  it('sends the model on the PROMPT as {providerID, modelID}, not on session creation', async () => {
    const h = await startHarness((req, res, _body) => {
      const url = req.url ?? '';
      if (url.startsWith('/event')) { sse(res); return; }
      if (url === '/session' && req.method === 'POST') { json(res, 200, { id: 'ses_1' }); return; }
      if (url === '/session') { json(res, 200, []); return; }
      if (url === '/session/ses_1/message' && req.method === 'POST') {
        json(res, 200, { info: { finish: 'stop' }, parts: [{ type: 'text', text: 'ok' }] });
        return;
      }
      json(res, 200, {});
    });

    const p = makeProvider({ baseUrl: h.baseUrl });
    await p.initialize();
    await p.createConversation({ conversationId: 'c1', model: 'opencode/big' } as CreateConversationParams);
    await p.sendPromptAndWait('c1', 'hi');

    const create = h.requests.find((r) => r.method === 'POST' && r.url === '/session');
    // `POST /session` takes only { parentID?, title? }. Sending `model` there
    // is silently ignored, which is how the user's choice used to vanish.
    expect(create?.body).not.toHaveProperty('model');
    expect(create?.body).not.toHaveProperty('systemPrompt');

    const prompt = h.requests.find((r) => r.method === 'POST' && r.url.endsWith('/message'));
    expect((prompt?.body as { model?: unknown }).model).toEqual({ providerID: 'opencode', modelID: 'big' });
  }, 20_000);

  it('sends the system prompt on the prompt, as `system`', async () => {
    const h = await startHarness((req, res) => {
      const url = req.url ?? '';
      if (url.startsWith('/event')) { sse(res); return; }
      if (url === '/session' && req.method === 'POST') { json(res, 200, { id: 'ses_1' }); return; }
      if (url === '/session') { json(res, 200, []); return; }
      json(res, 200, { info: { finish: 'stop' }, parts: [] });
    });
    const p = makeProvider({ baseUrl: h.baseUrl });
    await p.initialize();
    await p.createConversation({
      conversationId: 'c1',
      systemMessage: { mode: 'append', content: 'BE TERSE' },
    } as CreateConversationParams);
    await p.sendPromptAndWait('c1', 'hi');

    const prompt = h.requests.find((r) => r.method === 'POST' && r.url.endsWith('/message'));
    expect((prompt?.body as { system?: string }).system).toBe('BE TERSE');
  }, 20_000);

  it('warns rather than silently dropping an unqualified model id', async () => {
    const p = await startedAgainstFixture({ defaultProviderId: undefined });
    await p.createConversation({ conversationId: 'c-warn', model: 'bare-model' } as CreateConversationParams);
    const warnings = p.getConversationWarnings('c-warn');
    expect(warnings.map((w) => w.code)).toContain('FIELD_COERCED');
  }, 30_000);
});

// ── Defect: getModels() / listAgents() called routes that do not exist ──

describe('OpenCodeProvider — discovery uses the real routes', () => {
  it('lists models from /config/providers, qualified and with context limits', async () => {
    const p = await startedAgainstFixture();
    await expect(p.getModels()).resolves.toEqual([
      {
        id: 'opencode/big',
        name: 'Big Model',
        provider: 'opencode',
        supportsReasoning: true,
        promptTokenLimit: 200000,
        totalContextWindow: 208192,
      },
    ]);
  }, 30_000);

  it('lists agents from /agent instead of returning nothing', async () => {
    const p = await startedAgainstFixture();
    const agents = await p.listAgents('anything');
    expect(agents.map((a) => a.name)).toEqual(['build', 'plan']);
    expect(agents[0]?.model).toBe('opencode/big');
  }, 30_000);

  it('reads message history instead of returning an empty array', async () => {
    const p = await startedAgainstFixture();
    await p.createConversation(CONV('c-hist'));
    await expect(p.getMessages('c-hist')).resolves.toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello ' },
    ]);
  }, 30_000);
});

// ── Cancellation ──

describe('OpenCodeProvider — abort settles the turn and frees the conversation', () => {
  it('abortConversation() resolves the in-flight turn and the conversation stays usable', async () => {
    const p = await startedAgainstFixture();
    await p.createConversation(CONV('c-abort'));
    const { events, stop } = collect(p, 'c-abort');

    const turn = p.sendPromptAndWait('c-abort', 'HANG forever');
    await new Promise((r) => setTimeout(r, 200));
    await p.abortConversation('c-abort');

    await expect(turn).resolves.toBeDefined();
    stop();
    expect(events.map((e) => e.kind)).toContain('harness.cancelled');

    // The wedge: a conversation left `inFlight` rejects every later send.
    await expect(p.sendPromptAndWait('c-abort', 'still working?')).resolves.toMatchObject({ content: 'hello ' });
  }, 30_000);

  it('an externally-signalled abort settles the turn and emits harness.cancelled', async () => {
    const p = await startedAgainstFixture();
    await p.createConversation(CONV('c-signal'));
    const { events, stop } = collect(p, 'c-signal');
    const ac = new AbortController();
    const turn = p.sendPromptAndWait('c-signal', 'HANG forever', undefined, ac.signal);
    await new Promise((r) => setTimeout(r, 200));
    ac.abort();
    await expect(turn).resolves.toBeDefined();
    stop();
    expect(events.map((e) => e.kind)).toContain('harness.cancelled');
  }, 30_000);

  it('a pre-aborted signal cancels without starting a turn', async () => {
    const p = await startedAgainstFixture();
    await p.createConversation(CONV('c-pre'));
    const { events, stop } = collect(p, 'c-pre');
    await expect(
      p.sendPromptAndWait('c-pre', 'hi', undefined, AbortSignal.abort()),
    ).resolves.toEqual({ content: '' });
    stop();
    expect(events.map((e) => e.kind)).toEqual(['harness.cancelled']);
  }, 30_000);
});

// ── Defect: one abort listener leaked per turn on a reused signal ──

describe('OpenCodeProvider — abort listeners do not accumulate on a reused signal', () => {
  it('removes exactly as many listeners as it adds', async () => {
    const p = await startedAgainstFixture();
    await p.createConversation(CONV('c-leak'));

    const ac = new AbortController();
    let added = 0;
    let removed = 0;
    const realAdd = ac.signal.addEventListener.bind(ac.signal);
    const realRemove = ac.signal.removeEventListener.bind(ac.signal);
    ac.signal.addEventListener = ((...args: Parameters<typeof realAdd>) => {
      if (args[0] === 'abort') added++;
      return realAdd(...args);
    }) as typeof realAdd;
    ac.signal.removeEventListener = ((...args: Parameters<typeof realRemove>) => {
      if (args[0] === 'abort') removed++;
      return realRemove(...args);
    }) as typeof realRemove;

    for (let i = 0; i < 5; i++) {
      await p.sendPromptAndWait('c-leak', 'hello', undefined, ac.signal);
    }
    expect(added).toBe(5);
    expect(removed).toBe(5);
  }, 40_000);
});

// ── Bounded calls ──

describe('OpenCodeProvider — every HTTP call is bounded', () => {
  it('initialize() gives up on a server that accepts and never answers', async () => {
    const h = await startHarness(() => { /* accept, never respond */ });
    const p = makeProvider({ baseUrl: h.baseUrl, requestTimeoutMs: 250 });
    await expect(p.initialize()).rejects.toThrow(/cannot reach/i);
  }, 20_000);

  it('abandons a stream that goes quiet, rather than waiting forever', async () => {
    const h = await startHarness((req, res) => {
      const url = req.url ?? '';
      if (url.startsWith('/event')) { sse(res); return; } // opens, then silence
      if (url === '/session') { json(res, 200, []); return; }
      json(res, 200, {});
    });
    const p = makeProvider({ baseUrl: h.baseUrl, sseTimeoutMs: 200 });
    await p.initialize();

    const errors: string[] = [];
    p.onClientEvent((e) => { if (e.type === 'client.error') errors.push(String(e.data?.message ?? '')); });
    await new Promise((r) => setTimeout(r, 600));
    expect(errors.join(' ')).toMatch(/no SSE frame|stream lost/i);
  }, 20_000);
});

// ── Authorization ──

describe('OpenCodeProvider — Authorization carries a scheme', () => {
  async function captureAuth(authToken: string): Promise<string | undefined> {
    const h = await startHarness((req, res) => {
      const url = req.url ?? '';
      if (url.startsWith('/event')) { sse(res); return; }
      json(res, 200, []);
    });
    const p = makeProvider({ baseUrl: h.baseUrl, authToken });
    await p.initialize();
    return h.requests[0]?.headers.authorization;
  }

  it('prefixes a bare token with Bearer', async () => {
    await expect(captureAuth('secret-token')).resolves.toBe('Bearer secret-token');
  }, 20_000);

  it('leaves a token that already names its scheme untouched', async () => {
    await expect(captureAuth('Basic abc123')).resolves.toBe('Basic abc123');
  }, 20_000);
});

// ── W13-B1 truncation guard ──

describe('OpenCodeProvider — W13-B1 truncation guard fails only OPEN tool calls', () => {
  it('does not re-report an already-completed tool call as failed', async () => {
    const p = await startedAgainstFixture();
    await p.createConversation(CONV('c-trunc'));
    const { events, stop } = collect(p, 'c-trunc');
    await p.sendPromptAndWait('c-trunc', 'TOOL_TRUNCATE now');
    stop();

    const completions = events.filter(
      (e): e is Extract<AgentEvent, { kind: 'harness.tool_complete' }> => e.kind === 'harness.tool_complete',
    );
    const byCall = new Map(completions.map((e) => [e.data.callId, e]));
    // `call_done` genuinely succeeded before the truncation.
    expect(byCall.get('call_done')?.data.success).toBe(true);
    expect(completions.filter((e) => e.data.callId === 'call_done')).toHaveLength(1);
    // `call_open` never got a result — it is the one the guard must fail.
    expect(byCall.get('call_open')?.data.success).toBe(false);
    expect(String(byCall.get('call_open')?.data.result)).toMatch(/truncated/i);
  }, 30_000);

  it('reports a normal tool call as a success', async () => {
    const p = await startedAgainstFixture();
    await p.createConversation(CONV('c-tool'));
    const { events, stop } = collect(p, 'c-tool');
    await p.sendPromptAndWait('c-tool', 'TOOL_OK please');
    stop();
    const kinds = events.map((e) => e.kind);
    expect(kinds.indexOf('harness.tool_start')).toBeGreaterThanOrEqual(0);
    expect(kinds.indexOf('harness.tool_complete')).toBeGreaterThan(kinds.indexOf('harness.tool_start'));
    const complete = events.find(
      (e): e is Extract<AgentEvent, { kind: 'harness.tool_complete' }> => e.kind === 'harness.tool_complete',
    );
    expect(complete?.data.success).toBe(true);
    expect(complete?.data.result).toBe('file body');
  }, 30_000);
});

// ── Fire-and-forget ──

describe('OpenCodeProvider — sendPrompt() never produces an unhandled rejection', () => {
  it('reports an unknown conversation as a caught failure, not a crash', async () => {
    const p = await startedAgainstFixture();
    const rejections: unknown[] = [];
    const onRejection = (e: unknown): void => { rejections.push(e); };
    process.on('unhandledRejection', onRejection);
    try {
      await p.sendPrompt('conversation-that-does-not-exist', 'hi');
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      process.off('unhandledRejection', onRejection);
    }
    expect(rejections).toEqual([]);
  }, 30_000);

  it('broadcasts harness.error when a fire-and-forget turn fails', async () => {
    const p = await startedAgainstFixture();
    await p.createConversation(CONV('c-fnf'));
    const { events, stop } = collect(p, 'c-fnf');
    await p.sendPrompt('c-fnf', 'ERROR please');
    await new Promise((r) => setTimeout(r, 500));
    stop();
    expect(events.map((e) => e.kind)).toContain('harness.error');
  }, 30_000);
});

// ── autoStart ──

describe('OpenCodeProvider — autoStart starts a server and finds its port', () => {
  it('spawns the configured binary and discovers the ephemeral port it bound', async () => {
    // `--port 0` means the OS chooses. The address is only knowable by reading
    // the server's own announcement, which is why the old fixed-port default
    // could never have worked.
    const p = await startedAgainstFixture();
    await expect(p.ping()).resolves.toBe(true);
  }, 30_000);

  it("reports the spawned server's own failure rather than a blank timeout", async () => {
    const p = makeProvider({
      autoStart: true,
      binaryPath: process.execPath,
      serveArgs: [SERVE_FIXTURE, 'serve', '--port', '0'],
      env: { FAKE_OPENCODE_EXIT: '1' },
      startupTimeoutMs: 5_000,
    });
    await expect(p.initialize()).rejects.toThrow(/exited with code 3|address already in use/i);
  }, 20_000);

  it('reports ENOENT helpfully when the configured binary does not exist', async () => {
    const p = makeProvider({
      autoStart: true,
      binaryPath: 'generatorai-opencode-binary-that-does-not-exist-xyz',
      serveArgs: ['serve'],
      startupTimeoutMs: 5_000,
    });
    await expect(p.initialize()).rejects.toThrow(/not found/i);
  }, 20_000);

  it('gives up when the server never announces an address', async () => {
    const p = makeProvider({
      autoStart: true,
      binaryPath: process.execPath,
      serveArgs: [SERVE_FIXTURE, 'serve', '--port', '0'],
      env: { FAKE_OPENCODE_NO_ANNOUNCE: '1' },
      startupTimeoutMs: 800,
    });
    await expect(p.initialize()).rejects.toThrow(/did not announce a listening address/i);
  }, 20_000);
});

// ── W12: session id round-trip ──

describe('OpenCodeProvider — exposes and resumes its session id', () => {
  it('getProviderSessionId() returns the id the server issued', async () => {
    const p = await startedAgainstFixture();
    await p.createConversation(CONV('c-sid'));
    expect(p.getProviderSessionId('c-sid')).toMatch(/^ses_/);
  }, 30_000);

  it('rejoins an existing session via resumeProviderSessionId', async () => {
    const p = await startedAgainstFixture();
    await p.createConversation(CONV('c-first'));
    const sessionId = p.getProviderSessionId('c-first')!;

    await p.createConversation({
      conversationId: 'c-second',
      resumeProviderSessionId: sessionId,
    } as CreateConversationParams);
    expect(p.getProviderSessionId('c-second')).toBe(sessionId);
  }, 30_000);

  it('refuses to resume a session the server does not have', async () => {
    // Silently starting a fresh session here is how a recycle loses the whole
    // conversation without anyone noticing.
    const p = await startedAgainstFixture();
    await expect(p.createConversation({
      conversationId: 'c-ghost',
      resumeProviderSessionId: 'ses_does_not_exist',
    } as CreateConversationParams)).rejects.toThrow(/cannot resume session/i);
  }, 30_000);
});
