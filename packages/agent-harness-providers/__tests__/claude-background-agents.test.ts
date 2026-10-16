// ────────────────────────────────────────────────────────────────
// E-3: background sub-agents report back after the turn's `result`.
//
// Observed live (2026-10-16): an Opus chat asked for "parallel subagents" started three background agents, said
// "I'll put the diagram together once they all report back", and its turn ended on that `result`. Two minutes later
// the CLI fed the agents' reports to the model, which wrote the real answer — to a session with no turn in flight,
// so the reader dropped it. The chat never showed the answer it paid for.
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

const agents = (...types: string[]) => ({
  type: 'system', subtype: 'background_tasks_changed', session_id: 'sdk-1',
  tasks: types.map((task_type, i) => ({ task_id: `t${i}`, task_type, description: 'study' })),
});
const say = (text: string) => ({ type: 'assistant', session_id: 'sdk-1', message: { role: 'assistant', content: [{ type: 'text', text }] } });

describe('background sub-agents in a persistent Claude session (E-3)', () => {
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
  afterEach(async () => {
    vi.useRealTimers();
    await provider.shutdown();
  });

  async function turnInFlight(id: string, prompt: string, query = fakeQuery()) {
    internals.conversations.set(id, { conversationId: id, workingDirectory: '/tmp', lastUsedAt: Date.now() });
    const session = {
      conversationId: id, query, input: { end: vi.fn(), push: vi.fn() }, fingerprint: 'fp',
      liveModel: undefined, livePermissionMode: undefined, liveMcpKey: '{}', sdkSessionId: undefined,
      closed: false, reader: Promise.resolve(), backgroundAgents: new Set<string>(),
    };
    session.reader = internals.readSession(session);
    internals.sessions.set(id, session);
    const release = await supervisor.acquireExecution();
    const activeQuery = { queryId: 'q', conversationId: id, abortController: new AbortController(), status: 'running' };
    internals.activeQueries.set(id, activeQuery);
    const turn = internals.beginTurn(id, activeQuery, Date.now(), release, prompt);
    turn.session = session;
    const events: string[] = [];
    provider.onConversationEvent(id, (e) => { events.push(e.kind); });
    return { query, turn, events };
  }

  it('keeps the turn open until the agents report, and shows the answer the model writes then', async () => {
    const { query, turn, events } = await turnInFlight('c1', 'Use parallel subagents to study the scheduler.');
    query.push(say('The agents are running in parallel. '));
    query.push(agents('local_agent', 'local_agent'));
    query.push(REAL_RESULT);
    await tick();
    await tick();
    expect(turn.settled).toBe(false);
    expect(events).not.toContain('harness.idle');

    query.push(agents());
    query.push(say('When a monitor fails during maintenance, no incident is opened.'));
    query.push(REAL_RESULT);
    await turn.done;
    expect(turn.fullContent).toContain('no incident is opened');
    expect(events.filter((k) => k === 'harness.idle')).toHaveLength(1);
    expect(supervisor.snapshot().activeExecutions).toBe(0);
  });

  it('never holds a turn for a background shell (a dev server can run for hours)', async () => {
    const { query, turn } = await turnInFlight('c2', 'Start the dev server in the background.');
    query.push(agents('local_bash'));
    query.push(say('Started.'));
    query.push(REAL_RESULT);
    await turn.done;
    expect(turn.settled).toBe(true);
  });

  it('ends a held turn if the CLI never continues after the agents are gone', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { query, turn, events } = await turnInFlight('c3', 'fan out');
    query.push(say('Waiting on agents.'));
    query.push(agents('local_agent'));
    query.push(REAL_RESULT);
    query.push(agents());
    await tick();
    await tick();
    expect(turn.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    await turn.done;
    expect(events.filter((k) => k === 'harness.idle')).toHaveLength(1);
  });
});
