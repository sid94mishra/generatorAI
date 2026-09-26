// ────────────────────────────────────────────────────────────────
// ChatsListPage (P3-07) — render smoke + bulk delete partial-failure
// (ported from the legacy page's test, P2-R36): a partial failure keeps
// only the failed rows selected, so a retry does not resend ids that are
// already gone.
// ────────────────────────────────────────────────────────────────

import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ChatListItem, ChatListPage, IPlatformClient } from '@generatorai/shared';

// Base UI (Menu, Checkbox) and DataTable touch a few DOM APIs happy-dom does
// not implement (same polyfill as __tests__/ui/Select.test.tsx).
beforeAll(() => {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  if (typeof proto['hasPointerCapture'] !== 'function') {
    proto['hasPointerCapture'] = () => false;
    proto['setPointerCapture'] = () => {};
    proto['releasePointerCapture'] = () => {};
  }
  if (typeof proto['scrollIntoView'] !== 'function') proto['scrollIntoView'] = () => {};
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

vi.mock('@/platform/muxStream.js', () => ({
  openMultiplexedStream: () => ({ close: () => {} }),
}));
// happy-dom has no layout, so the virtualizer would render no rows: render them all.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 44 })),
    getTotalSize: () => count * 44,
    measureElement: () => {},
  }),
}));
vi.mock('@/components/chat/CreateChatDialog.js', () => ({ CreateChatDialog: () => null }));

import { PlatformContext } from '@/providers/PlatformProvider.js';
import { ChatsListPage } from '@/features/chats/ChatsListPage.js';
import { MockPlatformClient } from '../../helpers/MockPlatformClient.js';

const row = (id: string): ChatListItem =>
  ({
    id,
    name: `Chat ${id}`,
    sessionId: `s-${id}`,
    projectId: 'p-1',
    status: 'active',
    tags: [],
    createdAt: '2026-09-26T09:00:00.000Z',
    updatedAt: '2026-09-26T09:00:00.000Z',
    summary: { lastActivityAt: '2026-09-26T10:00:00.000Z', agent: { ref: 'agent:a', name: 'Bug Fixer' } },
  }) as unknown as ChatListItem;

const page = (ids: string[]): ChatListPage => ({
  items: ids.map(row),
  nextCursor: null,
  total: ids.length,
  counts: { all: ids.length, active: ids.length, archived: 0 },
});

function renderPage(platform: MockPlatformClient) {
  platform.listProjects.mockResolvedValue([
    { id: 'p-1', name: 'Payments Service', settings: {}, rootPath: '/tmp/p', status: 'active', createdAt: new Date(), updatedAt: new Date() },
  ] as never);
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

afterEach(() => {
  vi.clearAllMocks();
});

describe('ChatsListPage', () => {
  it('renders the header, search, status tabs and a row with its resolved agent', async () => {
    const platform = new MockPlatformClient();
    platform.listChats.mockResolvedValue(page(['a']));
    renderPage(platform);

    expect(await screen.findByRole('heading', { name: 'Chats', level: 1 })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search chats')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Active/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Archived/ })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Chat a' })).toHaveAttribute('href', '/chats/a');
    // The Project/Changes columns are `hideBelow` (DataTable measures the real
    // table width, always 0 under happy-dom/jsdom's layout-free DOM) — verified
    // instead by the playwright-cli walkthrough and the board side-by-side.
    expect(await screen.findByText('Bug Fixer')).toBeInTheDocument();
  });

  it('after a partial bulk-delete failure keeps only the failed rows selected', async () => {
    const user = userEvent.setup();
    const platform = new MockPlatformClient();
    platform.listChats.mockResolvedValue(page(['a', 'b', 'c']));
    platform.deleteChats.mockResolvedValueOnce({
      succeeded: ['a', 'b'],
      failed: [{ id: 'c', code: 'CONFLICT', message: 'Chat c is running' }],
    });
    renderPage(platform);

    await user.click(await screen.findByRole('checkbox', { name: 'Select all' }));
    // BulkActionBar's count is a mono <span> plus a trailing " selected" text
    // node under the same parent — `getNodeText` only joins direct text-node
    // children, so an exact string match never sees "3 selected" as one run;
    // a function matcher against the parent's full textContent does.
    expect(await screen.findByText((_, el) => el?.textContent === '3 selected')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Delete$/ }));
    await user.click(await screen.findByRole('button', { name: 'Delete 3' }));

    await waitFor(() => expect(platform.deleteChats).toHaveBeenCalledWith(['a', 'b', 'c']));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(await screen.findByText((_, el) => el?.textContent === '1 selected')).toBeInTheDocument();

    // The retry sends only the chat that failed.
    await user.click(screen.getByRole('button', { name: /^Delete$/ }));
    await user.click(await screen.findByRole('button', { name: 'Delete 1' }));
    await waitFor(() => expect(platform.deleteChats).toHaveBeenLastCalledWith(['c']));
    await waitFor(() => expect(screen.queryByText(/selected/)).not.toBeInTheDocument());
  });

  it('row menu archives a chat via the platform client', async () => {
    const user = userEvent.setup();
    const platform = new MockPlatformClient();
    platform.listChats.mockResolvedValue(page(['a']));
    renderPage(platform);

    await user.click(await screen.findByRole('button', { name: 'More actions for Chat a' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    await waitFor(() => expect(platform.archiveChat).toHaveBeenCalledWith('a'));
  });
});
