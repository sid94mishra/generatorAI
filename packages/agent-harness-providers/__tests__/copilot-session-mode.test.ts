import { describe, it, expect, vi } from 'vitest';
import { CopilotProvider } from '../src/providers/copilot/CopilotProvider.js';

/**
 * PLN-01 regression guard for the session-mode handshake.
 *
 * The Copilot CLI builds its tool list from the *session* mode and strips
 * `exit_plan_mode` whenever that mode is not `plan`. `session.send({ agentMode })`
 * is display metadata only — it records the mode on the user message and never
 * moves the session. Sending a plan-mode turn with `agentMode` alone therefore
 * leaves the model without the very tool it is instructed to call, and no plan
 * gate ever opens.
 *
 * These tests pin the fix: `session.rpc.mode.set` is issued before the turn.
 */

function makeSession() {
  const modeSet = vi.fn().mockResolvedValue(undefined);
  const send = vi.fn().mockResolvedValue('m1');
  return {
    modeSet,
    send,
    session: {
      send,
      on: vi.fn().mockReturnValue(() => {}),
      rpc: { mode: { set: modeSet } },
    },
  };
}

/** Installs a fake session directly so no CLI process is needed. */
function providerWithSession(session: unknown): CopilotProvider {
  const provider = new CopilotProvider({ verbose: false });
  (provider as unknown as { conversations: Map<string, unknown> }).conversations.set('c1', session);
  return provider;
}

describe('CopilotProvider session mode (PLN-01)', () => {
  it('sets the session mode before sending a plan-mode turn', async () => {
    const { session, modeSet, send } = makeSession();
    const provider = providerWithSession(session);

    await provider.sendPrompt('c1', 'draft a plan', undefined, { agentMode: 'plan' });

    expect(modeSet).toHaveBeenCalledWith({ mode: 'plan' });
    expect(send).toHaveBeenCalledTimes(1);
    // Ordering matters: the CLI resolves tools when the turn starts.
    expect(modeSet.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]!);
  });

  it('does not re-issue mode.set for consecutive turns in the same mode', async () => {
    const { session, modeSet } = makeSession();
    const provider = providerWithSession(session);

    await provider.sendPrompt('c1', 'one', undefined, { agentMode: 'plan' });
    await provider.sendPrompt('c1', 'two', undefined, { agentMode: 'plan' });

    expect(modeSet).toHaveBeenCalledTimes(1);
  });

  it('switches the session mode when the turn mode changes', async () => {
    const { session, modeSet } = makeSession();
    const provider = providerWithSession(session);

    await provider.sendPrompt('c1', 'plan it', undefined, { agentMode: 'plan' });
    await provider.sendPrompt('c1', 'build it', undefined, { agentMode: 'interactive' });

    expect(modeSet).toHaveBeenNthCalledWith(1, { mode: 'plan' });
    expect(modeSet).toHaveBeenNthCalledWith(2, { mode: 'interactive' });
  });

  it('leaves the session alone when the caller supplies no mode', async () => {
    const { session, modeSet, send } = makeSession();
    const provider = providerWithSession(session);

    await provider.sendPrompt('c1', 'hello');

    expect(modeSet).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('still sends the turn when mode.set is unsupported by the CLI', async () => {
    const { session, send } = makeSession();
    session.rpc.mode.set = vi.fn().mockRejectedValue(new Error('Method not found'));
    const provider = providerWithSession(session);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      provider.sendPrompt('c1', 'draft a plan', undefined, { agentMode: 'plan' }),
    ).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('retries mode.set after a failure rather than caching the failed mode', async () => {
    const { session } = makeSession();
    const modeSet = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue(undefined);
    session.rpc.mode.set = modeSet;
    const provider = providerWithSession(session);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await provider.sendPrompt('c1', 'one', undefined, { agentMode: 'plan' });
    await provider.sendPrompt('c1', 'two', undefined, { agentMode: 'plan' });

    expect(modeSet).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
