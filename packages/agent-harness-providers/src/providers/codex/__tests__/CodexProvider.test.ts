// ────────────────────────────────────────────────────────────────
// CodexProvider — regression tests
// ────────────────────────────────────────────────────────────────
//
// Every test spawns a REAL child process speaking the REAL newline-delimited
// JSON-RPC 2.0 protocol (`fixtures/fakeCodexAppServer.mjs`), so message framing,
// id correlation, error-response handling and process teardown are all exercised
// over a real pipe rather than against a mock's assumptions.
//
// The fixture's method names come from `protocol/codex.generated.ts` — the schema
// the real `codex app-server` emits. Both this suite and the provider used to
// agree on an invented `session.create` / `turn` / `turn.steer` vocabulary that
// upstream has never spoken, so the tests passed while the integration could not
// have worked against a real binary.
//
// Each `describe` below names the defect it pins.

import { describe, expect, it, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CodexProvider, CodexRpcError, CodexRateLimitedError } from '../CodexProvider.js';
import {
  runCapabilityDeclarationConformance,
  runConversationLifecycleConformance,
  runFullConformance,
} from '../../../conformance/index.js';
import type { AgentEvent } from '@generatorai/shared';
import type { CreateConversationParams } from '@generatorai/core';
import type { CodexProviderOptions } from '../../../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, 'fixtures', 'fakeCodexAppServer.mjs');

const live: CodexProvider[] = [];

function makeProvider(overrides: Partial<CodexProviderOptions> = {}): CodexProvider {
  const p = new CodexProvider({
    binaryPath: process.execPath,
    args: [FIXTURE],
    rpcTimeoutMs: 2_000,
    shutdownGraceMs: 500,
    ...overrides,
  });
  live.push(p);
  return p;
}

async function started(overrides: Partial<CodexProviderOptions> = {}): Promise<CodexProvider> {
  const p = makeProvider(overrides);
  await p.initialize();
  return p;
}

function collect(provider: CodexProvider, conversationId: string): { events: AgentEvent[]; stop: () => void } {
  const events: AgentEvent[] = [];
  const stop = provider.onConversationEvent(conversationId, (e) => events.push(e));
  return { events, stop };
}

const CONV = (id: string): CreateConversationParams => ({ conversationId: id }) as CreateConversationParams;

afterEach(async () => {
  await Promise.all(live.splice(0).map((p) => p.shutdown().catch(() => { /* best effort */ })));
});

// ── Baseline: the fixture really is a working codex app-server ──

describe('CodexProvider — lifecycle over a real JSON-RPC child process', () => {
  it('spawns, reaches "running", and answers ping', async () => {
    const p = makeProvider();
    expect(p.getClientState()).toBe('starting');
    await p.initialize();
    expect(p.getClientState()).toBe('running');
    await expect(p.ping()).resolves.toBe(true);
  }, 15_000);

  it('rejects initialize() with a helpful error when the binary is missing (ENOENT)', async () => {
    const p = makeProvider({ binaryPath: 'generatorai-codex-binary-that-does-not-exist-xyz', args: [] });
    await expect(p.initialize()).rejects.toThrow(/not found/i);
    expect(p.getClientState()).toBe('error');
  }, 15_000);

  it('lists models from the paginated model/list', async () => {
    const p = await started();
    await expect(p.getModels()).resolves.toEqual([
      {
        id: 'gpt-5-codex',
        name: 'GPT-5 Codex',
        provider: 'codex',
        description: 'Fixture model',
        supportsReasoning: false,
      },
    ]);
  }, 15_000);

  it('streams a turn end-to-end: tokens, harness.idle, final content', async () => {
    const p = await started();
    await p.createConversation(CONV('c1'));
    const { events, stop } = collect(p, 'c1');
    const res = await p.sendPromptAndWait('c1', 'say hello');
    stop();
    expect(res.content).toBe('hello ');
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('harness.token');
    expect(kinds[kinds.length - 1]).toBe('harness.idle');
  }, 15_000);

  it('passes the conversation-lifecycle conformance suite', async () => {
    const p = await started();
    await expect(runConversationLifecycleConformance(p)).resolves.toBeUndefined();
  }, 15_000);

  it('declares computerUse, so the L9 capability suite passes (it threw before)', async () => {
    const p = makeProvider();
    expect(p.capabilities().computerUse).toBe(false);
    expect(() => runCapabilityDeclarationConformance(p)).not.toThrow();
  });

  it('passes ALL FIVE W44 conformance suites', async () => {
    // Before this, `runCapabilityDeclarationConformance` THREW against this
    // provider (no `computerUse`), and the other three suites were typed
    // `(faux: FauxProvider)` so they could not be pointed at it at all.
    const p = await started();
    await expect(runFullConformance(p, {
      toolCall: { prompt: 'TOOL_OK please', expectedToolResult: 'file body' },
      // In band: the server ends the turn as cancelled with no local abort.
      cancellationInBand: { prompt: 'SERVER_CANCEL now' },
      cancellationCallerAbort: {
        prompt: 'HANG forever',
        duringTurn: (h, id) => (h as CodexProvider).abortConversation(id),
      },
      truncation: { prompt: 'TOOL_TRUNCATE now' },
    })).resolves.toBeUndefined();
  }, 30_000);
});

// ── Defect: abort permanently wedged the conversation ──

describe('CodexProvider — abort must settle the turn, not just announce it', () => {
  it('abortConversation() resolves the in-flight turn and the conversation stays usable', async () => {
    const p = await started();
    await p.createConversation(CONV('c-abort'));
    const { events, stop } = collect(p, 'c-abort');

    const turn = p.sendPromptAndWait('c-abort', 'HANG forever');
    await new Promise((r) => setTimeout(r, 120));
    await p.abortConversation('c-abort');

    // Before the fix this promise never settled: `abortConversation` broadcast
    // `harness.cancelled` and fired a cancel but nothing resolved `doTurn`, and
    // `inFlight` is only cleared once it settles.
    await expect(turn).resolves.toBeDefined();
    stop();
    expect(events.map((e) => e.kind)).toContain('harness.cancelled');

    // The wedge: every subsequent send used to throw "already has a turn in
    // flight" for the lifetime of the process.
    await expect(p.sendPromptAndWait('c-abort', 'still working?')).resolves.toMatchObject({ content: 'hello ' });
  }, 20_000);

  it('settles even when the binary ignores turn/interrupt entirely', async () => {
    // The fix must not depend on the child cooperating: a Stop is a local
    // decision, and a wedged child must not be able to hold it hostage.
    const p = await started({ env: { FAKE_CODEX_IGNORE_INTERRUPT: '1' } });
    await p.createConversation(CONV('c-deaf'));
    const turn = p.sendPromptAndWait('c-deaf', 'HANG forever');
    await new Promise((r) => setTimeout(r, 120));
    await p.abortConversation('c-deaf');
    await expect(turn).resolves.toBeDefined();
    await expect(p.sendPromptAndWait('c-deaf', 'again')).resolves.toBeDefined();
  }, 20_000);

  it('an externally-signalled abort settles the turn and emits harness.cancelled', async () => {
    const p = await started();
    await p.createConversation(CONV('c-signal'));
    const { events, stop } = collect(p, 'c-signal');
    const ac = new AbortController();
    const turn = p.sendPromptAndWait('c-signal', 'HANG forever', undefined, ac.signal);
    await new Promise((r) => setTimeout(r, 120));
    ac.abort();
    await expect(turn).resolves.toBeDefined();
    stop();
    expect(events.map((e) => e.kind)).toContain('harness.cancelled');
  }, 20_000);

  it('a pre-aborted signal cancels without starting a turn', async () => {
    const p = await started();
    await p.createConversation(CONV('c-pre'));
    const { events, stop } = collect(p, 'c-pre');
    await expect(p.sendPromptAndWait('c-pre', 'hi', undefined, AbortSignal.abort())).resolves.toEqual({ content: '' });
    stop();
    expect(events.map((e) => e.kind)).toEqual(['harness.cancelled']);
  }, 15_000);
});

// ── Defect: rpc() never timed out, never rejected, never drained ──

describe('CodexProvider — rpc() is bounded and drains on child death', () => {
  it('rejects a call the child never answers, instead of hanging forever', async () => {
    // The deadline has to cover child boot as well as the call, because
    // `initialize()` now performs a real `initialize` handshake against the
    // freshly spawned process. 300 ms was enough when bring-up sent nothing.
    const p = await started({ env: { FAKE_CODEX_SILENT: 'model/list' }, rpcTimeoutMs: 2_000 });
    await expect(p.ping()).resolves.toBe(false); // ping's whole contract
  }, 20_000);

  it('rejects every outstanding call when the child dies mid-request', async () => {
    const p = await started({ env: { FAKE_CODEX_DIE_ON: 'thread/start' }, rpcTimeoutMs: 30_000 });
    // A 30 s deadline is deliberately far longer than this test: if the exit
    // handler did not drain `pendingRpc`, this would time out the test rather
    // than reject promptly.
    await expect(p.createConversation(CONV('c-dead'))).rejects.toThrow(/exited with code/i);
  }, 15_000);

  it('ping() returns false — not hangs — after the child has exited', async () => {
    const p = await started({ env: { FAKE_CODEX_DIE_ON: 'thread/start' }, rpcTimeoutMs: 30_000 });
    await p.createConversation(CONV('c-dead2')).catch(() => { /* expected */ });
    await expect(p.ping()).resolves.toBe(false);
  }, 15_000);

  it('captures the child stderr tail and attaches it to the exit error (W12)', async () => {
    const p = await started({
      env: { FAKE_CODEX_DIE_ON: 'thread/start', FAKE_CODEX_STDERR: 'codex: bad model "nope"' },
      rpcTimeoutMs: 30_000,
    });
    await expect(p.createConversation(CONV('c-stderr'))).rejects.toThrow(/bad model "nope"/);
  }, 15_000);
});

// ── Defect: JSON-RPC error responses were resolved as successes ──

describe('CodexProvider — a JSON-RPC error response is a failure', () => {
  it('createConversation() throws when thread/start errors, instead of inventing a thread id', async () => {
    const p = await started({ env: { FAKE_CODEX_THREAD_ERROR: '1' } });
    await expect(p.createConversation(CONV('c-err'))).rejects.toBeInstanceOf(CodexRpcError);
    // …and must not have registered a conversation against a thread the
    // binary has never heard of.
    expect(p.hasLiveConversation('c-err')).toBe(false);
  }, 15_000);

  it('surfaces the JSON-RPC error code so callers can branch on it', async () => {
    const p = await started({ env: { FAKE_CODEX_THREAD_ERROR: '1' } });
    const err = await p.createConversation(CONV('c-err2')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CodexRpcError);
    expect((err as CodexRpcError).code).toBe(-32602);
  }, 15_000);
});

// ── Defect: the backoff was keyed off a code the server never sends ──

describe('CodexProvider — backoff triggers on codexErrorInfo', () => {
  it('retries a rate-limited turn and eventually succeeds', async () => {
    const warnings: string[] = [];
    const p = await started({
      env: { FAKE_CODEX_TURN_RATE_LIMIT: '2' },
      baseBackoffMs: 5,
      maxBackoffRetries: 4,
      logger: { warn: (m: string) => { warnings.push(m); } } as unknown as CodexProviderOptions['logger'],
    });
    await p.createConversation(CONV('c-rl'));
    const { events, stop } = collect(p, 'c-rl');
    // The first two turns report `codexErrorInfo: "rateLimitExceeded"` on an
    // `error` notification — how real backpressure arrives. The old code
    // watched for JSON-RPC code -32001, which the server never sends, so the
    // whole backoff was unreachable and the turn failed outright.
    await expect(p.sendPromptAndWait('c-rl', 'hello')).resolves.toEqual({ content: 'hello ' });
    stop();
    expect(warnings.filter((w) => w.includes('rateLimitExceeded'))).toHaveLength(2);
    // A retried rate limit is not a user-visible error.
    expect(events.map((e) => e.kind)).not.toContain('harness.error');
  }, 20_000);

  it('gives up and rejects once the retry budget is spent', async () => {
    const p = await started({
      env: { FAKE_CODEX_TURN_RATE_LIMIT: '99' },
      baseBackoffMs: 5,
      maxBackoffRetries: 2,
    });
    await p.createConversation(CONV('c-rl2'));
    await expect(p.sendPromptAndWait('c-rl2', 'hello')).rejects.toBeInstanceOf(CodexRateLimitedError);
    // …and the conversation is released, not wedged.
    await expect(p.sendPromptAndWait('c-rl2', 'hello')).rejects.toBeInstanceOf(CodexRateLimitedError);
  }, 20_000);
});

// ── Defect: pendingToolCallIds was never pruned ──

describe('CodexProvider — W13-B1 truncation guard fails only OPEN tool calls', () => {
  it('does not re-report an already-completed tool call as failed', async () => {
    const p = await started();
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
  }, 15_000);

  it('reports a normal tool call as a success', async () => {
    const p = await started();
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
  }, 15_000);
});

// ── Defect: `void this.sendPromptAndWait(...)` with no .catch ──

describe('CodexProvider — sendPrompt() never produces an unhandled rejection', () => {
  it('reports an unknown conversation as harness.error rather than crashing the process', async () => {
    const p = await started();
    const rejections: unknown[] = [];
    const onRejection = (e: unknown): void => { rejections.push(e); };
    process.on('unhandledRejection', onRejection);
    try {
      await p.sendPrompt('conversation-that-does-not-exist', 'hi');
      // Two macrotask turns is more than enough for an unhandled rejection to
      // be reported if the `.catch` were missing.
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      process.off('unhandledRejection', onRejection);
    }
    expect(rejections).toEqual([]);
  }, 15_000);

  it('broadcasts harness.error when a fire-and-forget turn fails', async () => {
    const p = await started();
    await p.createConversation(CONV('c-fnf'));
    const { events, stop } = collect(p, 'c-fnf');
    await p.sendPrompt('c-fnf', 'ERROR please');
    await new Promise((r) => setTimeout(r, 300));
    stop();
    expect(events.map((e) => e.kind)).toContain('harness.error');
  }, 15_000);
});

// ── Defect: shutdown() nulled the handle before the child could exit ──

describe('CodexProvider — shutdown escalates SIGTERM → SIGKILL', () => {
  it('ends a child that ignores SIGTERM', async () => {
    const p = await started({ env: { FAKE_CODEX_IGNORE_SIGTERM: '1' }, shutdownGraceMs: 300 });
    const child = (p as unknown as { proc: { pid: number; killed: boolean } | null }).proc;
    const pid = child!.pid;
    await p.shutdown();
    expect(p.getClientState()).toBe('stopped');
    // Give the OS a moment to reap, then confirm the process is gone.
    await new Promise((r) => setTimeout(r, 300));
    expect(() => process.kill(pid, 0)).toThrow(); // ESRCH — no such process
  }, 15_000);

  it('cancels in-flight turns on shutdown rather than leaving them pending', async () => {
    const p = await started();
    await p.createConversation(CONV('c-shut'));
    const turn = p.sendPromptAndWait('c-shut', 'HANG forever');
    await new Promise((r) => setTimeout(r, 120));
    await p.shutdown();
    await expect(turn).resolves.toBeDefined();
  }, 15_000);
});


// ── Defect: the initialize handshake was never performed ──

describe('CodexProvider — completes the app-server handshake', () => {
  it('fails initialize() when the server refuses the handshake', async () => {
    // Every method was previously issued against a server that had not agreed
    // to talk yet; a refused handshake went unnoticed until the first real
    // call failed for an unrelated-looking reason.
    const p = makeProvider({ env: { FAKE_CODEX_SKIP_HANDSHAKE: '1' } });
    await expect(p.initialize()).rejects.toThrow(/handshake/i);
    expect(p.getClientState()).toBe('error');
  }, 15_000);
});

// ── Defect: server→client requests were never answered ──

describe('CodexProvider — answers server-initiated approval requests', () => {
  it('a turn that asks for approval completes instead of hanging', async () => {
    // `codex app-server` BLOCKS the turn until the client answers. The previous
    // provider had no branch for an inbound request at all, so the turn sat
    // until the RPC deadline and then failed with a timeout.
    const p = await started({ env: { FAKE_CODEX_APPROVAL: '1' }, rpcTimeoutMs: 3_000 });
    await p.createConversation(CONV('c-appr'));
    await expect(p.sendPromptAndWait('c-appr', 'hello')).resolves.toEqual({ content: 'hello ' });
  }, 20_000);

  it('declines by default, and consults onApproval when one is supplied', async () => {
    const seen: string[] = [];
    const p = await started({
      env: { FAKE_CODEX_APPROVAL: '1' },
      rpcTimeoutMs: 3_000,
      onApproval: (req) => { seen.push(req.method); return 'accept'; },
    });
    await p.createConversation(CONV('c-appr2'));
    await expect(p.sendPromptAndWait('c-appr2', 'hello')).resolves.toEqual({ content: 'hello ' });
    expect(seen).toContain('item/commandExecution/requestApproval');
  }, 20_000);
});

// ── W12: the thread id is the resumable provider session id ──

describe('CodexProvider — exposes and resumes its thread id', () => {
  it('getProviderSessionId() returns the thread id the server issued', async () => {
    const p = await started();
    await p.createConversation(CONV('c-sid'));
    expect(p.getProviderSessionId('c-sid')).toMatch(/^thr_/);
  }, 15_000);

  it('createConversation() rejoins an existing thread via resumeProviderSessionId', async () => {
    // Without this a runtime recycle silently restarts the model with no
    // memory of the chat.
    const p = await started();
    await p.createConversation({ conversationId: 'c-res', resumeProviderSessionId: 'thr_existing' } as CreateConversationParams);
    expect(p.getProviderSessionId('c-res')).toBe('thr_existing');
  }, 15_000);
});

// ── Defect: getMessages() claimed history was unavailable ──

describe('CodexProvider — reads thread history', () => {
  it('returns the thread items rather than an empty array', async () => {
    const p = await started();
    await p.createConversation(CONV('c-hist'));
    await expect(p.getMessages('c-hist')).resolves.toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello ' },
    ]);
  }, 15_000);
});
