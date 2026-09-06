// ────────────────────────────────────────────────────────────────
// AcpProvider — regression tests
// ────────────────────────────────────────────────────────────────
//
// W39 — first-ever test coverage for this file. Every test here spawns a
// REAL child process speaking REAL ACP (JSON-RPC 2.0 over stdio, via
// `@agentclientprotocol/sdk`) using `fixtures/fakeAcpAgent.mjs` — not a
// mocked transport — so a regression in the wire protocol itself (message
// framing, method names, capability negotiation) fails these tests, not
// just a mock's assumptions about them.

import { describe, expect, it, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AcpProvider } from '../AcpProvider.js';
import { runCapabilityDeclarationConformance, runFullConformance } from '../../../conformance/index.js';
import type { AgentEvent } from '@generatorai/shared';
import type { CreateConversationParams, PermissionResponse } from '@generatorai/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_AGENT = join(__dirname, 'fixtures', 'fakeAcpAgent.mjs');

function collect(provider: AcpProvider, conversationId: string): { events: AgentEvent[]; stop: () => void } {
  const events: AgentEvent[] = [];
  const stop = provider.onConversationEvent(conversationId, (e) => events.push(e));
  return { events, stop };
}

describe('AcpProvider (real JSON-RPC-over-stdio ACP)', () => {
  const liveProviders: AcpProvider[] = [];

  function makeProvider(opts: ConstructorParameters<typeof AcpProvider>[0] = { command: process.execPath, args: [FIXTURE_AGENT] }): AcpProvider {
    const p = new AcpProvider(opts);
    liveProviders.push(p);
    return p;
  }

  afterEach(async () => {
    await Promise.all(liveProviders.splice(0).map((p) => p.shutdown().catch(() => { /* best effort */ })));
  });

  it('spawns the agent, negotiates the real ACP protocol version, and reaches "running"', async () => {
    const provider = makeProvider();
    expect(provider.getClientState()).toBe('starting');
    await provider.initialize();
    expect(provider.getClientState()).toBe('running');
    await expect(provider.ping()).resolves.toBe(true);
  }, 10_000);

  it('fails initialize() with a helpful error when the binary does not exist (ENOENT)', async () => {
    const provider = makeProvider({ command: 'generatorai-acp-binary-that-does-not-exist-xyz' });
    await expect(provider.initialize()).rejects.toThrow(/not found/i);
    expect(provider.getClientState()).toBe('error');
  }, 10_000);

  it('declares capabilities honestly, including computerUse (L9/L16)', async () => {
    const provider = makeProvider();
    await provider.initialize();
    const caps = provider.capabilities();
    expect(caps.computerUse).toBe(false);
    expect(caps.fullToolGating).toBe(false); // tierB default true → fullToolGating false
    expect(() => runCapabilityDeclarationConformance(provider)).not.toThrow();
  }, 10_000);

  it('streams a real turn end-to-end: tokens, then harness.idle, then the final content', async () => {
    const provider = makeProvider();
    await provider.initialize();
    const id = 'conv-basic';
    await provider.createConversation({ conversationId: id } as CreateConversationParams);
    expect(provider.hasLiveConversation(id)).toBe(true);
    expect(provider.getConversationWarnings(id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'FIELD_UNSUPPORTED_BY_PROVIDER' })]),
    );

    const { events, stop } = collect(provider, id);
    const response = await provider.sendPromptAndWait(id, 'hello, agent');
    stop();

    expect(response.content).toContain('Hello from fake agent.');
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('harness.token');
    expect(kinds[kinds.length - 1]).toBe('harness.idle');
  }, 10_000);

  it('L16 Tier-B gate denies an "execute" tool call before the agent ever sees an approval', async () => {
    const provider = makeProvider(); // tierB defaults true
    await provider.initialize();
    const id = 'conv-tierb-blocked';
    await provider.createConversation({ conversationId: id } as CreateConversationParams);

    const { events, stop } = collect(provider, id);
    await provider.sendPromptAndWait(id, 'please TOOL:execute this');
    stop();

    const toolStart = events.find((e) => e.kind === 'harness.tool_start');
    expect(toolStart).toBeDefined();
    const completions = events.filter(
      (e): e is Extract<AgentEvent, { kind: 'harness.tool_complete' }> => e.kind === 'harness.tool_complete',
    );
    expect(completions.length).toBeGreaterThan(0);
    // Every completion for the blocked call must be a failure — a Tier-B
    // agent must never see one of its execute calls reported as succeeded.
    expect(completions.every((e) => e.data.success === false)).toBe(true);
  }, 10_000);

  it('default-approves a non-blocked ("read") tool call when no domain callback is wired', async () => {
    const provider = makeProvider();
    await provider.initialize();
    const id = 'conv-tierb-allowed';
    await provider.createConversation({ conversationId: id } as CreateConversationParams);

    const { events, stop } = collect(provider, id);
    await provider.sendPromptAndWait(id, 'please TOOL:read this');
    stop();

    const completions = events.filter(
      (e): e is Extract<AgentEvent, { kind: 'harness.tool_complete' }> => e.kind === 'harness.tool_complete',
    );
    expect(completions.length).toBeGreaterThan(0);
    expect(completions.some((e) => e.data.success === true)).toBe(true);
  }, 10_000);

  it('honours a wired onPermissionRequest callback that denies a non-blocked tool call', async () => {
    const provider = makeProvider({ command: process.execPath, args: [FIXTURE_AGENT], tierB: false });
    await provider.initialize();
    const id = 'conv-domain-deny';
    const decisions: string[] = [];
    const onPermissionRequest = async (): Promise<PermissionResponse> => {
      decisions.push('called');
      return { granted: false, reason: 'test denies everything' };
    };
    await provider.createConversation({ conversationId: id, onPermissionRequest } as CreateConversationParams);

    const { events, stop } = collect(provider, id);
    await provider.sendPromptAndWait(id, 'please TOOL:read this');
    stop();

    expect(decisions).toEqual(['called']);
    const completions = events.filter(
      (e): e is Extract<AgentEvent, { kind: 'harness.tool_complete' }> => e.kind === 'harness.tool_complete',
    );
    expect(completions.every((e) => e.data.success === false)).toBe(true);
  }, 10_000);

  it('W13: abortConversation() emits harness.cancelled and resolves the turn instead of throwing', async () => {
    const provider = makeProvider();
    await provider.initialize();
    const id = 'conv-cancel';
    await provider.createConversation({ conversationId: id } as CreateConversationParams);

    const { events, stop } = collect(provider, id);
    const turnPromise = provider.sendPromptAndWait(id, 'CANCEL_ME please');
    // Let the fake agent reach its "waiting to be cancelled" state.
    await new Promise((r) => setTimeout(r, 100));
    await provider.abortConversation(id);

    await expect(turnPromise).resolves.toBeDefined();
    stop();

    expect(events.map((e) => e.kind)).toContain('harness.cancelled');
  }, 10_000);

  it('deleteConversation() disposes the session and shutdown() ends the process', async () => {
    const provider = makeProvider();
    await provider.initialize();
    const id = 'conv-lifecycle';
    await provider.createConversation({ conversationId: id } as CreateConversationParams);
    expect(provider.hasLiveConversation(id)).toBe(true);
    await provider.deleteConversation(id);
    expect(provider.hasLiveConversation(id)).toBe(false);
    await provider.shutdown();
    expect(provider.getClientState()).toBe('stopped');
  }, 10_000);

  it('passes ALL FIVE W44 conformance suites', async () => {
    // Only `runCapabilityDeclarationConformance` was ever pointed at this
    // provider; the other three were typed `(faux: FauxProvider)`.
    // `tierB: false` so the tool-call suite's `read` is approved by the
    // trusted-agent path rather than the host gate — the gate has its own
    // suite below.
    const p = makeProvider({ command: process.execPath, args: [FIXTURE_AGENT], tierB: false });
    await p.initialize();
    await expect(runFullConformance(p, {
      toolCall: { prompt: 'please TOOL:read this' },
      cancellationInBand: { prompt: 'SERVER_CANCEL now' },
      cancellationCallerAbort: {
        prompt: 'CANCEL_ME please',
        duringTurn: (harness, id) => (harness as AcpProvider).abortConversation(id),
      },
      // ACP's `StopReason` includes `max_tokens`. Running this suite is what
      // revealed that AcpProvider had no W13-B1 guard for it at all: a turn
      // truncated mid-tool-call emitted `harness.idle` and left the call
      // dangling, so the agent waited forever for a result that never came.
      truncation: { prompt: 'please TRUNCATE this' },
    })).resolves.toBeUndefined();
  }, 30_000);
});

// ── L16: the Tier-B gate is a fail-CLOSED allowlist ──

describe('AcpProvider — L16 Tier-B gate is an opt-in allowlist, denied by default', () => {
  const liveProviders: AcpProvider[] = [];
  afterEach(async () => {
    await Promise.all(liveProviders.splice(0).map((p) => p.shutdown().catch(() => { /* best effort */ })));
  });
  function provider(opts: Partial<ConstructorParameters<typeof AcpProvider>[0]> = {}): AcpProvider {
    const p = new AcpProvider({ command: process.execPath, args: [FIXTURE_AGENT], ...opts });
    liveProviders.push(p);
    return p;
  }

  /** Run one `TOOL:<kind>` turn and report whether the call was approved. */
  async function runToolKind(p: AcpProvider, id: string, prompt: string): Promise<boolean> {
    await p.createConversation({ conversationId: id } as CreateConversationParams);
    const { events, stop } = collect(p, id);
    await p.sendPromptAndWait(id, prompt);
    stop();
    const completions = events.filter(
      (e): e is Extract<AgentEvent, { kind: 'harness.tool_complete' }> => e.kind === 'harness.tool_complete',
    );
    expect(completions.length).toBeGreaterThan(0);
    return completions.every((e) => e.data.success === true);
  }

  // The old gate was a substring DENYLIST over 'computer-use'/'screen'/'mouse'/
  // 'keyboard-input'. Everything it did not name fell through to
  // default-approve — so an untrusted agent could delete files unattended.
  it.each(['edit', 'delete', 'move', 'fetch', 'execute', 'switch_mode', 'other'])(
    'denies kind "%s" for a Tier-B agent',
    async (kind) => {
      const p = provider();
      await p.initialize();
      await expect(runToolKind(p, `deny-${kind}`, `please TOOL:${kind} this`)).resolves.toBe(false);
    },
    15_000,
  );

  it.each(['read', 'search', 'think'])('allows kind "%s" for a Tier-B agent', async (kind) => {
    const p = provider();
    await p.initialize();
    await expect(runToolKind(p, `allow-${kind}`, `please TOOL:${kind} this`)).resolves.toBe(true);
  }, 15_000);

  it('ignores the model-controlled title entirely — a benign title cannot launder a delete', async () => {
    // Under the old denylist an agent got its call approved by simply not
    // putting a blocked keyword in the title it wrote itself.
    const p = provider();
    await p.initialize();
    await expect(runToolKind(p, 'deny-laundered', 'please TOOL:delete TITLE:ReadTheDocs this'))
      .resolves.toBe(false);
  }, 15_000);

  it('and a scary title cannot block an allowed kind either — kind is the only input', async () => {
    const p = provider();
    await p.initialize();
    await expect(runToolKind(p, 'allow-scary-title', 'please TOOL:read TITLE:computer-use-mouse-screen this'))
      .resolves.toBe(true);
  }, 15_000);

  it('a non-Tier-B agent is not subject to the allowlist', async () => {
    const p = provider({ tierB: false });
    await p.initialize();
    await expect(runToolKind(p, 'trusted-edit', 'please TOOL:edit this')).resolves.toBe(true);
  }, 15_000);
});

// ── The permission gate cannot fail open ──

describe('AcpProvider — the permission gate denies on error and on timeout', () => {
  const liveProviders: AcpProvider[] = [];
  afterEach(async () => {
    await Promise.all(liveProviders.splice(0).map((p) => p.shutdown().catch(() => { /* best effort */ })));
  });
  function provider(opts: Partial<ConstructorParameters<typeof AcpProvider>[0]> = {}): AcpProvider {
    const p = new AcpProvider({ command: process.execPath, args: [FIXTURE_AGENT], tierB: false, ...opts });
    liveProviders.push(p);
    return p;
  }

  async function toolApproved(p: AcpProvider, id: string, params: Partial<CreateConversationParams>): Promise<boolean> {
    await p.createConversation({ conversationId: id, ...params } as CreateConversationParams);
    const { events, stop } = collect(p, id);
    await p.sendPromptAndWait(id, 'please TOOL:read this');
    stop();
    const completions = events.filter(
      (e): e is Extract<AgentEvent, { kind: 'harness.tool_complete' }> => e.kind === 'harness.tool_complete',
    );
    expect(completions.length).toBeGreaterThan(0);
    return completions.every((e) => e.data.success === true);
  }

  it('DENIES when the domain callback throws (a throw used to escape as -32603, which grants nothing but denies nothing either)', async () => {
    const p = provider();
    await p.initialize();
    const approved = await toolApproved(p, 'gate-throws', {
      onPermissionRequest: async (): Promise<PermissionResponse> => {
        throw new Error('permission service unavailable');
      },
    });
    expect(approved).toBe(false);
    // …and the turn still completes rather than wedging on an errored request.
    expect(p.getClientState()).toBe('running');
  }, 15_000);

  it('DENIES when the domain callback never answers, after permissionTimeoutMs', async () => {
    const p = provider({ permissionTimeoutMs: 300 });
    await p.initialize();
    const approved = await toolApproved(p, 'gate-hangs', {
      onPermissionRequest: () => new Promise<PermissionResponse>(() => { /* never settles */ }),
    });
    expect(approved).toBe(false);
  }, 15_000);
});

// ── Lifecycle correctness ──

describe('AcpProvider — lifecycle hardening', () => {
  const liveProviders: AcpProvider[] = [];
  afterEach(async () => {
    await Promise.all(liveProviders.splice(0).map((p) => p.shutdown().catch(() => { /* best effort */ })));
  });
  function provider(opts: Partial<ConstructorParameters<typeof AcpProvider>[0]> = {}): AcpProvider {
    const p = new AcpProvider({ command: process.execPath, args: [FIXTURE_AGENT], ...opts });
    liveProviders.push(p);
    return p;
  }

  it('a clean SIGTERM shutdown does not report client.error', async () => {
    const p = provider();
    const clientEvents: string[] = [];
    p.onClientEvent((e) => clientEvents.push(e.type));
    await p.initialize();
    await p.shutdown();
    // `kill('SIGTERM')` gives `code === null`; the old handler read that as
    // "not 0" and flipped the state straight back to 'error'.
    await new Promise((r) => setTimeout(r, 300));
    expect(p.getClientState()).toBe('stopped');
    expect(clientEvents).not.toContain('client.error');
  }, 15_000);

  it('initialize() times out on an agent that never answers the handshake, and tears the child down', async () => {
    const p = provider({ env: { FAKE_ACP_NO_INIT: '1' }, requestTimeoutMs: 400 });
    await expect(p.initialize()).rejects.toThrow(/timed out/i);
    expect(p.getClientState()).toBe('error');
    // A failed handshake used to leave `connection` and `proc` non-null with
    // listeners attached, so the provider looked half-alive.
    await expect(p.ping()).resolves.toBe(false);
  }, 15_000);

  it('createConversation() times out on an agent that never answers session/new, and warns instead of hanging', async () => {
    // Long enough that the (answered) handshake completes, short enough that
    // the (unanswered) session/new deadline fires inside the test budget.
    const p = provider({ env: { FAKE_ACP_NO_SESSION_NEW: '1' }, requestTimeoutMs: 3_000 });
    await p.initialize();
    await p.createConversation({ conversationId: 'no-session' } as CreateConversationParams);
    expect(p.hasLiveConversation('no-session')).toBe(false);
    expect(JSON.stringify(p.getConversationWarnings('no-session'))).toMatch(/timed out/i);
  }, 15_000);

  it('a pre-aborted signal cancels without ever prompting the agent', async () => {
    const p = provider();
    await p.initialize();
    await p.createConversation({ conversationId: 'pre-abort' } as CreateConversationParams);
    const { events, stop } = collect(p, 'pre-abort');
    const res = await p.sendPromptAndWait('pre-abort', 'hello', undefined, AbortSignal.abort());
    stop();
    expect(res).toEqual({ content: '' });
    // The agent's greeting would be here if the prompt had actually been sent.
    expect(events.map((e) => e.kind)).toEqual(['harness.cancelled']);
  }, 15_000);

  it('sendPrompt() reports failure as harness.error rather than an unhandled rejection', async () => {
    const p = provider();
    await p.initialize();
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
  }, 15_000);
});

// ── The chat's mounts must reach `session/new` ──
//
// ACP models extra workspace roots natively
// (`NewSessionRequest.additionalDirectories`, exposed by the SDK as
// `SessionBuilder.withAdditionalDirectories`), but `buildSession(cwd)` sends
// only the cwd — so the field was silently dropped. The fixture echoes the
// `session/new` request it received, so these assert the wire.

describe('AcpProvider — session/new carries the chat workspace', () => {
  const liveProviders: AcpProvider[] = [];
  afterEach(async () => {
    await Promise.all(liveProviders.splice(0).map((p) => p.shutdown().catch(() => { /* best effort */ })));
  });

  async function newSessionRequest(
    params: Partial<CreateConversationParams>,
    opts: Partial<ConstructorParameters<typeof AcpProvider>[0]> = {},
  ): Promise<Record<string, unknown>> {
    const p = new AcpProvider({ command: process.execPath, args: [FIXTURE_AGENT], ...opts });
    liveProviders.push(p);
    await p.initialize();
    const id = String(params.conversationId ?? 'conv-echo');
    await p.createConversation({ conversationId: id, ...params } as CreateConversationParams);
    const { content } = await p.sendPromptAndWait(id, 'ECHO_SESSION');
    return JSON.parse(content) as Record<string, unknown>;
  }

  it('sends additionalDirectories alongside cwd', async () => {
    const req = await newSessionRequest({
      conversationId: 'conv-dirs',
      workingDirectory: '/work/repo',
      additionalDirectories: ['/work/docs', '/work/.generatorai/scratch'],
    });

    expect(req['cwd']).toBe('/work/repo');
    expect(req['additionalDirectories']).toEqual(['/work/docs', '/work/.generatorai/scratch']);
  }, 15_000);

  it('de-duplicates the roots and omits the field entirely when there are none', async () => {
    const dupes = await newSessionRequest({
      conversationId: 'conv-dupes',
      workingDirectory: '/work/repo',
      additionalDirectories: ['/work/docs', '/work/docs'],
    });
    expect(dupes['additionalDirectories']).toEqual(['/work/docs']);

    const none = await newSessionRequest({ conversationId: 'conv-none', workingDirectory: '/work/repo' });
    expect(none['additionalDirectories']).toBeUndefined();
  }, 20_000);
});
