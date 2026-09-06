// ────────────────────────────────────────────────────────────────
// Evicting, deleting or destroying a conversation must close its persistent
// SDK session — i.e. kill the ~230 MB `claude` CLI process it owns.
//
// `cleanupConversation` is the single funnel behind the idle sweep, the LRU
// cap, `deleteConversation` and `destroyConversation`. It cleared every
// bookkeeping map and discarded a WARM handle, but never looked at
// `this.sessions`, the map that owns the live process. `closeSession` was only
// reachable from `stop()`, an active turn's close handle, an unacknowledged
// interrupt and an options change — none of which run for an idle chat.
//
// Measured live (2026-09-05): eight ~230 MB `claude.exe` children of the
// server alive 80 minutes after spawn, with a 30-minute idle window. The
// `maxLiveConversations` cap bounded `conversations`, not `sessions`, so the
// process count was unbounded.
//
// Each test here was run against the unfixed `cleanupConversation` first and
// failed on `query.close` not being called — the predicted reason.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ClaudeAgentProvider } from '../src/providers/claude-agent/ClaudeAgentProvider.js';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(() => ({ interrupt: vi.fn(), setModel: vi.fn(), setPermissionMode: vi.fn(), close: vi.fn() })),
  startup: vi.fn(async () => {
    throw new Error('not used in these cases');
  }),
  deleteSession: vi.fn(),
}));

interface FakeSession {
  conversationId: string;
  query: { close: ReturnType<typeof vi.fn> };
  input: { end: ReturnType<typeof vi.fn> };
  fingerprint: string;
  liveModel: string | undefined;
  livePermissionMode: string | undefined;
  liveMcpKey: string;
  sdkSessionId: string | undefined;
  closed: boolean;
  reader: Promise<void>;
}

type Internals = {
  conversations: Map<string, { conversationId: string; workingDirectory: string; lastUsedAt?: number }>;
  sessions: Map<string, FakeSession>;
  activeQueries: Map<string, unknown>;
  sessionIdleMs: number;
  maxLiveConversations: number;
  sweepIdleConversations: () => void;
  evictLruConversation: (except?: string) => boolean;
  cleanupConversation: (conversationId: string) => void;
};

function fakeSession(conversationId: string): FakeSession {
  return {
    conversationId,
    query: { close: vi.fn(async () => undefined) },
    input: { end: vi.fn() },
    fingerprint: 'fp',
    liveModel: undefined,
    livePermissionMode: undefined,
    liveMcpKey: '{}',
    sdkSessionId: undefined,
    closed: false,
    reader: Promise.resolve(),
  };
}

/** `closeSession` is async and fire-and-forget from cleanup; let it settle. */
const settle = () => new Promise<void>((r) => setImmediate(r));

describe('persistent session lifecycle on cleanup', () => {
  let provider: ClaudeAgentProvider;
  let internals: Internals;

  beforeEach(() => {
    provider = new ClaudeAgentProvider({
      cliPath: '/nonexistent/claude',
      defaultCwd: '/tmp',
      persistentSessions: true,
      sessionIdleMs: 60_000,
      maxLiveConversations: 4,
    } as ConstructorParameters<typeof ClaudeAgentProvider>[0]);
    internals = provider as unknown as Internals;
  });

  afterEach(async () => {
    await provider.shutdown();
  });

  function liveConversation(id: string, lastUsedAt: number): FakeSession {
    internals.conversations.set(id, { conversationId: id, workingDirectory: '/tmp', lastUsedAt });
    const session = fakeSession(id);
    internals.sessions.set(id, session);
    return session;
  }

  it('deleteConversation closes the live session and removes it from the session map', async () => {
    const session = liveConversation('c-delete', Date.now());

    await provider.deleteConversation('c-delete');
    await settle();

    expect(session.query.close).toHaveBeenCalledTimes(1);
    expect(session.input.end).toHaveBeenCalledTimes(1);
    expect(internals.sessions.has('c-delete')).toBe(false);
    expect(internals.conversations.has('c-delete')).toBe(false);
  });

  it('destroyConversation (the archive path) closes the live session too', async () => {
    const session = liveConversation('c-archive', Date.now());

    await provider.destroyConversation('c-archive');
    await settle();

    expect(session.query.close).toHaveBeenCalledTimes(1);
    expect(internals.sessions.has('c-archive')).toBe(false);
  });

  it('the idle sweep closes the process of an idle conversation and leaves a fresh one alone', async () => {
    const stale = liveConversation('c-stale', Date.now() - 10 * 60_000);
    const fresh = liveConversation('c-fresh', Date.now());

    internals.sweepIdleConversations();
    await settle();

    expect(stale.query.close).toHaveBeenCalledTimes(1);
    expect(internals.sessions.has('c-stale')).toBe(false);
    expect(fresh.query.close).not.toHaveBeenCalled();
    expect(internals.sessions.has('c-fresh')).toBe(true);
  });

  it('the idle sweep never closes a conversation with a turn in flight', async () => {
    const busy = liveConversation('c-busy', Date.now() - 10 * 60_000);
    internals.activeQueries.set('c-busy', { abortController: new AbortController() });

    internals.sweepIdleConversations();
    await settle();

    expect(busy.query.close).not.toHaveBeenCalled();
    expect(internals.sessions.has('c-busy')).toBe(true);
    internals.activeQueries.delete('c-busy');
  });

  it('LRU eviction closes the oldest process, so the live-session cap bounds processes, not just records', async () => {
    const oldest = liveConversation('c-old', Date.now() - 3_000);
    const newer = liveConversation('c-new', Date.now() - 1_000);

    const evicted = internals.evictLruConversation();
    await settle();

    expect(evicted).toBe(true);
    expect(oldest.query.close).toHaveBeenCalledTimes(1);
    expect(internals.sessions.has('c-old')).toBe(false);
    expect(newer.query.close).not.toHaveBeenCalled();
  });

  it('after a full sweep the session map is empty — no process outlives its record', async () => {
    for (let i = 0; i < 5; i += 1) liveConversation(`c-${i}`, Date.now() - 10 * 60_000);
    expect(internals.sessions.size).toBe(5);

    internals.sweepIdleConversations();
    await settle();

    expect(internals.conversations.size).toBe(0);
    expect(internals.sessions.size).toBe(0);
  });
});
