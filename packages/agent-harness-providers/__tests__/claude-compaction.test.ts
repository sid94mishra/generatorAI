// ────────────────────────────────────────────────────────────────
// Claude compaction (docs/compaction): the mapper's start / failed / boundary
// events, `compactConversation` as a `/compact` turn of its own, a compaction
// between turns, and the auto-compaction setting.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentEvent } from '@generatorai/shared';

import { ClaudeAgentProvider } from '../src/providers/claude-agent/ClaudeAgentProvider.js';
import { mapClaudeAgentMessageToAgentEvents } from '../src/providers/claude-agent/event-mapper.js';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(() => ({ interrupt: vi.fn(), setModel: vi.fn(), setPermissionMode: vi.fn(), close: vi.fn() })),
  startup: vi.fn(async () => {
    throw new Error('not used in these cases');
  }),
  deleteSession: vi.fn(),
}));

type Msg = Parameters<typeof mapClaudeAgentMessageToAgentEvents>[0];
const map = (m: unknown) => mapClaudeAgentMessageToAgentEvents(m as Msg);
const info = (e: AgentEvent) => e.data as Record<string, unknown>;

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
    interrupt: vi.fn(async () => undefined),
    close: vi.fn(async () => { ended = true; wake?.(); wake = undefined; }),
    getContextUsage: vi.fn(async () => ({ totalTokens: 21_000, maxTokens: 200_000, categories: [] })),
    [Symbol.asyncIterator]() { return iterator; },
  };
}

const status = (s: Record<string, unknown>) => ({ type: 'system', subtype: 'status', session_id: 's', uuid: 'u', ...s });
const boundary = (meta: Record<string, unknown>) => ({ type: 'system', subtype: 'compact_boundary', session_id: 's', uuid: 'u', compact_metadata: meta });
const result = (text: string, usage: Record<string, unknown> = {}) => ({
  type: 'result', subtype: 'success', result: text, num_turns: 0, session_id: 'sdk-1', usage, modelUsage: {},
});

describe('Claude mapper — compaction events', () => {
  it('maps the compacting status to a start, labelled auto', () => {
    const [e] = map(status({ status: 'compacting' }));
    expect(e!.kind).toBe('harness.session_info');
    expect(info(e!)).toMatchObject({ infoType: 'compaction_start', trigger: 'auto' });
  });

  it('maps a failed outcome to compaction_failed with the CLI error, and a success to nothing', () => {
    const [e] = map(status({ status: null, compact_result: 'failed', compact_error: 'prompt too long' }));
    expect(info(e!)).toMatchObject({ infoType: 'compaction_failed', error: 'prompt too long' });
    expect(map(status({ status: null, compact_result: 'success' }))).toEqual([]);
  });

  it('maps the boundary with its trigger and token counts, and drops the gauge to post_tokens', () => {
    const events = map(boundary({ trigger: 'manual', pre_tokens: 152_000, post_tokens: 21_000 }));
    expect(info(events[0]!)).toMatchObject({
      infoType: 'compact_boundary', trigger: 'manual', preTokens: 152_000, postTokens: 21_000,
      message: 'Conversation compacted · 152K → 21K tokens',
    });
    expect(events[1]).toMatchObject({ kind: 'harness.context_usage', data: { currentTokens: 21_000 } });
  });

  it('publishes no gauge reading when post_tokens is absent', () => {
    const events = map(boundary({ trigger: 'auto', pre_tokens: 152_000 }));
    expect(events.map((e) => e.kind)).toEqual(['harness.session_info']);
    expect(info(events[0]!)).toMatchObject({ trigger: 'auto', message: 'Conversation compacted automatically · from 152K tokens' });
  });
});

type Internals = {
  conversations: Map<string, Record<string, unknown>>;
  sessions: Map<string, unknown>;
  compactSummaries: Map<string, string>;
  ensureSession: (...args: unknown[]) => Promise<unknown>;
  readSession: (session: unknown) => Promise<void>;
  buildQueryOptions: (config: unknown, turnOptions: unknown, mode: { persistent: boolean }) => Record<string, unknown>;
};

describe('Claude compaction on a persistent session', () => {
  let provider: ClaudeAgentProvider;
  let internals: Internals;

  beforeEach(() => {
    provider = new ClaudeAgentProvider({
      cliPath: '/nonexistent/claude',
      defaultCwd: '/tmp',
      persistentSessions: true,
    } as ConstructorParameters<typeof ClaudeAgentProvider>[0]);
    internals = provider as unknown as Internals;
  });

  afterEach(async () => {
    await provider.shutdown();
  });

  /** A live session whose CLI output the test writes; `pushed` holds what the provider sent it. */
  function liveSession(id: string) {
    internals.conversations.set(id, { conversationId: id, workingDirectory: '/tmp', lastUsedAt: Date.now() });
    const query = fakeQuery();
    const pushed: unknown[] = [];
    const session = {
      conversationId: id, query, input: { end: vi.fn(), push: vi.fn((m: unknown) => pushed.push(m)) }, fingerprint: 'fp',
      liveModel: undefined, livePermissionMode: undefined, liveMcpKey: '{}', sdkSessionId: undefined,
      closed: false, reader: Promise.resolve(), backgroundAgents: new Set<string>(),
    };
    session.reader = internals.readSession(session);
    internals.sessions.set(id, session);
    internals.ensureSession = async () => session;
    const events: AgentEvent[] = [];
    provider.onConversationEvent(id, (e) => { events.push(e); });
    return { query, pushed, events };
  }

  const compactionInfo = (events: AgentEvent[]) =>
    events
      .filter((e) => e.kind === 'harness.session_info' && String(info(e)['infoType']).startsWith('compact'))
      .map((e) => [info(e)['infoType'], info(e)['trigger']]);

  /** Wait until the provider has handed the `/compact` prompt to the session. */
  async function untilPushed(pushed: unknown[]) {
    for (let i = 0; i < 100 && pushed.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    expect(pushed).toHaveLength(1);
    return JSON.stringify(pushed[0]);
  }

  it('runs /compact with the instructions as a turn, labels it manual, and keeps the summarising call off the gauge', async () => {
    const { query, pushed, events } = liveSession('c1');
    internals.compactSummaries.set('c1', 'The user is building a todo app.');
    const done = provider.compactConversation('c1', { instructions: 'keep the API notes' });

    expect(await untilPushed(pushed)).toContain('/compact keep the API notes');
    query.push(status({ status: 'compacting' }));
    query.push(boundary({ trigger: 'manual', pre_tokens: 152_000 }));
    // The summarising call read the whole old window: 150K of input.
    query.push(result('', { input_tokens: 150_000, output_tokens: 2_000, iterations: [{ input_tokens: 150_000, output_tokens: 2_000 }] }));
    await done;

    expect(compactionInfo(events)).toEqual([
      ['compaction_start', 'manual'],
      ['compact_boundary', 'manual'],
    ]);
    const boundaryEvent = events.find((e) => info(e)['infoType'] === 'compact_boundary')!;
    expect(info(boundaryEvent)['summary']).toBe('The user is building a todo app.');
    // No reading of 150K after the boundary: only the re-read window (21K) may follow it.
    const after = events.slice(events.indexOf(boundaryEvent));
    for (const e of after.filter((x) => x.kind === 'harness.context_usage')) {
      expect((e.data as { currentTokens: number }).currentTokens).toBe(21_000);
    }
    expect(events.at(-1)!.kind).toBe('harness.idle');
  });

  it('rejects, after saying why on the stream, when the CLI did not compact', async () => {
    const { query, pushed, events } = liveSession('c2');
    const done = provider.compactConversation('c2');
    expect(await untilPushed(pushed)).toContain('/compact');
    query.push(result('Not enough messages to compact.'));

    await expect(done).rejects.toThrow('Not enough messages to compact.');
    const kinds = events.map((e) => (e.kind === 'harness.session_info' ? info(e)['infoType'] : e.kind));
    expect(kinds.indexOf('compaction_failed')).toBeGreaterThan(-1);
    expect(kinds.indexOf('compaction_failed')).toBeLessThan(kinds.lastIndexOf('harness.idle'));
    expect(compactionInfo(events)).toEqual([
      ['compaction_start', 'manual'],
      ['compaction_failed', 'manual'],
    ]);
  });

  it('publishes a compaction that happens between turns (idle compaction)', async () => {
    const { query, events } = liveSession('c3');
    query.push(status({ status: 'compacting' }));
    query.push(boundary({ trigger: 'auto', pre_tokens: 210_000, post_tokens: 30_000 }));
    for (let i = 0; i < 50 && events.length < 3; i++) await new Promise((r) => setTimeout(r, 5));

    expect(compactionInfo(events)).toEqual([
      ['compaction_start', 'auto'],
      ['compact_boundary', 'auto'],
    ]);
    expect(events.some((e) => e.kind === 'harness.context_usage')).toBe(true);
  });

  it('maps the auto-compaction setting onto the CLI settings and environment', () => {
    const base = { conversationId: 'c4', workingDirectory: '/tmp' };
    const lowered = internals.buildQueryOptions({ ...base, autoCompact: { enabled: true, thresholdPct: 40 } }, undefined, { persistent: true });
    expect((lowered['env'] as Record<string, string>)['CLAUDE_AUTOCOMPACT_PCT_OVERRIDE']).toBe('40');

    const off = internals.buildQueryOptions({ ...base, autoCompact: { enabled: false } }, undefined, { persistent: true });
    expect((off['settings'] as Record<string, unknown>)['autoCompactEnabled']).toBe(false);
    expect((off['env'] as Record<string, string>)['DISABLE_AUTO_COMPACT']).toBe('1');

    const untouched = internals.buildQueryOptions(base, undefined, { persistent: true });
    expect((untouched['env'] as Record<string, string>)['CLAUDE_AUTOCOMPACT_PCT_OVERRIDE']).toBeUndefined();
    expect((untouched['settings'] as Record<string, unknown> | undefined)?.['autoCompactEnabled']).toBeUndefined();
  });

  it('declares native compaction with instructions', () => {
    expect(provider.capabilities()).toMatchObject({ conversationCompact: true, compactInstructions: true });
  });
});

describe('compactSummaryText', () => {
  it('keeps the summary, not the scratch analysis', async () => {
    const { compactSummaryText } = await import('../src/providers/claude-agent/ClaudeAgentProvider.js');
    expect(compactSummaryText('<analysis>\nthinking\n</analysis>\n\n<summary>\n1. Goal: X\n</summary>')).toBe('1. Goal: X');
    expect(compactSummaryText('<analysis>scratch</analysis>\nPlain summary')).toBe('Plain summary');
    expect(compactSummaryText('Just text')).toBe('Just text');
  });
});
