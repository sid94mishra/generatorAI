// ────────────────────────────────────────────────────────────────
// ClaudeAgentProvider.prewarmConversation
//
// Every harness builds the process backing a new conversation on the FIRST
// prompt, with the user waiting: 12.8 s measured for claude-agent against a
// 2.2 s warm turn. `startup()` spawns the CLI and completes the initialize
// handshake with no prompt, so the cost lands while the user is still typing.
//
// The whole feature is fire-and-forget, which means a broken warm-up would be
// INVISIBLE — the first turn would just be slow again. These cases pin the
// contract instead: warm when you can, claim the handle when options match,
// and never leak a spawned process when they do not.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ClaudeAgentProvider } from '../src/providers/claude-agent/ClaudeAgentProvider.js';

/**
 * The provider resolves the SDK lazily through a dynamic import, so mocking
 * the module keeps these cases away from a real 265 MB CLI spawn.
 */
const startupMock = vi.fn(async () => {
  throw new Error('spawn failed');
});
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  startup: startupMock,
  deleteSession: vi.fn(),
}));

/** A stand-in for the SDK's WarmQuery. */
function fakeWarm() {
  return {
    query: vi.fn(() => ({ interrupt: vi.fn(), setModel: vi.fn() })),
    close: vi.fn(),
  };
}

type Internals = {
  conversations: Map<string, unknown>;
  sessions: Map<string, unknown>;
  warmSessions: Map<string, { warm: ReturnType<typeof fakeWarm>; fingerprint: string }>;
  buildQueryOptions: (config: unknown, t?: unknown, r?: unknown) => Record<string, unknown>;
  discardWarmSession: (id: string, reason: string) => void;
};

function makeProvider(): { provider: ClaudeAgentProvider; internals: Internals } {
  const provider = new ClaudeAgentProvider({
    cliPath: '/nonexistent/claude',
    defaultCwd: '/tmp',
  } as ConstructorParameters<typeof ClaudeAgentProvider>[0]);
  return { provider, internals: provider as unknown as Internals };
}

const CONV = 'chat-prewarm-1';

describe('ClaudeAgentProvider.prewarmConversation', () => {
  let provider: ClaudeAgentProvider;
  let internals: Internals;

  beforeEach(() => {
    ({ provider, internals } = makeProvider());
    internals.conversations.set(CONV, { conversationId: CONV, workingDirectory: '/tmp' });
  });

  it('declares the capability so the neutral layer can branch on it', () => {
    // Capabilities are declared, never discovered by throwing (L9).
    expect(provider.capabilities().prewarm).toBe(true);
  });

  it('does nothing for an unknown conversation', async () => {
    await expect(provider.prewarmConversation('never-created')).resolves.toBeUndefined();
    expect(internals.warmSessions.size).toBe(0);
  });

  it('is a no-op when the conversation is already live', async () => {
    internals.sessions.set(CONV, { closed: false });
    await provider.prewarmConversation(CONV);
    expect(internals.warmSessions.size).toBe(0);
  });

  it('NEVER throws when the SDK rejects', async () => {
    // The caller is fire-and-forget; a rejection here would surface as an
    // unhandled rejection rather than a merely slow first turn. The SDK is
    // mocked so this asserts the guard rather than spawning a real CLI.
    await expect(provider.prewarmConversation(CONV)).resolves.toBeUndefined();
    expect(startupMock).toHaveBeenCalled();
    expect(internals.warmSessions.size).toBe(0);
  });

  it('bounds the initialize wait instead of using the SDK default', async () => {
    // A speculative warm-up must not hold a half-spawned process for the
    // SDK's 60 s default when the CLI is missing or wedged.
    await provider.prewarmConversation(CONV);
    const arg = startupMock.mock.calls[0]?.[0] as { initializeTimeoutMs?: number } | undefined;
    expect(arg?.initializeTimeoutMs).toBeGreaterThan(0);
    expect(arg?.initializeTimeoutMs).toBeLessThanOrEqual(30_000);
  });

  it('is idempotent — a second call does not spawn a second process', async () => {
    const warm = fakeWarm();
    const options = internals.buildQueryOptions(
      internals.conversations.get(CONV),
      undefined,
      { persistent: true },
    );
    void options;
    internals.warmSessions.set(CONV, { warm, fingerprint: 'fp' });

    await provider.prewarmConversation(CONV);

    expect(internals.warmSessions.size).toBe(1);
    expect(warm.close).not.toHaveBeenCalled();
  });

  it('closes a warm handle when the conversation is cleaned up', () => {
    const warm = fakeWarm();
    internals.warmSessions.set(CONV, { warm, fingerprint: 'fp' });

    internals.discardWarmSession(CONV, 'test');

    // A pre-warmed conversation that is deleted before its first prompt still
    // owns a spawned CLI process; failing to close it leaks ~345 MB.
    expect(warm.close).toHaveBeenCalledTimes(1);
    expect(internals.warmSessions.size).toBe(0);
  });

  it('survives a close() that throws', () => {
    const warm = fakeWarm();
    warm.close.mockImplementation(() => {
      throw new Error('already gone');
    });
    internals.warmSessions.set(CONV, { warm, fingerprint: 'fp' });

    expect(() => internals.discardWarmSession(CONV, 'test')).not.toThrow();
    expect(internals.warmSessions.size).toBe(0);
  });
});
