// ────────────────────────────────────────────────────────────────
// Stop on a persistent session must SETTLE the turn: release its execution
// permit, drop it from `turns`, and wake anyone waiting on `done`.
//
// Observed live (2026-09-13): four background workers were stopped (two by
// Stop on their orchestrator, two by deleting it). Each held one of the four
// execution permits. `abortConversation` marked the turns aborted and emitted
// `harness.cancelled`, but nothing ever called `completeTurn`: the session
// reader skipped the CLI's `result` for an aborted turn, and closing the
// session did not settle it either. Every prompt after that — any chat, any
// workspace — queued behind "Waiting for a free agent slot" forever.
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

/** A query whose messages the test feeds in by hand. */
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
    end() { ended = true; wake?.(); wake = undefined; },
    interrupt: vi.fn(async () => undefined),
    close: vi.fn(async () => { ended = true; wake?.(); wake = undefined; }),
    [Symbol.asyncIterator]() { return iterator; },
  };
}

type Internals = {
  conversations: Map<string, { conversationId: string; workingDirectory: string; lastUsedAt?: number }>;
  sessions: Map<string, unknown>;
  turns: Map<string, { aborted: boolean; settled: boolean; done: Promise<void>; session?: unknown; activeQuery: { status: string } }>;
  activeQueries: Map<string, unknown>;
  beginTurn: (id: string, aq: unknown, startedAt: number, release: () => void) => { session?: unknown };
  readSession: (session: unknown) => Promise<void>;
};

const tick = () => new Promise<void>((r) => setImmediate(r));

describe('Stop on a persistent Claude session settles the turn', () => {
  let provider: ClaudeAgentProvider;
  let internals: Internals;
  let supervisor: AgentHostSupervisor;

  beforeEach(() => {
    supervisor = new AgentHostSupervisor({ maxConcurrentExecutions: 1 });
    provider = new ClaudeAgentProvider({
      cliPath: '/nonexistent/claude',
      defaultCwd: '/tmp',
      persistentSessions: true,
      supervisor,
      cancelGraceMs: 50,
    } as ConstructorParameters<typeof ClaudeAgentProvider>[0]);
    internals = provider as unknown as Internals;
  });

  afterEach(async () => {
    await provider.shutdown();
  });

  /** A live session with one turn in flight that holds the only execution permit. */
  async function turnInFlight(id: string) {
    internals.conversations.set(id, { conversationId: id, workingDirectory: '/tmp', lastUsedAt: Date.now() });
    const query = fakeQuery();
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
    const turn = internals.beginTurn(id, activeQuery, Date.now(), release);
    turn.session = session;
    expect(supervisor.snapshot().activeExecutions).toBe(1);
    return { query, session, turn: internals.turns.get(id)! };
  }

  it('releases the permit and wakes `done` when the CLI answers the interrupt with a result', async () => {
    const { query, turn } = await turnInFlight('c1');
    const events: string[] = [];
    provider.onConversationEvent('c1', (e) => { events.push(e.kind); });

    await provider.abortConversation('c1');
    expect(turn.aborted).toBe(true);
    expect(events).toEqual(['harness.cancelled', 'harness.idle']);
    // Still held: the CLI has not acknowledged yet.
    expect(supervisor.snapshot().activeExecutions).toBe(1);

    query.push({ type: 'result', subtype: 'error_during_execution', session_id: 'sdk-1' });
    await turn.done;

    expect(turn.settled).toBe(true);
    expect(turn.activeQuery.status).toBe('aborted');
    expect(internals.turns.has('c1')).toBe(false);
    expect(supervisor.snapshot().activeExecutions).toBe(0);
    // The session survived the stop — the interrupt was acknowledged in time.
    await tick();
    expect(query.close).not.toHaveBeenCalled();
    expect(internals.sessions.has('c1')).toBe(true);
  });

  it('releases the permit when the interrupt is never acknowledged and the session is closed', async () => {
    const { query, turn } = await turnInFlight('c2');
    await provider.abortConversation('c2');
    // The grace budget (50 ms) expires with no result: the session is closed
    // and the reader's end settles the turn.
    await turn.done;
    expect(query.close).toHaveBeenCalled();
    expect(turn.activeQuery.status).toBe('aborted');
    expect(internals.turns.has('c2')).toBe(false);
    expect(supervisor.snapshot().activeExecutions).toBe(0);
  });

  it('fails (and releases) a running turn whose session dies before a result', async () => {
    const { query, turn } = await turnInFlight('c3');
    const errors: string[] = [];
    provider.onConversationEvent('c3', (e) => { if (e.kind === 'harness.error') errors.push(String((e.data as { message: string }).message)); });

    query.end();
    await turn.done;

    expect(turn.activeQuery.status).toBe('failed');
    expect(errors[0]).toMatch(/session ended before the turn produced a result/);
    expect(supervisor.snapshot().activeExecutions).toBe(0);
  });

  it('a reader ending does not settle a turn that belongs to a newer session', async () => {
    const { query: oldQuery } = await turnInFlight('c4');
    const turn = internals.turns.get('c4')!;
    // The turn moved to a rebuilt session; the old reader ending is not its end.
    turn.session = { conversationId: 'c4' };
    oldQuery.end();
    await tick(); await tick();
    expect(turn.settled).toBe(false);
    expect(supervisor.snapshot().activeExecutions).toBe(1);
  });

  it('ECON-R6: a stop while the turn is queued for its permit withdraws it, and it never starts', async () => {
    await turnInFlight('busy');
    internals.conversations.set('q1', { conversationId: 'q1', workingDirectory: '/tmp', lastUsedAt: Date.now() });
    const events: string[] = [];
    provider.onConversationEvent('q1', (e) => { events.push(e.kind); });

    const sent = provider.sendPrompt('q1', 'hello');
    await vi.waitFor(() => expect(supervisor.snapshot().executionQueueDepth).toBe(1));

    await provider.abortConversation('q1');
    await sent;
    expect(events).toContain('harness.cancelled');
    expect(events.at(-1)).toBe('harness.idle');
    expect(supervisor.snapshot().executionQueueDepth).toBe(0);
    expect(internals.turns.has('q1')).toBe(false);
    expect(internals.activeQueries.has('q1')).toBe(false);

    // The busy turn's permit is not handed to the withdrawn waiter.
    (provider as unknown as { completeTurn: (t: unknown, s: string) => void }).completeTurn(internals.turns.get('busy'), 'completed');
    expect(supervisor.snapshot().activeExecutions).toBe(0);
    expect(internals.turns.has('q1')).toBe(false);
  });

  it('ECON-R7: a turn yields its permit while a tool blocks and takes it back', async () => {
    const { turn } = await turnInFlight('y1');
    (turn as unknown as { permit?: string }).permit = 'held';

    const takeBack = provider.yieldTurnPermit('y1');
    expect(takeBack).toBeTypeOf('function');
    expect(supervisor.snapshot().activeExecutions).toBe(0);
    expect(provider.yieldTurnPermit('y1')).toBeUndefined();

    await takeBack!();
    expect(supervisor.snapshot().activeExecutions).toBe(1);
    (provider as unknown as { completeTurn: (t: unknown, s: string) => void }).completeTurn(turn, 'completed');
    expect(supervisor.snapshot().activeExecutions).toBe(0);
  });

  it('reports the permit accounting in runtime diagnostics', async () => {
    await turnInFlight('c5');
    expect(provider.runtimeDiagnostics()).toMatchObject({ turnsInFlight: 1, maxConcurrentTurns: 1, turnsQueued: 0 });
  });
});
