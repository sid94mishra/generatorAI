// ────────────────────────────────────────────────────────────────
// The rewind menu is a destructive control, so what it OFFERS matters as
// much as what it does: three separate intentions (code, conversation, both),
// each spelled out, and nothing at all while a turn is in flight — the server
// answers 409 CHAT_BUSY there, and a control that fails on press teaches the
// user to distrust it.
//
// The other half pinned here is the prompt hand-back: a conversation rewind
// parks the erased prompt in `rewindStore` for the composer to offer again.
// Auto-sending it would make the destructive option unreviewable, and NOT
// restoring it makes the user retype what they just deleted.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/components/Toast.js', () => ({ toast: vi.fn() }));

import { renderWithProviders } from '../helpers/renderWithProviders.js';
import { RewindMenu } from '@/components/chat/RewindMenu.js';
import { useRewindStore } from '@/stores/rewindStore.js';
import { ApiError } from '@/platform/apiFetch.js';
import { toast } from '@/components/Toast.js';

function renderMenu(options: {
  canRewind?: boolean;
  rewindChat?: ReturnType<typeof vi.fn>;
} = {}) {
  const rewindChat =
    options.rewindChat ??
    vi.fn(async () => ({
      chatId: 'chat-1',
      turnId: 'turn-7',
      scope: 'all' as const,
      prompt: 'rename the module',
      conversation: 'native' as const,
      files: { mounts: [{ alias: '.', ok: true }], restored: 2, deleted: 1, skipped: 0 },
    }));
  const platform = { rewindChat } as never;
  const result = renderWithProviders(
    <RewindMenu chatId="chat-1" turnId="turn-7" canRewind={options.canRewind ?? true} />,
    { platform },
  );
  return { ...result, rewindChat };
}

beforeEach(() => {
  useRewindStore.setState({ pending: null });
  vi.mocked(toast).mockClear();
});

afterEach(() => {
  cleanup();
});

describe('RewindMenu', () => {
  it('offers the three scopes, each with its own explanation', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByTestId('rewind-button'));

    const all = await screen.findByTestId('rewind-option-all');
    expect(all).toHaveTextContent('Restore code and conversation');
    expect(all).toHaveTextContent(/Files go back to how they were before this message/);

    const conversation = screen.getByTestId('rewind-option-conversation');
    expect(conversation).toHaveTextContent('Restore conversation only');

    const code = screen.getByTestId('rewind-option-code');
    expect(code).toHaveTextContent('Restore code only');
    expect(code).toHaveTextContent(/including through shell commands/);
  });

  it('sends the picked scope with the turn id', async () => {
    const user = userEvent.setup();
    const { rewindChat } = renderMenu();

    await user.click(screen.getByTestId('rewind-button'));
    await user.click(await screen.findByTestId('rewind-option-code'));

    await waitFor(() => {
      expect(rewindChat).toHaveBeenCalledWith('chat-1', { turnId: 'turn-7', scope: 'code' });
    });
  });

  it('hands the erased prompt back to the composer — but never for a code-only rewind', async () => {
    const user = userEvent.setup();
    const { unmount } = renderMenu();

    await user.click(screen.getByTestId('rewind-button'));
    await user.click(await screen.findByTestId('rewind-option-all'));
    await waitFor(() => {
      expect(useRewindStore.getState().pending?.prompt).toBe('rename the module');
    });

    unmount();
    useRewindStore.setState({ pending: null });

    const user2 = userEvent.setup();
    renderMenu();
    await user2.click(screen.getByTestId('rewind-button'));
    await user2.click(await screen.findByTestId('rewind-option-code'));
    await waitFor(() => {
      expect(vi.mocked(toast)).toHaveBeenCalled();
    });
    // Files moved; the conversation still holds the prompt, so re-offering it
    // would duplicate a message that was never removed.
    expect(useRewindStore.getState().pending).toBeNull();
  });

  it('reports the restored file counts and the synthetic-provider caveat', async () => {
    const user = userEvent.setup();
    renderMenu({
      rewindChat: vi.fn(async () => ({
        chatId: 'chat-1',
        turnId: 'turn-7',
        scope: 'all' as const,
        conversation: 'synthetic' as const,
        files: { mounts: [{ alias: '.', ok: true }], restored: 2, deleted: 1, skipped: 0 },
      })),
    });

    await user.click(screen.getByTestId('rewind-button'));
    await user.click(await screen.findByTestId('rewind-option-all'));

    await waitFor(() => {
      expect(vi.mocked(toast)).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'success',
          title: 'Rewound to before this message',
          description: expect.stringContaining('2 files restored, 1 deleted'),
        }),
      );
    });
    expect(vi.mocked(toast).mock.calls[0]?.[0]?.description).toContain(
      'does not support native rewind',
    );
  });

  it('says why a refused rewind changed nothing (409 CHAT_BUSY)', async () => {
    const user = userEvent.setup();
    renderMenu({
      rewindChat: vi.fn(async () => {
        throw new ApiError(409, 'CHAT_BUSY', 'A turn is already running');
      }),
    });

    await user.click(screen.getByTestId('rewind-button'));
    await user.click(await screen.findByTestId('rewind-option-all'));

    await waitFor(() => {
      expect(vi.mocked(toast)).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'error', title: 'Nothing was rewound' }),
      );
    });
    expect(useRewindStore.getState().pending).toBeNull();
  });

  it('is inert while a turn is in flight', async () => {
    const user = userEvent.setup();
    const { rewindChat } = renderMenu({ canRewind: false });

    const button = screen.getByTestId('rewind-button');
    expect(button).toBeDisabled();

    await user.click(button);
    expect(screen.queryByTestId('rewind-option-all')).toBeNull();
    expect(rewindChat).not.toHaveBeenCalled();
  });
});
