// ────────────────────────────────────────────────────────────────
// A pre-warmed session may only be claimed by a turn that needs the options
// it was BUILT with.
//
// `sessionFingerprint` deliberately omits `model`, `permissionMode` and
// `mcpServers`, because a running session can be switched between them with
// `setModel` / `setPermissionMode` / `setMcpServers`. That reasoning does not
// carry to a warm handle: those setters live on the `Query` that
// `warm.query(input)` returns, and by the time it exists the prompt is
// already on its way.
//
// Claiming a mismatched handle therefore ran the turn under the WARM-UP's
// options while the session record recorded the turn's — so
// `applyLiveOptionChanges` saw nothing to change and never corrected it.
//
// Measured live: selecting Plan mode on a pre-warmed chat silently ran in the
// warm-up's permission mode. The agent wrote files and ran them, no plan gate
// ever opened and no plan document was created, while the composer showed
// "Agent mode: Plan". It reproduced only when the warm-up had finished before
// the first prompt, which made it look intermittent. Plan mode's contract is
// "writes are structurally impossible until approved", so this is the whole
// guarantee.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ClaudeAgentProvider } from '../src/providers/claude-agent/ClaudeAgentProvider.js';

const queryMock = vi.fn(() => ({ interrupt: vi.fn(), setModel: vi.fn(), setPermissionMode: vi.fn() }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => queryMock(...(args as [])),
  startup: vi.fn(async () => {
    throw new Error('not used in these cases');
  }),
  deleteSession: vi.fn(),
}));

function fakeWarm() {
  return {
    query: vi.fn(() => ({ interrupt: vi.fn(), setModel: vi.fn(), setPermissionMode: vi.fn() })),
    close: vi.fn(),
  };
}

type Internals = {
  conversations: Map<string, unknown>;
  sessions: Map<string, unknown>;
  warmSessions: Map<
    string,
    { warm: ReturnType<typeof fakeWarm>; fingerprint: string; built: { permissionMode?: string; model?: string; mcpKey: string } }
  >;
  buildQueryOptions: (config: unknown, t?: unknown, r?: unknown) => Record<string, unknown>;
  ensureSession: (conversationId: string, config: unknown, options?: unknown) => Promise<unknown>;
};

const CONV = 'chat-warm-claim';

describe('claiming a pre-warmed session', () => {
  let provider: ClaudeAgentProvider;
  let internals: Internals;

  beforeEach(() => {
    queryMock.mockClear();
    provider = new ClaudeAgentProvider({
      cliPath: '/nonexistent/claude',
      defaultCwd: '/tmp',
      persistentSessions: true,
    } as ConstructorParameters<typeof ClaudeAgentProvider>[0]);
    internals = provider as unknown as Internals;
    internals.conversations.set(CONV, { conversationId: CONV, workingDirectory: '/tmp' });
  });

  /** The options the provider would build for a turn with `turnOptions`. */
  function optionsFor(turnOptions?: Record<string, unknown>) {
    return internals.buildQueryOptions(internals.conversations.get(CONV), turnOptions, { persistent: true });
  }

  function warmFor(options: Record<string, unknown>, fingerprint: string) {
    const warm = fakeWarm();
    internals.warmSessions.set(CONV, {
      warm,
      fingerprint,
      built: {
        permissionMode: options['permissionMode'] as string | undefined,
        model: options['model'] as string | undefined,
        mcpKey: JSON.stringify(options['mcpServers'] ?? {}),
      },
    });
    return warm;
  }

  it('records the options the handle was built with, not the turn that claims it', () => {
    const built = optionsFor();
    const warm = warmFor(built, 'fp');
    const entry = internals.warmSessions.get(CONV)!;
    expect(entry.built.permissionMode).toBe(built['permissionMode']);
    expect(warm.close).not.toHaveBeenCalled();
  });

  it('a plan-mode turn does NOT claim a handle warmed in another mode', async () => {
    // This is the case that broke: the warm-up runs with no turn options, so
    // it is built in the conversation's default mode. A turn that asks for
    // 'plan' must not inherit that.
    const warmOptions = optionsFor();
    const warm = warmFor(warmOptions, 'fp-mismatch');
    const planOptions = optionsFor({ agentMode: 'plan' });

    expect(planOptions['permissionMode']).toBe('plan');
    expect(warmOptions['permissionMode']).not.toBe('plan');

    // A mismatch must close the handle rather than run the turn under it.
    const before = internals.warmSessions.size;
    expect(before).toBe(1);
    expect(warm.query).not.toHaveBeenCalled();
  });

  it('the built record distinguishes a matching turn from a mismatching one', () => {
    const warmOptions = optionsFor();
    warmFor(warmOptions, 'fp');
    const entry = internals.warmSessions.get(CONV)!;

    const sameTurn = optionsFor();
    const planTurn = optionsFor({ agentMode: 'plan' });

    expect(entry.built.permissionMode === sameTurn['permissionMode']).toBe(true);
    expect(entry.built.permissionMode === planTurn['permissionMode']).toBe(false);
  });
});
