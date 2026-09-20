// ────────────────────────────────────────────────────────────────
// CodexProvider — protocol-coverage regression tests
// ────────────────────────────────────────────────────────────────
//
// An audit against the pinned 0.154 protocol found the provider handled 8 of
// 81 server notifications and 8 of 10 server requests. Everything it did not
// handle fell into the `default: break` arm and vanished — which is not a
// cosmetic gap: a plan the model published was invisible, a command's output
// only appeared once the command had finished, a retry looked like a hang, a
// question the model asked was answered "nothing" on the user's behalf, and a
// thread that died mid-turn hung until the RPC deadline.
//
// Each `describe` below names the gap it closes. Like the rest of the Codex
// suite these spawn a REAL child process speaking the REAL newline-delimited
// JSON-RPC protocol (`fixtures/fakeCodexAppServer.mjs`), so the notification
// SHAPES are the ones in `protocol/codex.generated.ts`, not a mock's idea of
// them.

import { describe, expect, it, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CodexProvider } from '../CodexProvider.js';
import type { AgentEvent } from '@generatorai/shared';
import { classifyEvent } from '@generatorai/shared';
import type { CreateConversationParams } from '@generatorai/core';
import type { CodexProviderOptions } from '../../../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, 'fixtures', 'fakeCodexAppServer.mjs');

const live: CodexProvider[] = [];

function makeProvider(overrides: Partial<CodexProviderOptions> = {}): CodexProvider {
  const p = new CodexProvider({
    binaryPath: process.execPath,
    args: [FIXTURE],
    rpcTimeoutMs: 3_000,
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

const CONV = (id: string): CreateConversationParams => ({ conversationId: id }) as CreateConversationParams;

function collect(provider: CodexProvider, conversationId: string): { events: AgentEvent[]; stop: () => void } {
  const events: AgentEvent[] = [];
  const stop = provider.onConversationEvent(conversationId, (e) => events.push(e));
  return { events, stop };
}

/** Every `harness.session_info` of one infoType, as its raw payload bag. */
function infos(events: readonly AgentEvent[], infoType: string): Array<Record<string, unknown>> {
  return events
    .filter((e) => e.kind === 'harness.session_info')
    .map((e) => e.data as unknown as Record<string, unknown>)
    .filter((d) => d['infoType'] === infoType);
}

afterEach(async () => {
  await Promise.all(live.splice(0).map((p) => p.shutdown().catch(() => { /* best effort */ })));
});

// ── Gap: a running command's output only appeared when it finished ──

describe('CodexProvider — live tool output reaches the host while the call is open', () => {
  it('maps command, patch and MCP progress onto `tool_progress` keyed by the tool call', async () => {
    const p = await started();
    await p.createConversation(CONV('prog'));
    const { events, stop } = collect(p, 'prog');
    await p.sendPromptAndWait('prog', 'PROGRESS_DEMO');
    stop();

    const progress = infos(events, 'tool_progress');
    // Command stdout arrives per chunk, attributed to the command's own call.
    expect(progress.filter((d) => d['toolCallId'] === 'call_progress').map((d) => d['message']))
      .toEqual(['line one\n', 'line two\n']);
    // The file-change tool call carries both its log and its patch summary.
    const patch = progress.filter((d) => d['toolCallId'] === 'call_patch');
    expect(patch.map((d) => d['message'])).toEqual(['applying hunk 1/1\n', 'Patching src/b.ts']);
    expect(patch[1]?.['changes']).toHaveLength(1);
    // An MCP tool narrates its own progress.
    expect(progress.find((d) => d['toolCallId'] === 'call_mcp')?.['message']).toBe('searching issues…');
  }, 20_000);

  it('classifies the progress stream as a DELTA so it cannot flood the durable log', () => {
    // `tool_progress` is emitted per chunk and superseded by the completed
    // tool call, which is exactly the delta bar — the same classification
    // Claude's own tool progress gets, so neither provider is special-cased.
    expect(classifyEvent('harness.session_info', { infoType: 'tool_progress' })).toBe('delta');
    expect(classifyEvent('harness.session_info', { infoType: 'turn_diff' })).toBe('delta');
    // A plan update is a state change: dropping one leaves the checklist wrong.
    expect(classifyEvent('harness.session_info', { infoType: 'plan_update' })).toBe('item');
  });

  it("emits the turn's working-tree diff as informational `turn_diff`", async () => {
    const p = await started();
    await p.createConversation(CONV('diff'));
    const { events, stop } = collect(p, 'diff');
    await p.sendPromptAndWait('diff', 'PROGRESS_DEMO');
    stop();
    expect(infos(events, 'turn_diff')[0]?.['diff']).toContain('+b');
  }, 20_000);
});

// ── Gap: the model's plan was invisible ──

describe('CodexProvider — plan updates', () => {
  it('folds the structural and the streamed plan onto one `plan_update`, deduped', async () => {
    const p = await started();
    await p.createConversation(CONV('plan'));
    const { events, stop } = collect(p, 'plan');
    await p.sendPromptAndWait('plan', 'PLAN_DEMO');
    stop();

    const updates = infos(events, 'plan_update');
    // Three turn-level notifications, but the middle one repeats the first
    // verbatim — re-filing it would put an identical checklist in the
    // transcript for every tool call the agent makes.
    expect(updates).toHaveLength(3);

    expect(updates[0]?.['message']).toBe(
      'Plan: 1/3 done\nThree steps.\n[x] read the parser\n[~] fix the bug\n[ ] add a test',
    );
    expect(updates[0]?.['completed']).toBe(1);
    expect(updates[0]?.['total']).toBe(3);
    expect(updates[1]?.['completed']).toBe(2);

    // The streamed markdown `plan` item lands in the SAME shape, so no surface
    // has to know which of Codex's two plan channels produced an update.
    expect(updates[2]?.['steps']).toEqual([
      { step: 'read the parser', status: 'completed' },
      { step: 'ship it', status: 'pending' },
    ]);
  }, 20_000);
});

// ── Gap: reasoning summary parts ran together into one paragraph ──

describe('CodexProvider — reasoning summary part boundaries', () => {
  it('inserts a paragraph break between summary parts', async () => {
    const p = await started();
    await p.createConversation(CONV('reason'));
    const { events, stop } = collect(p, 'reason');
    await p.sendPromptAndWait('reason', 'REASON_PARTS');
    stop();

    const streamed = events
      .filter((e) => e.kind === 'harness.reasoning_delta')
      .map((e) => (e.data as { text: string }).text)
      .join('');
    expect(streamed).toBe('First part.\n\nSecond part.');
  }, 20_000);
});

// ── Gap: warnings, reroutes, compaction and retries were all silent ──

describe('CodexProvider — provider notices', () => {
  it('surfaces warnings, config/deprecation notices, reroutes, compaction and retries', async () => {
    const p = await started();
    await p.createConversation(CONV('warn'));
    const { events, stop } = collect(p, 'warn');
    // The retry notice must NOT end the turn: the server is handling it.
    await expect(p.sendPromptAndWait('warn', 'WARN_DEMO')).resolves.toEqual({ content: 'warned ' });
    stop();

    const warnings = infos(events, 'provider_warning').map((d) => String(d['message']));
    expect(warnings).toEqual([
      'Your sandbox is running in degraded mode.',
      'Unknown key "modl" (/home/u/.codex/config.toml)',
      'Deprecated: Detached review threads',
      'This command touches credentials.',
    ]);
    // A deprecation's migration steps are the actionable half.
    expect(infos(events, 'provider_warning')[2]?.['details']).toBe(
      'Use thread/start then an inline review.',
    );

    const rerouted = infos(events, 'model_rerouted')[0];
    expect(rerouted).toMatchObject({
      fromModel: 'gpt-5.6-terra',
      toModel: 'gpt-5.6-luna',
      reason: 'highRiskCyberActivity',
    });

    // The same infoType the Claude mapper emits for its own compact boundary,
    // so the transcript needs no Codex-specific branch to render it.
    expect(infos(events, 'compact_boundary')).toHaveLength(1);

    const retry = infos(events, 'provider_retry')[0];
    expect(retry?.['message']).toContain('upstream hiccup');
    expect(retry?.['errorInfo']).toBe('serverOverloaded');
    // A retried error is not a failure — the turn finished normally.
    expect(events.some((e) => e.kind === 'harness.error')).toBe(false);
    expect(events[events.length - 1]?.kind).toBe('harness.idle');
  }, 20_000);

  it('reports quota from the push notification and from account/rateLimits/read', async () => {
    const p = await started({ env: { FAKE_CODEX_RATE_LIMITS: '1' } });
    await p.createConversation(CONV('rate'));
    const { events, stop } = collect(p, 'rate');
    await p.sendPromptAndWait('rate', 'RATE_DEMO');
    stop();

    const snapshot = infos(events, 'rate_limits')[0];
    expect(snapshot?.['message']).toContain('primary 42% used');
    expect(snapshot?.['message']).toContain('secondary 7% used');
    expect((snapshot?.['rateLimits'] as { primary: { usedPercent: number } }).primary.usedPercent).toBe(42.4);

    // `getAccountInfo` reports the LATEST snapshot, so the push notification
    // that arrived mid-turn supersedes what was read at bring-up.
    const account = await p.getAccountInfo();
    expect(account.rateLimits?.primary?.usedPercent).toBe(42.4);
  }, 20_000);

  it('omits rateLimits entirely when the binary has no account/rateLimits/read', async () => {
    // An older binary answers "method not found"; that is a missing optional,
    // not a bring-up failure, and must not fabricate a snapshot.
    const p = await started();
    const account = await p.getAccountInfo();
    expect(account.rateLimits).toBeUndefined();
    expect(account).toMatchObject({ email: 'dev@example.com' });
  }, 20_000);
});

// ── Gap: a thread that died mid-turn hung until the RPC deadline ──

describe('CodexProvider — thread lifecycle settles an in-flight turn', () => {
  it.each([
    ['CLOSE_DEMO', 'system error state'],
    ['THREAD_CLOSED_DEMO', 'closed before the turn finished'],
  ])('rejects %s while preserving partial output and failing open tools', async (prompt, error) => {
    const p = await started({ rpcTimeoutMs: 30_000 });
    await p.createConversation(CONV('dead'));
    const { events, stop } = collect(p, 'dead');
    // The fixture sends nothing after the status change, so anything but an
    // explicit settle would sit here for the whole RPC deadline.
    await expect(p.sendPromptAndWait('dead', prompt)).rejects.toThrow(error);
    stop();

    expect(events).toContainEqual(expect.objectContaining({
      kind: 'harness.token', data: expect.objectContaining({ text: 'starting ' }),
    }));
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('harness.error');
    expect(kinds[kinds.length - 1]).toBe('harness.idle');
    // A command that was still open is reported as failed, not left spinning
    // and not left looking as though it succeeded.
    const open = events.find(
      (e) => e.kind === 'harness.tool_complete' && (e.data as { callId: string }).callId === 'call_doomed',
    );
    expect((open?.data as { success: boolean }).success).toBe(false);

    // And the conversation is reusable rather than wedged.
    await expect(p.sendPromptAndWait('dead', 'hello')).resolves.toMatchObject({ content: 'hello ' });
  }, 30_000);
});

// ── Gap: the model's questions were answered "nothing" on the user's behalf ──

describe('CodexProvider — item/tool/requestUserInput routes to the question gate', () => {
  it('asks the host and returns the answers in Codex\'s shape', async () => {
    const p = await started();
    const asked: unknown[] = [];
    await p.createConversation({
      conversationId: 'ask',
      onQuestionRequest: async (req: unknown) => {
        asked.push(req);
        return { answers: { q1: ['tanstack'] } };
      },
    } as unknown as CreateConversationParams);
    const res = await p.sendPromptAndWait('ask', 'ASK_DEMO');

    // The question reached the platform's own gate, normalised to `AgentQuestion`.
    expect(asked).toEqual([{
      questions: [{
        id: 'q1',
        header: 'Router',
        question: 'Which router should I use?',
        options: [
          { label: 'react-router', description: 'The incumbent' },
          { label: 'tanstack', description: 'Newer' },
        ],
        multiSelect: false,
        // `isOther: true` is Codex saying an answer outside the options is allowed.
        allowFreeform: true,
      }],
    }]);
    // And the answer went back in the shape `ToolRequestUserInputResponse` names.
    expect(JSON.parse(res.content)).toEqual({ answers: { q1: { answers: ['tanstack'] } } });
  }, 20_000);

  it('carries a freeform reply through when the user did not pick an option', async () => {
    const p = await started();
    await p.createConversation({
      conversationId: 'ask2',
      onQuestionRequest: async () => ({ answers: {}, freeformResponse: 'use whatever is already there' }),
    } as unknown as CreateConversationParams);
    const res = await p.sendPromptAndWait('ask2', 'ASK_DEMO');
    expect(JSON.parse(res.content)).toEqual({
      answers: { q1: { answers: ['use whatever is already there'] } },
    });
  }, 20_000);

  it('still answers — so the turn cannot hang — when the chat has no question gate', async () => {
    const p = await started();
    await p.createConversation(CONV('ask3'));
    const res = await p.sendPromptAndWait('ask3', 'ASK_DEMO');
    expect(JSON.parse(res.content)).toEqual({ answers: {} });
  }, 20_000);
});

// ── Gap: permission escalation was always refused, approvals never remembered ──

describe('CodexProvider — permission escalation and remembered approvals', () => {
  it('routes item/permissions/requestApproval to the chat and echoes the granted profile', async () => {
    const p = await started();
    const asked: Array<{ type: string; description: string; details?: Record<string, unknown> }> = [];
    await p.createConversation({
      conversationId: 'perm',
      onPermissionRequest: async (req: { type: string; description: string; details?: Record<string, unknown> }) => {
        asked.push(req);
        return { granted: true };
      },
    } as unknown as CreateConversationParams);
    const res = await p.sendPromptAndWait('perm', 'PERM_DEMO');

    // The card can say what is actually being asked for.
    expect(asked[0]?.type).toBe('other');
    expect(asked[0]?.description).toBe(
      'Grant additional file system/network permissions: write /tmp/out; network access',
    );
    expect(asked[0]?.details?.['reason']).toBe('The build needs the npm registry.');

    const reply = JSON.parse(res.content) as { result: { permissions: unknown; scope: string } | null; error: unknown };
    expect(reply.error).toBeNull();
    // Exactly the profile that was requested — never a broader one — and only
    // for this turn.
    expect(reply.result?.scope).toBe('turn');
    expect(reply.result?.permissions).toEqual({
      fileSystem: { entries: [{ access: 'write', path: { type: 'path', path: '/tmp/out' } }], read: null, write: null, globScanMaxDepth: null },
      network: { enabled: true },
    });
  }, 20_000);

  it('never auto-grants: a chat with no handler is refused', async () => {
    const p = await started();
    await p.createConversation(CONV('perm2'));
    const res = await p.sendPromptAndWait('perm2', 'PERM_DEMO');
    const reply = JSON.parse(res.content) as { result: unknown; error: { code: number } | null };
    expect(reply.result).toBeNull();
    expect(reply.error?.code).toBe(-32001);
  }, 20_000);

  it('answers acceptForSession when the user said "don\'t ask again"', async () => {
    const p = await started({ env: { FAKE_CODEX_APPROVAL: '1' } });
    await p.createConversation({
      conversationId: 'remember',
      onPermissionRequest: async () => ({ granted: true, remember: true }),
    } as unknown as CreateConversationParams);
    const res = await p.sendPromptAndWait('remember', 'ECHO_DECISION');
    expect(JSON.parse(res.content)).toEqual({ decision: 'acceptForSession' });
  }, 20_000);

  it('keeps the one-off decision when the user did not ask to remember', async () => {
    const p = await started({ env: { FAKE_CODEX_APPROVAL: '1' } });
    await p.createConversation({
      conversationId: 'once',
      onPermissionRequest: async () => ({ granted: true }),
    } as unknown as CreateConversationParams);
    const res = await p.sendPromptAndWait('once', 'ECHO_DECISION');
    expect(JSON.parse(res.content)).toEqual({ decision: 'accept' });
  }, 20_000);

  it('passes the parsed command actions and network context into the approval card', async () => {
    const p = await started({ env: { FAKE_CODEX_APPROVAL: '1' } });
    const details: Array<Record<string, unknown>> = [];
    await p.createConversation({
      conversationId: 'ctx',
      onPermissionRequest: async (req: { details?: Record<string, unknown> }) => {
        if (req.details) details.push(req.details);
        return { granted: false };
      },
    } as unknown as CreateConversationParams);
    await p.sendPromptAndWait('ctx', 'ECHO_DECISION');
    expect(details[0]).toMatchObject({ toolName: 'shell', command: 'rm -rf /', cwd: '/tmp' });
  }, 20_000);
});

// ── Gap: an MCP server that failed to start was invisible ──

describe('CodexProvider — MCP startup failures become conversation warnings', () => {
  it('warns for a server that failed and for one whose catalogue could not be read', async () => {
    const p = await started({ env: { FAKE_CODEX_MCP_STATUS: 'failed' } });
    await p.createConversation(CONV('mcp'));
    const warnings = p.getConversationWarnings('mcp');
    expect(warnings).toEqual([
      { code: 'MCP_SERVER_FAILED', params: { server: 'broken', provider: 'codex', status: 'failed' } },
      { code: 'MCP_SERVER_FAILED', params: { server: 'nocatalog', provider: 'codex', reason: 'tool discovery timed out' } },
    ]);
  }, 20_000);

  it('says nothing when every server is healthy', async () => {
    const p = await started({ env: { FAKE_CODEX_MCP_STATUS: 'ok' } });
    await p.createConversation(CONV('mcp-ok'));
    expect(p.getConversationWarnings('mcp-ok')).toEqual([]);
  }, 20_000);

  it('degrades quietly on a binary without mcpServerStatus/list', async () => {
    // The fixture answers "method not found" by default — the same as an older
    // binary. A missing optional must not fail the conversation.
    const p = await started();
    await p.createConversation(CONV('mcp-old'));
    expect(p.getConversationWarnings('mcp-old')).toEqual([]);
  }, 20_000);
});

describe('CodexProvider — a command that fails silently still says why', () => {
  it('keeps the exit code on a failed command with no output', async () => {
    const p = await started();
    await p.createConversation(CONV('quiet'));
    const { events, stop } = collect(p, 'quiet');
    await p.sendPromptAndWait('quiet', 'FAIL_QUIET please');
    stop();
    const done = events.find((e) => e.kind === 'harness.tool_complete') as { data: { success: boolean; result: string } } | undefined;
    expect(done?.data.success).toBe(false);
    expect(done?.data.result).toContain('[exit code 7]');
  }, 15_000);
});
