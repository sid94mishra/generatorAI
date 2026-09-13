// ────────────────────────────────────────────────────────────────
// ClaudeAgentProvider — conversation fork and rewind through the SDK's
// `forkSession`.
//
// `forkSession(id, { upToMessageId })` copies the session file through an
// assistant message uuid under FRESH uuids. A fork registers the copy as a
// new conversation; a rewind re-points the existing conversation at the copy
// and closes the live CLI process that still holds the old history. Both
// hand back an old→new anchor map aligned by assistant-message position.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ClaudeAgentProvider } from '../src/providers/claude-agent/ClaudeAgentProvider.js';

const forkSession = vi.fn();
const getSessionMessages = vi.fn();

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(() => ({ interrupt: vi.fn(), setModel: vi.fn(), setPermissionMode: vi.fn(), close: vi.fn() })),
  startup: vi.fn(async () => {
    throw new Error('not used in these cases');
  }),
  deleteSession: vi.fn(),
  forkSession: (...args: unknown[]) => forkSession(...args),
  getSessionMessages: (...args: unknown[]) => getSessionMessages(...args),
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
  conversations: Map<string, { conversationId: string; workingDirectory: string; sdkSessionId?: string; lastUsedAt?: number }>;
  sessions: Map<string, FakeSession>;
  activeQueries: Map<string, unknown>;
  evictedSessionIds: Map<string, string>;
};

function fakeSession(conversationId: string, sdkSessionId: string): FakeSession {
  return {
    conversationId,
    query: { close: vi.fn(async () => undefined) },
    input: { end: vi.fn() },
    fingerprint: 'fp',
    liveModel: undefined,
    livePermissionMode: undefined,
    liveMcpKey: '{}',
    sdkSessionId,
    closed: false,
    reader: Promise.resolve(),
  };
}

const assistant = (uuid: string) => ({ type: 'assistant', uuid, session_id: 's', message: {}, parent_tool_use_id: null, parent_agent_id: null });
const user = (uuid: string) => ({ type: 'user', uuid, session_id: 's', message: {}, parent_tool_use_id: null, parent_agent_id: null });

describe('ClaudeAgentProvider branching', () => {
  let provider: ClaudeAgentProvider;
  let internals: Internals;

  beforeEach(() => {
    forkSession.mockReset();
    getSessionMessages.mockReset();
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

  it('declares native fork and rewind', () => {
    expect(provider.capabilities().conversationFork).toBe(true);
    expect(provider.capabilities().conversationRewind).toBe(true);
  });

  it('fork copies the transcript through the anchor into a new conversation and maps the anchors', async () => {
    await provider.createConversation({ conversationId: 'src', workingDirectory: '/tmp' });
    internals.conversations.get('src')!.sdkSessionId = 'sdk-src';
    forkSession.mockResolvedValue({ sessionId: 'sdk-fork' });
    getSessionMessages.mockImplementation(async (id: string) =>
      id === 'sdk-src'
        ? [user('u1'), assistant('a1'), user('u2'), assistant('a2'), user('u3'), assistant('a3')]
        : [user('x1'), assistant('b1'), user('x2'), assistant('b2')],
    );

    const r = await provider.forkConversation('src', {
      newConversationId: 'branch',
      throughAnchor: { kind: 'message', id: 'a2' },
      params: { conversationId: 'branch', workingDirectory: '/tmp' },
    });

    expect(forkSession).toHaveBeenCalledWith('sdk-src', { upToMessageId: 'a2' });
    expect(r.providerSessionId).toBe('sdk-fork');
    expect(r.anchorMap).toEqual({ a1: 'b1', a2: 'b2' });
    expect(provider.getProviderSessionId('branch')).toBe('sdk-fork');
    expect(provider.getProviderSessionId('src')).toBe('sdk-src');
  });

  it('fork from a persisted session id when the source is not in memory', async () => {
    forkSession.mockResolvedValue({ sessionId: 'sdk-fork2' });
    getSessionMessages.mockResolvedValue([]);
    const r = await provider.forkConversation('gone', {
      newConversationId: 'branch2',
      sourceProviderSessionId: 'sdk-persisted',
      params: { conversationId: 'branch2', workingDirectory: '/tmp' },
    });
    expect(forkSession).toHaveBeenCalledWith('sdk-persisted', {});
    expect(r.providerSessionId).toBe('sdk-fork2');
    expect(r.anchorMap).toBeUndefined();
  });

  it('rewind re-points the conversation at the fork and closes the live process', async () => {
    await provider.createConversation({ conversationId: 'c', workingDirectory: '/tmp' });
    internals.conversations.get('c')!.sdkSessionId = 'sdk-c';
    const live = fakeSession('c', 'sdk-c');
    internals.sessions.set('c', live);
    forkSession.mockResolvedValue({ sessionId: 'sdk-c2' });
    getSessionMessages.mockImplementation(async (id: string) =>
      id === 'sdk-c' ? [user('u1'), assistant('a1'), user('u2'), assistant('a2')] : [user('v1'), assistant('z1')],
    );

    const r = await provider.rewindConversation('c', {
      keepThrough: { kind: 'message', id: 'a1' },
      dropFrom: { kind: 'message', id: 'a2' },
      droppedTurns: 1,
      params: { conversationId: 'c', workingDirectory: '/tmp' },
    });

    expect(forkSession).toHaveBeenCalledWith('sdk-c', { upToMessageId: 'a1' });
    expect(r.providerSessionId).toBe('sdk-c2');
    expect(r.anchorMap).toEqual({ a1: 'z1' });
    expect(internals.conversations.get('c')!.sdkSessionId).toBe('sdk-c2');
    expect(live.query.close).toHaveBeenCalledTimes(1);
    expect(internals.sessions.has('c')).toBe(false);
  });

  it('rewinding to before the first turn forgets the session id so the next prompt starts cold', async () => {
    await provider.createConversation({ conversationId: 'c', workingDirectory: '/tmp' });
    internals.conversations.get('c')!.sdkSessionId = 'sdk-c';
    const r = await provider.rewindConversation('c', { keepThrough: null, droppedTurns: 2, params: { conversationId: 'c', workingDirectory: '/tmp' } });
    expect(forkSession).not.toHaveBeenCalled();
    expect(r.providerSessionId).toBeUndefined();
    expect(internals.conversations.get('c')!.sdkSessionId).toBeUndefined();
  });

  it('refuses to rewind a conversation with a turn in flight', async () => {
    await provider.createConversation({ conversationId: 'busy', workingDirectory: '/tmp' });
    internals.activeQueries.set('busy', { abortController: new AbortController() });
    await expect(
      provider.rewindConversation('busy', { keepThrough: null, droppedTurns: 1, params: { conversationId: 'busy' } }),
    ).rejects.toThrow(/in flight/);
  });

  it('a rewind of a conversation not in memory records the fork for the next resume', async () => {
    forkSession.mockResolvedValue({ sessionId: 'sdk-cold2' });
    getSessionMessages.mockResolvedValue([]);
    const r = await provider.rewindConversation('cold', {
      providerSessionId: 'sdk-cold',
      keepThrough: { kind: 'message', id: 'a1' },
      droppedTurns: 1,
      params: { conversationId: 'cold' },
    });
    expect(r.providerSessionId).toBe('sdk-cold2');
    expect(internals.evictedSessionIds.get('cold')).toBe('sdk-cold2');
  });
});
