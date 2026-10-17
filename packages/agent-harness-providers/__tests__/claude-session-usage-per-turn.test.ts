// ────────────────────────────────────────────────────────────────
// A persistent Claude session reports running totals; harness.usage is per turn.
//
// Observed in the desktop app (2026-10-17): every `result` of a live CLI process
// carries `total_cost_usd`, `usage` and `modelUsage` for the whole process
// (0.42 → 1.79 → 1.84 → 2.00), so a chat's second turn showed the first turn's
// cost added in and workflow summaries that sum usage counted it again.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ClaudeAgentProvider } from '../src/providers/claude-agent/ClaudeAgentProvider.js';
import { AgentHostSupervisor } from '../src/AgentHostSupervisor.js';
import { sessionTotalsOf, usageSince } from '../src/providers/claude-agent/sessionUsage.js';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(() => ({ interrupt: vi.fn(), setModel: vi.fn(), setPermissionMode: vi.fn(), close: vi.fn() })),
  startup: vi.fn(async () => {
    throw new Error('not used in these cases');
  }),
  deleteSession: vi.fn(),
}));

function result(cost: number, input: number, output: number, opusCost = cost) {
  return {
    type: 'result', subtype: 'success', is_error: false, num_turns: 1, result: 'ok', session_id: 'sdk-1',
    total_cost_usd: cost,
    usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    modelUsage: {
      'claude-opus-5-5': {
        inputTokens: input, outputTokens: output, cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
        webSearchRequests: 0, costUSD: opusCost, contextWindow: 1_000_000, maxOutputTokens: 64_000,
      },
    },
  };
}

describe('usageSince', () => {
  it('takes the earlier totals out of cost, usage and every model, leaving model limits alone', () => {
    const after = usageSince(result(1.0, 300, 90), sessionTotalsOf(result(0.4, 100, 40)));
    expect(after.total_cost_usd).toBeCloseTo(0.6);
    expect(after.usage).toMatchObject({ input_tokens: 200, output_tokens: 50 });
    expect(after.modelUsage['claude-opus-5-5']).toMatchObject({ inputTokens: 200, outputTokens: 50, contextWindow: 1_000_000 });
    expect(after.modelUsage['claude-opus-5-5']!.costUSD).toBeCloseTo(0.6);
  });

  it('is a no-op with no base, or when the totals went backwards (another process)', () => {
    const r = result(0.2, 50, 10);
    expect(usageSince(r, undefined)).toBe(r);
    expect(usageSince(r, sessionTotalsOf(result(0.4, 100, 40)))).toBe(r);
  });
});

function fakeQuery() {
  const queue: unknown[] = [];
  let wake: (() => void) | undefined;
  let ended = false;
  const iterator = {
    async next(): Promise<IteratorResult<unknown>> {
      for (;;) {
        if (queue.length > 0) return { value: queue.shift(), done: false };
        if (ended) return { value: undefined, done: true };
        await new Promise<void>((r) => { wake = r; });
      }
    },
    [Symbol.asyncIterator]() { return iterator; },
  };
  return {
    push(message: unknown) { queue.push(message); wake?.(); wake = undefined; },
    interrupt: vi.fn(async () => undefined),
    close: vi.fn(async () => { ended = true; wake?.(); wake = undefined; }),
    getContextUsage: vi.fn(async () => { throw new Error('no probe in this case'); }),
    [Symbol.asyncIterator]() { return iterator; },
  };
}

type Turn = { settled: boolean; done: Promise<void>; session?: unknown };
type Internals = {
  conversations: Map<string, unknown>;
  sessions: Map<string, unknown>;
  activeQueries: Map<string, unknown>;
  beginTurn: (id: string, aq: unknown, startedAt: number, release: () => void, prompt?: string) => Turn;
  readSession: (session: unknown) => Promise<void>;
};

describe('a persistent Claude session', () => {
  let provider: ClaudeAgentProvider;
  let internals: Internals;
  let supervisor: AgentHostSupervisor;

  beforeEach(() => {
    supervisor = new AgentHostSupervisor({ maxConcurrentExecutions: 1 });
    provider = new ClaudeAgentProvider({
      cliPath: '/nonexistent/claude', defaultCwd: '/tmp', persistentSessions: true, supervisor, cancelGraceMs: 50,
    } as ConstructorParameters<typeof ClaudeAgentProvider>[0]);
    internals = provider as unknown as Internals;
  });
  afterEach(async () => { await provider.shutdown(); });

  it("reports each turn's own cost and tokens, not the process's running totals", async () => {
    const id = 'c1';
    const query = fakeQuery();
    internals.conversations.set(id, { conversationId: id, workingDirectory: '/tmp', lastUsedAt: Date.now() });
    const session = {
      conversationId: id, query, input: { end: vi.fn(), push: vi.fn() }, fingerprint: 'fp',
      liveModel: undefined, livePermissionMode: undefined, liveMcpKey: '{}', sdkSessionId: undefined,
      closed: false, reader: Promise.resolve(), backgroundAgents: new Set<string>(),
    };
    session.reader = internals.readSession(session);
    internals.sessions.set(id, session);
    const usage: Record<string, unknown>[] = [];
    provider.onConversationEvent(id, (e) => { if (e.kind === 'harness.usage') usage.push(e.data as Record<string, unknown>); });

    const runTurn = async (final: unknown) => {
      const release = await supervisor.acquireExecution();
      const activeQuery = { queryId: 'q', conversationId: id, abortController: new AbortController(), status: 'running' };
      internals.activeQueries.set(id, activeQuery);
      const turn = internals.beginTurn(id, activeQuery, Date.now(), release, 'go');
      turn.session = session;
      query.push({ type: 'assistant', session_id: 'sdk-1', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } });
      query.push(final);
      await turn.done;
    };

    await runTurn(result(0.42, 1_000, 200));
    await runTurn(result(0.5, 1_300, 260));

    expect(usage).toHaveLength(2);
    expect(usage[0]).toMatchObject({ costUsd: 0.42, inputTokens: 1_000, outputTokens: 200 });
    expect(usage[1]!['costUsd']).toBeCloseTo(0.08);
    expect(usage[1]).toMatchObject({ inputTokens: 300, outputTokens: 60 });
  });
});
