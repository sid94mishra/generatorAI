// ────────────────────────────────────────────────────────────────
// A resumed session answers the prompt SECOND.
//
// Observed live in the desktop app (2026-09-20). A chat's agent had started
// `npm start` with the Bash tool's `run_in_background`. The app was restarted,
// which killed the CLI and the shell under it. The next prompt resumed the
// session, and the CLI sent, in this order:
//
//   system/task_notification  "Background shell command didn't finish before
//                              the previous session ended"
//   result  success  num_turns:0  result:""  0 tokens  $0      ← bookkeeping
//   assistant  "391"                                          ← the answer
//   result  success  num_turns:1  result:"391"
//
// The reader settled the turn on the first `result`. The chat showed the
// user's prompt with nothing under it and no error; the model's answer — paid
// for — arrived a second later to a turn that no longer existed.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ClaudeAgentProvider } from '../src/providers/claude-agent/ClaudeAgentProvider.js';
import { AgentHostSupervisor } from '../src/AgentHostSupervisor.js';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(() => ({ interrupt: vi.fn(), setModel: vi.fn(), setPermissionMode: vi.fn(), close: vi.fn() })),
  startup: vi.fn(async () => {
    throw new Error('not used in these cases');
  }),
  deleteSession: vi.fn(),
}));

function fakeQuery(contextUsage?: () => Promise<unknown>) {
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
    getContextUsage: vi.fn(contextUsage ?? (async () => { throw new Error('no probe in this case'); })),
    [Symbol.asyncIterator]() { return iterator; },
  };
}

type Turn = { settled: boolean; done: Promise<void>; session?: unknown; fullContent: string };
type Internals = {
  conversations: Map<string, unknown>;
  sessions: Map<string, unknown>;
  turns: Map<string, Turn>;
  activeQueries: Map<string, unknown>;
  beginTurn: (id: string, aq: unknown, startedAt: number, release: () => void, prompt?: string) => Turn;
  readSession: (session: unknown) => Promise<void>;
};

const tick = () => new Promise<void>((r) => setImmediate(r));

const HOUSEKEEPING = {
  type: 'result', subtype: 'success', is_error: false, num_turns: 0, result: '', duration_api_ms: 0,
  total_cost_usd: 0, session_id: 'sdk-1',
  usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
};
const ANSWER = { type: 'assistant', session_id: 'sdk-1', message: { role: 'assistant', content: [{ type: 'text', text: '391' }] } };
const REAL_RESULT = {
  type: 'result', subtype: 'success', is_error: false, num_turns: 1, result: '391', session_id: 'sdk-1',
  usage: {
    input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 48_337, cache_creation_input_tokens: 792,
    iterations: [{ input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 48_337, cache_creation_input_tokens: 792 }],
  },
};

describe('a resumed Claude session', () => {
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

  async function turnInFlight(id: string, prompt: string, query = fakeQuery()) {
    internals.conversations.set(id, { conversationId: id, workingDirectory: '/tmp', lastUsedAt: Date.now() });
    const session = {
      conversationId: id, query, input: { end: vi.fn(), push: vi.fn() }, fingerprint: 'fp',
      liveModel: undefined, livePermissionMode: undefined, liveMcpKey: '{}', sdkSessionId: undefined,
      closed: false, reader: Promise.resolve(),
    };
    session.reader = internals.readSession(session);
    internals.sessions.set(id, session);
    const release = await supervisor.acquireExecution();
    const activeQuery = { queryId: 'q', conversationId: id, abortController: new AbortController(), status: 'running' };
    internals.activeQueries.set(id, activeQuery);
    const turn = internals.beginTurn(id, activeQuery, Date.now(), release, prompt);
    turn.session = session;
    const events: { kind: string; data: Record<string, unknown> }[] = [];
    provider.onConversationEvent(id, (e) => { events.push({ kind: e.kind, data: e.data as Record<string, unknown> }); });
    return { query, turn, events };
  }

  it('does not end the turn on the bookkeeping result that precedes the answer', async () => {
    const { query, turn, events } = await turnInFlight('c1', 'What is 17 * 23?');

    query.push({ type: 'system', subtype: 'task_notification', task_id: 't', status: 'stopped', session_id: 'sdk-1' });
    query.push(HOUSEKEEPING);
    await tick();
    await tick();
    expect(turn.settled).toBe(false);
    // Nothing told the UI the turn was over, either.
    expect(events.map((e) => e.kind)).not.toContain('harness.idle');
    expect(supervisor.snapshot().activeExecutions).toBe(1);

    query.push(ANSWER);
    query.push(REAL_RESULT);
    await turn.done;
    expect(turn.fullContent).toBe('391');
    expect(events.map((e) => e.kind)).toContain('harness.idle');
    expect(supervisor.snapshot().activeExecutions).toBe(0);
  });

  it('still ends a CLI-local command, whose only result has zero turns', async () => {
    const { query, turn } = await turnInFlight('c2', '/compact');
    query.push(HOUSEKEEPING);
    await turn.done;
    expect(turn.settled).toBe(true);
  });

  it('never mistakes a real empty-handed result for bookkeeping once the model has spoken', async () => {
    const { query, turn } = await turnInFlight('c3', 'hello');
    query.push(ANSWER);
    query.push({ ...HOUSEKEEPING });
    await turn.done;
    expect(turn.settled).toBe(true);
  });

  it('publishes the provider context breakdown even when the probe lands after the result', async () => {
    // A one-message answer is over before a 1–3 s `getContextUsage()` can
    // return. The session stays open, so the late answer is still good —
    // dropping it left the gauge on the estimate, with no breakdown, forever.
    let land!: (v: unknown) => void;
    const query = fakeQuery(() => new Promise((resolve) => { land = resolve; }));
    const { turn, events } = await turnInFlight('c4', 'What is 17 * 23?', query);

    query.push(ANSWER);
    query.push(REAL_RESULT);
    await turn.done;
    const before = events.filter((e) => e.kind === 'harness.context_usage');
    expect(before.every((e) => e.data['source'] === 'derived')).toBe(true);

    land({ totalTokens: 49_000, maxTokens: 936_000, rawMaxTokens: 1_000_000, categories: [{ name: 'System prompt', tokens: 4_000 }] });
    await tick();
    await tick();
    const provided = events.filter((e) => e.kind === 'harness.context_usage' && e.data['source'] === 'provider');
    expect(provided).toHaveLength(1);
    // The total is the RESULT's last call, not the probe's earlier sample.
    expect(provided[0]!.data['currentTokens']).toBe(2 + 48_337 + 792);
    expect(provided[0]!.data['promptTokenLimit']).toBe(936_000);
    expect(provided[0]!.data['breakdown']).toMatchObject({ system: 4_000 });
  });
});
