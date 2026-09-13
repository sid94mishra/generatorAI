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
import { tmpdir } from 'node:os';
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
        supportsVision: false,
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

// ── Defect: Codex multi-agent items were dropped entirely ──
//
// `collabAgentToolCall` and `subAgentActivity` were not in TOOL_ITEM_TYPES and
// had no handler, so a Codex collab turn produced no tool events at all: the
// transcript showed the model doing nothing for as long as its sub-agents ran.

describe('CodexProvider — multi-agent (collab) items surface as sub-agent activity', () => {
  it('maps collabAgentToolCall to an `Agent` tool call carrying the collab arguments', async () => {
    const p = await started();
    await p.createConversation(CONV('c-collab'));
    const { events, stop } = collect(p, 'c-collab');
    await p.sendPromptAndWait('c-collab', 'COLLAB now');
    stop();

    const start = events.find(
      (e): e is Extract<AgentEvent, { kind: 'harness.tool_start' }> =>
        e.kind === 'harness.tool_start' && e.data.tool === 'Agent',
    );
    expect(start).toBeDefined();
    expect(start?.data.args).toMatchObject({
      tool: 'spawnAgent',
      prompt: 'investigate the parser',
      model: 'gpt-5.6-terra',
      receiverThreadIds: ['thread_child'],
    });

    const complete = events.find(
      (e): e is Extract<AgentEvent, { kind: 'harness.tool_complete' }> =>
        e.kind === 'harness.tool_complete' && e.data.tool === 'Agent',
    );
    // `completed` is the only collab status that means success.
    expect(complete?.data.success).toBe(true);
    expect(complete?.data.callId).toBe(start?.data.callId);
  }, 15_000);

  it('maps subAgentActivity to subagent_started / subagent_completed, each exactly once', async () => {
    const p = await started();
    await p.createConversation(CONV('c-collab2'));
    const { events, stop } = collect(p, 'c-collab2');
    await p.sendPromptAndWait('c-collab2', 'COLLAB now');
    stop();

    const infoTypes = events
      .filter((e): e is Extract<AgentEvent, { kind: 'harness.session_info' }> => e.kind === 'harness.session_info')
      .map((e) => e.data.infoType);
    expect(infoTypes.filter((t) => t === 'subagent_started')).toHaveLength(1);
    expect(infoTypes.filter((t) => t === 'subagent_completed')).toHaveLength(1);
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

// ── Defect: every thread was rooted in the SERVER's cwd ──
//
// `thread/start` and `thread/resume` both hardcoded `cwd: opts.defaultCwd` and
// never read `params.workingDirectory`, so a chat bound to a worktree read and
// wrote the directory the GeneratorAI server happened to start in. The fixture
// echoes back the params it was actually sent (`ECHO_PARAMS`), so these assert
// the wire, not a mock.

describe('CodexProvider — per-conversation workspace', () => {
  // `defaultCwd` is also the spawn cwd of the app-server child, so it has to
  // be a directory that really exists; the chat's own root does not.
  const SERVER_CWD = tmpdir();

  async function echo(p: CodexProvider, id: string): Promise<{
    thread: Record<string, unknown>;
    turn: Record<string, unknown>;
  }> {
    const { content } = await p.sendPromptAndWait(id, 'ECHO_PARAMS');
    return JSON.parse(content) as { thread: Record<string, unknown>; turn: Record<string, unknown> };
  }

  it('starts the thread in params.workingDirectory, not opts.defaultCwd', async () => {
    const p = await started({ defaultCwd: SERVER_CWD });
    await p.createConversation({
      conversationId: 'c-cwd',
      workingDirectory: '/work/repo',
    } as CreateConversationParams);

    expect((await echo(p, 'c-cwd')).thread['cwd']).toBe('/work/repo');
  }, 20_000);

  it('falls back to opts.defaultCwd when the conversation names no directory', async () => {
    const p = await started({ defaultCwd: SERVER_CWD });
    await p.createConversation(CONV('c-cwd-default'));

    expect((await echo(p, 'c-cwd-default')).thread['cwd']).toBe(SERVER_CWD);
  }, 20_000);

  it('resumes an existing thread in params.workingDirectory too', async () => {
    const p = await started({ defaultCwd: SERVER_CWD });
    await p.createConversation({
      conversationId: 'c-cwd-resume',
      resumeProviderSessionId: 'thr_existing',
      workingDirectory: '/work/repo',
    } as CreateConversationParams);

    expect((await echo(p, 'c-cwd-resume')).thread['cwd']).toBe('/work/repo');
  }, 20_000);

  it('sends additionalDirectories as sandboxPolicy.writableRoots on every turn', async () => {
    // `V2ThreadStartParams` has no sandbox-policy field — only `sandbox`, the
    // mode enum — so `V2TurnStartParams.sandboxPolicy` is the only place the
    // pinned protocol accepts writable roots.
    const p = await started({ defaultCwd: SERVER_CWD, sandboxMode: 'workspace-write' });
    await p.createConversation({
      conversationId: 'c-roots',
      workingDirectory: '/work/repo',
      additionalDirectories: ['/work/docs', '/work/.generatorai/scratch', '/work/docs'],
    } as CreateConversationParams);

    expect((await echo(p, 'c-roots')).turn['sandboxPolicy']).toEqual({
      type: 'workspaceWrite',
      writableRoots: ['/work/docs', '/work/.generatorai/scratch'],
    });
  }, 20_000);

  it('warns instead of reshaping the roots when the sandbox has none', async () => {
    const p = await started({ sandboxMode: 'read-only' });
    await p.createConversation({
      conversationId: 'c-roots-ro',
      additionalDirectories: ['/work/docs'],
    } as CreateConversationParams);

    expect(p.getConversationWarnings('c-roots-ro')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'FIELD_UNSUPPORTED_BY_PROVIDER',
          params: expect.objectContaining({ field: 'additionalDirectories' }),
        }),
      ]),
    );
    expect((await echo(p, 'c-roots-ro')).turn['sandboxPolicy']).toBeUndefined();
  }, 20_000);

  it('warns that per-conversation env cannot reach the shared app-server', async () => {
    // One `codex app-server` child serves every conversation and is spawned in
    // initialize(), before any of them exists — a process environment is fixed
    // at spawn time and the protocol has no per-thread env field.
    const p = await started();
    await p.createConversation({
      conversationId: 'c-env',
      env: { GENERATORAI_SCRATCH_DIR: '/work/scratch' },
    } as CreateConversationParams);

    expect(p.getConversationWarnings('c-env')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'FIELD_UNSUPPORTED_BY_PROVIDER',
          params: expect.objectContaining({ field: 'env' }),
        }),
      ]),
    );
  }, 20_000);
});

// ── Integration parity: what a real 0.153 turn carries reaches the host ──
//
// Before this block the provider relayed only tokens and tool start/complete.
// Reasoning, per-segment messages, token usage, file-op stats, host tools,
// MCP servers, skills, effort, sign-in state and the chat's own approval UI
// were all dropped, so a Codex chat rendered as a bare, run-together stream.

describe('CodexProvider — integration parity with the other providers', () => {
  it('reports sign-in state from account/read', async () => {
    const signedIn = await started();
    await expect(signedIn.getAccountInfo()).resolves.toEqual({ email: 'dev@example.com', subscriptionType: 'pro', apiProvider: 'openai' });
    const apiKey = await started({ env: { FAKE_CODEX_ACCOUNT: 'apikey' } });
    await expect(apiKey.getAccountInfo()).resolves.toMatchObject({ apiKeySource: 'OPENAI_API_KEY' });
    const signedOut = await started({ env: { FAKE_CODEX_ACCOUNT: 'none' } });
    await expect(signedOut.getAccountInfo()).resolves.toEqual({ tokenSource: 'none' });
  }, 20_000);

  it('relays reasoning, discrete messages, host tools, file ops and usage from one turn', async () => {
    const p = await started();
    const calls: unknown[] = [];
    await p.createConversation({
      conversationId: 'rich',
      tools: [{
        name: 'get_magic_number',
        description: 'magic',
        parametersSchema: { type: 'object' },
        handler: async (args: Record<string, unknown>) => { calls.push(args); return 'The magic number is 4242.'; },
      }],
    } as unknown as CreateConversationParams);
    const { events, stop } = collect(p, 'rich');
    const res = await p.sendPromptAndWait('rich', 'RICH');
    stop();

    expect(calls).toEqual([{ label: 'fixture' }]);
    // The final answer, not commentary glued onto it.
    expect(res.content).toBe('MAGIC=4242');
    const kinds = events.map((e) => e.kind);
    expect(kinds[0]).toBe('harness.turn_start');
    expect(kinds.slice(-2)).toEqual(['harness.turn_end', 'harness.idle']);

    const reasoning = events.filter((e) => e.kind === 'harness.reasoning_delta').map((e) => (e.data as { text: string }).text).join('');
    expect(reasoning).toBe('Plan the work'); // the raw delta for the same item is not relayed twice
    expect(events.find((e) => e.kind === 'harness.reasoning_complete')?.data).toEqual({ content: 'Plan the work' });

    expect(events.filter((e) => e.kind === 'harness.message_complete').map((e) => (e.data as { content: string }).content))
      .toEqual(['Checking first.', 'MAGIC=4242']);

    const patch = events.find((e) => e.kind === 'harness.tool_complete' && (e.data as { tool: string }).tool === 'apply_patch');
    expect((patch?.data as { fileOp?: unknown }).fileOp).toEqual({ kind: 'edit', filePath: 'src/a.ts', additions: 2, deletions: 1 });

    expect(events.find((e) => e.kind === 'harness.context_usage')?.data).toMatchObject({
      provider: 'codex', source: 'provider', currentTokens: 1150, totalContextWindow: 272000,
    });
    expect(events.find((e) => e.kind === 'harness.usage')?.data).toMatchObject({ inputTokens: 1000, outputTokens: 150, provider: 'codex' });
  }, 20_000);

  it('answers a call to an unregistered host tool as a failure instead of hanging the turn', async () => {
    const p = await started();
    await p.createConversation(CONV('notool'));
    const { events, stop } = collect(p, 'notool');
    const res = await p.sendPromptAndWait('notool', 'RICH');
    stop();
    expect(res.content).toBe('MAGIC=');
    const call = events.find((e) => e.kind === 'harness.tool_complete' && (e.data as { tool: string }).tool === 'get_magic_number');
    expect((call?.data as { success: boolean }).success).toBe(false);
  }, 20_000);

  it('sends MCP servers, host tools and the chat effort over the wire', async () => {
    const p = await started();
    const warn: unknown[] = [];
    await p.createConversation({
      conversationId: 'wire',
      reasoningEffort: 'high',
      mcpServers: {
        local: { type: 'stdio', command: 'node', args: ['srv.js'], env: { A: '1' }, tools: ['t1'], timeoutMs: 1500 },
        remote: { type: 'http', url: 'https://mcp.example.com', headers: { Authorization: 'x' } },
        legacy: { type: 'sse', url: 'https://old.example.com' },
        off: { type: 'stdio', command: 'nope', enabled: false },
      },
      tools: [{ name: 'ask_user', description: 'Ask', parametersSchema: { type: 'object' }, handler: async () => 'ok' }],
      skillDirectories: ['/skills/b', '/skills/a'],
    } as unknown as CreateConversationParams);
    warn.push(...p.getConversationWarnings('wire'));
    const echoed = JSON.parse((await p.sendPromptAndWait('wire', 'ECHO_PARAMS')).content) as {
      thread: { config?: { mcp_servers?: Record<string, unknown>; projects?: unknown }; dynamicTools?: unknown[] };
      turn: { effort?: string };
      skillRoots: string[] | null;
    };
    expect(echoed.thread.config?.projects).toEqual({ [process.cwd()]: { trust_level: 'trusted' } });
    expect(echoed.thread.config?.mcp_servers).toEqual({
      node_repl: { enabled: false },
      local: { command: 'node', args: ['srv.js'], env: { A: '1' }, enabled_tools: ['t1'], tool_timeout_sec: 2 },
      remote: { url: 'https://mcp.example.com', http_headers: { Authorization: 'x' } },
    });
    expect(echoed.thread.dynamicTools).toEqual([{ type: 'function', name: 'ask_user', description: 'Ask', inputSchema: { type: 'object' } }]);
    expect(echoed.turn.effort).toBe('high');
    expect(echoed.skillRoots).toEqual(['/skills/a', '/skills/b']);
    expect(warn).toContainEqual(expect.objectContaining({ params: expect.objectContaining({ field: 'mcpServers.legacy' }) }));
  }, 20_000);

  it("routes approvals to the conversation's own permission handler", async () => {
    const p = await started({ env: { FAKE_CODEX_APPROVAL: '1' }, rpcTimeoutMs: 3_000 });
    const asked: string[] = [];
    await p.createConversation({
      conversationId: 'hitl',
      onPermissionRequest: async (req: { type: string; description: string }) => { asked.push(`${req.type}:${req.description}`); return { granted: true }; },
    } as unknown as CreateConversationParams);
    const res = await p.sendPromptAndWait('hitl', 'ECHO_DECISION');
    expect(asked).toEqual(['shell_exec:Run command: rm -rf /']);
    expect(JSON.parse(res.content)).toEqual({ decision: 'accept' });
  }, 20_000);

  it('destroying a conversation keeps its Codex thread; deleting removes it', async () => {
    const p = await started();
    const sent: string[] = [];
    const rpc = (p as unknown as { rpc: (m: string, params?: unknown) => Promise<unknown> }).rpc.bind(p);
    (p as unknown as { rpc: typeof rpc }).rpc = (m, params) => { sent.push(m); return rpc(m, params); };
    await p.createConversation(CONV('keep'));
    await p.destroyConversation('keep');
    expect(sent).not.toContain('thread/delete');
    expect(p.hasLiveConversation('keep')).toBe(false);
    await p.createConversation(CONV('gone'));
    await p.deleteConversation('gone');
    expect(sent).toContain('thread/delete');
  }, 20_000);

  it("Stop terminates the stopped turn's command but not an earlier turn's background terminal", async () => {
    const p = await started();
    const sent: Array<{ m: string; params: unknown }> = [];
    const rpc = (p as unknown as { rpc: (m: string, params?: unknown) => Promise<unknown> }).rpc.bind(p);
    (p as unknown as { rpc: typeof rpc }).rpc = (m, params) => { sent.push({ m, params }); return rpc(m, params); };
    await p.createConversation(CONV('stop'));
    const { events, stop } = collect(p, 'stop');
    const turn = p.sendPromptAndWait('stop', 'LONG_CMD');
    await new Promise((r) => setTimeout(r, 300));
    await p.abortConversation('stop');
    await turn;
    await new Promise((r) => setTimeout(r, 300));
    stop();
    const terminated = sent.filter((c) => c.m === 'thread/backgroundTerminals/terminate').map((c) => (c.params as { processId: string }).processId);
    expect(sent.map((c) => c.m)).toContain('turn/interrupt');
    expect(terminated).toEqual(['p-long']);
    const card = events.find((e) => e.kind === 'harness.tool_complete' && (e.data as { callId: string }).callId === 'call_long');
    expect((card?.data as { success: boolean }).success).toBe(false);
  }, 20_000);

  it("turns Codex's own multi-agent delegation off when the platform excludes native delegation", async () => {
    const p = await started();
    await p.createConversation({ conversationId: 'orch', excludedBuiltinTools: ['Agent', 'Task'] } as unknown as CreateConversationParams);
    const orch = JSON.parse((await p.sendPromptAndWait('orch', 'ECHO_PARAMS')).content) as { thread: { config?: Record<string, unknown> } };
    expect(orch.thread.config).toMatchObject({ features: { multi_agent: false } });

    await p.createConversation(CONV('plain'));
    const plain = JSON.parse((await p.sendPromptAndWait('plain', 'ECHO_PARAMS')).content) as { thread: { config?: Record<string, unknown> } };
    expect(plain.thread.config?.['features']).toBeUndefined();
  }, 20_000);

  it('re-asserts instructions, MCP servers and delegation policy when resuming a thread', async () => {
    const p = await started();
    await p.createConversation({
      conversationId: 'resume-me',
      resumeProviderSessionId: 'thr_existing',
      systemPromptAppend: 'You are an orchestrator.',
      mcpServers: { local: { type: 'stdio', command: 'node' } },
      excludedBuiltinTools: ['Agent'],
    } as unknown as CreateConversationParams);
    const echoed = JSON.parse((await p.sendPromptAndWait('resume-me', 'ECHO_PARAMS')).content) as {
      thread: { developerInstructions?: string; config?: Record<string, unknown> };
    };
    expect(echoed.thread.developerInstructions).toBe('You are an orchestrator.');
    expect(echoed.thread.config).toEqual({
      projects: { [process.cwd()]: { trust_level: 'trusted' } },
      plugins: {
        'unified-computer-use@openai-bundled': { enabled: false },
        'computer-use@openai-bundled': { enabled: false },
        'browser@openai-bundled': { enabled: false },
      },
      mcp_servers: { node_repl: { enabled: false }, local: { command: 'node' } },
      features: { multi_agent: false },
    });
  }, 20_000);

  it('reads the Codex version from the handshake', async () => {
    const p = await started();
    expect(p.getVersion()).toBe('0.0.0');
  }, 15_000);
});
