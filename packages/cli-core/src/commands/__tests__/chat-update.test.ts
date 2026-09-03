import { describe, expect, it, vi } from 'vitest';
import { chatCommands } from '../chat.js';
import type { CliContext } from '../../context/CliContext.js';

const CHAT_SUMMARY = { id: 'chat_1', name: 'test', status: 'active', createdAt: 0, updatedAt: 0 };

function fakeContext(update: ReturnType<typeof vi.fn>): CliContext {
  return {
    api: {
      chats: {
        list: vi.fn(async () => [CHAT_SUMMARY]),
        update,
      },
    },
  } as unknown as CliContext;
}

const updateCmd = chatCommands().find((c) => c.id === 'chat.update')!;

describe('chat update', () => {
  it('sends agentRef, the field the server actually reads, when --agent is given', async () => {
    const update = vi.fn(async () => CHAT_SUMMARY);
    const ctx = fakeContext(update);

    await updateCmd.handler(ctx, {
      args: { chat: 'chat_1' },
      flags: { agent: 'core:reviewer' },
    } as never);

    expect(update).toHaveBeenCalledWith('chat_1', { agentRef: 'core:reviewer' });
  });

  it("unbinds the agent with --agent none, sending agentRef: null rather than dropping it", async () => {
    const update = vi.fn(async () => CHAT_SUMMARY);
    const ctx = fakeContext(update);

    await updateCmd.handler(ctx, {
      args: { chat: 'chat_1' },
      flags: { agent: 'none' },
    } as never);

    expect(update).toHaveBeenCalledWith('chat_1', { agentRef: null });
  });

  it("also unbinds with --agent '' (the flag's own help text promises both spellings)", async () => {
    const update = vi.fn(async () => CHAT_SUMMARY);
    const ctx = fakeContext(update);

    await updateCmd.handler(ctx, {
      args: { chat: 'chat_1' },
      flags: { agent: '' },
    } as never);

    // Regression: this used to send `agentRef: ''` (a bare empty string
    // fails the `undefined`/`'none'` checks and falls through unchanged),
    // which is not what the flag's own description promises and is not
    // what actually clears the binding server-side.
    expect(update).toHaveBeenCalledWith('chat_1', { agentRef: null });
  });

  it('still refuses an update with nothing to change', async () => {
    const update = vi.fn();
    const ctx = fakeContext(update);

    await expect(
      updateCmd.handler(ctx, { args: { chat: 'chat_1' }, flags: {} } as never),
    ).rejects.toMatchObject({ code: 'USAGE' });
    expect(update).not.toHaveBeenCalled();
  });
});
