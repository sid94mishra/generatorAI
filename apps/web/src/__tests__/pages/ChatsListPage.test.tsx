// ────────────────────────────────────────────────────────────────
// ChatsListPage — bulk delete failures (P2-R36).
//
// A partial failure closes the dialog, says how many failed, and leaves only
// the failed chats selected, so a retry does not send ids that are already
// gone (they would come back as NOT_FOUND). A request that fails outright
// says so and keeps the selection for a retry.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ChatListItem, ChatListPage, IPlatformClient } from '@generatorai/shared';

vi.mock('@/platform/muxStream.js', () => ({
  openMultiplexedStream: () => ({ close: () => {} }),
}));
// jsdom has no layout, so the virtualizer would render no rows: render them all.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 76 })),
    getTotalSize: () => count * 76,
    measureElement: () => {},
    options: { scrollMargin: 0 },
  }),
}));
vi.mock('@/components/ui/primitives/sonner.js', () => ({
  Toaster: () => null,
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() }),
}));
vi.mock('@/components/chat/CreateChatDialog.js', () => ({ CreateChatDialog: () => null }));

import { PlatformContext } from '@/providers/PlatformProvider.js';
import { ChatsListPage } from '@/pages/ChatsListPage.js';
import { toast } from '@/components/ui/primitives/sonner.js';
import { MockPlatformClient } from '../helpers/MockPlatformClient.js';

const row = (id: string): ChatListItem =>
  ({
    id,
    name: `Chat ${id}`,
    sessionId: `s-${id}`,
    status: 'active',
    tags: [],
    createdAt: '2026-09-26T09:00:00.000Z',
    updatedAt: '2026-09-26T09:00:00.000Z',
    summary: { lastActivityAt: '2026-09-26T10:00:00.000Z' },
  }) as unknown as ChatListItem;

const page = (ids: string[]): ChatListPage => ({
  items: ids.map(row),
  nextCursor: null,
  total: ids.length,
  counts: { all: ids.length, active: ids.length, archived: 0 },
});

function renderPage(platform: MockPlatformClient) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PlatformContext.Provider value={platform as unknown as IPlatformClient}>
        <MemoryRouter initialEntries={['/chats']}>
          <ChatsListPage />
        </MemoryRouter>
      </PlatformContext.Provider>
    </QueryClientProvider>,
  );
}

async function selectAllAndDelete() {
  fireEvent.click(await screen.findByRole('button', { name: 'Select' }));
  expect(screen.getByText('3 selected')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Delete Selected' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete 3' }));
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('ChatsListPage bulk delete (P2-R36)', () => {
  it('after a partial failure closes the dialog, reports it, and keeps only the failed chats selected', async () => {
    const platform = new MockPlatformClient();
    platform.listChats.mockResolvedValue(page(['a', 'b', 'c']));
    platform.deleteChats.mockResolvedValueOnce({
      succeeded: ['a', 'b'],
      failed: [{ id: 'c', code: 'CONFLICT', message: 'Chat c is running' }],
    });
    renderPage(platform);

    await selectAllAndDelete();
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Failed to delete 1 of 3 chats', {
      description: 'Chat c is running',
    }));
    expect(platform.deleteChats).toHaveBeenCalledWith(['a', 'b', 'c']);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    // The retry sends only the chat that failed.
    fireEvent.click(screen.getByRole('button', { name: 'Delete Selected' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete 1' }));
    await waitFor(() => expect(platform.deleteChats).toHaveBeenLastCalledWith(['c']));
    // A full success leaves selection mode.
    await waitFor(() => expect(screen.queryByText(/selected/)).not.toBeInTheDocument());
  });

  it('when nothing went through, says why and keeps the selection', async () => {
    const platform = new MockPlatformClient();
    platform.listChats.mockResolvedValue(page(['a', 'b', 'c']));
    platform.deleteChats.mockRejectedValueOnce(new Error('Network down'));
    renderPage(platform);

    await selectAllAndDelete();
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Delete failed: Network down'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByText('3 selected')).toBeInTheDocument();
  });
});
