// ────────────────────────────────────────────────────────────────
// The sidebar's live parts (P3-04): the connection footer that replaced the
// Header's ConnectionStatus badge (review 5.7 / plan item 10 — the gap
// notice must stay wired), and the Needs you / Running lists, which render
// nothing until the attention feed has loaded (D-36).
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionSnapshot } from '@generatorai/shared';
import { renderWithProviders } from '../helpers/renderWithProviders.js';
import { useConnectionStore } from '@/stores/connectionStore.js';
import { summarizeConnections } from '@/hooks/useConnectionSummary.js';

const attention = vi.hoisted(() => ({ data: undefined as AttentionSnapshot | undefined }));
vi.mock('@/hooks/attentionQueries.js', () => ({
  useAttention: () => ({ data: attention.data, error: null, isLoading: !attention.data, refetch: async () => {} }),
  useAttentionCounts: () => attention.data?.counts,
}));
vi.mock('@/hooks/serverQueries.js', () => ({
  useServers: () => ({
    data: [{ id: 'embedded', label: 'This computer', url: 'http://127.0.0.1:3100', kind: 'embedded', active: true, status: 'connected' }],
  }),
  switchServer: vi.fn(),
  addServer: vi.fn(),
  canAddServer: () => false,
}));

import { ConnectedSidebar } from '@/app/shell/ConnectedSidebar.js';

function conn(over: {
  state: 'connected' | 'reconnecting' | 'disconnected';
  eventsReceived?: number;
  unrecoverableEvents?: number;
  lastGapAt?: number | null;
}) {
  return { lastEventTime: Date.now(), eventsReceived: 0, unrecoverableEvents: 0, lastGapAt: null, ...over };
}

/** The attention feed's clock: the elapsed time below is read against it, never the wall clock. */
const NOW = Date.parse('2026-09-03T10:42:00.000Z');

const SNAPSHOT: AttentionSnapshot = {
  seq: 1,
  generatedAt: new Date(NOW).toISOString(),
  needsYou: [
    {
      key: 'chat:c1:i1',
      entity: 'chat',
      entityId: 'c1',
      title: 'Fix flaky checkout test',
      href: '/chats/c1',
      state: 'needs_you',
      since: new Date(NOW).toISOString(),
      ask: { kind: 'tool_permission', id: 'i1', summary: 'Allow git push?', actions: ['allow_once', 'deny'] },
      stoppable: true,
    },
  ],
  running: [
    {
      key: 'chat:c2',
      entity: 'chat',
      entityId: 'c2',
      title: 'Memory leak in worker',
      href: '/chats/c2',
      state: 'running',
      since: new Date(NOW - 38_000).toISOString(),
      stoppable: true,
    },
  ],
  counts: {
    needsYou: 1,
    running: 1,
    byEntity: {
      chat: { needsYou: 1, running: 1 },
      workflow_run: { needsYou: 0, running: 0 },
      automation_execution: { needsYou: 0, running: 0 },
    },
  },
};

beforeEach(() => {
  useConnectionStore.setState({ connections: {} });
  attention.data = undefined;
});

describe('summarizeConnections', () => {
  it('aggregate mode ignores never-opened scopes but reports a real drop', () => {
    expect(summarizeConnections([conn({ state: 'disconnected' }), conn({ state: 'connected', eventsReceived: 4 })], false).state).toBe(
      'connected',
    );
    expect(summarizeConnections([conn({ state: 'connected', eventsReceived: 4 }), conn({ state: 'reconnecting' })], false).state).toBe(
      'reconnecting',
    );
    expect(
      summarizeConnections([conn({ state: 'reconnecting' }), conn({ state: 'disconnected', eventsReceived: 9 })], false).state,
    ).toBe('disconnected');
    const sum = summarizeConnections(
      [
        conn({ state: 'connected', eventsReceived: 1, unrecoverableEvents: 2, lastGapAt: 1000 }),
        conn({ state: 'connected', eventsReceived: 1, unrecoverableEvents: 3, lastGapAt: 5000 }),
      ],
      false,
    );
    expect(sum.unrecoverable).toBe(5);
    expect(sum.lastGapAt).toBe(5000);
  });
});

describe('ConnectedSidebar', () => {
  it('shows the connection and the active server in the footer', () => {
    useConnectionStore.setState({ connections: { s1: conn({ state: 'reconnecting', eventsReceived: 3 }) } });
    renderWithProviders(<ConnectedSidebar layout="native" />, { initialEntries: ['/projects'] });
    const footer = screen.getByTestId('sidebar-connection');
    expect(footer.textContent).toContain('Reconnecting…');
    expect(footer.textContent).toContain('local:3100');
    expect(screen.getByTestId('sidebar-server-switcher').textContent).toContain('This computer');
    expect(screen.getByTestId('sidebar-nav-projects').getAttribute('aria-current')).toBe('page');
  });

  it('names missing events and refetches from history on Refresh', async () => {
    const gapAt = new Date(2026, 8, 3, 10, 42, 7).getTime();
    useConnectionStore.setState({
      connections: { s1: conn({ state: 'connected', eventsReceived: 40, unrecoverableEvents: 3, lastGapAt: gapAt }) },
    });
    const { queryClient } = renderWithProviders(<ConnectedSidebar layout="native" />);
    const notice = screen.getByTestId('connection-gap-notice');
    expect(notice.textContent).toContain('3 events may be missing');
    expect(notice.textContent).toContain(new Date(gapAt).toLocaleTimeString());
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    fireEvent.click(screen.getByTestId('connection-gap-badge'));
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useConnectionStore.getState().connections['s1']!.unrecoverableEvents).toBe(0));
    await waitFor(() => expect(screen.queryByTestId('connection-gap-notice')).toBeNull());
  });

  it('renders no live lists until the attention feed has loaded', () => {
    renderWithProviders(<ConnectedSidebar layout="native" />);
    expect(screen.queryByTestId('sidebar-needs-you')).toBeNull();
    expect(screen.queryByTestId('sidebar-running')).toBeNull();
  });

  it('lists Needs you and Running items with their asks and elapsed time', () => {
    // Only Date is faked: the elapsed time is exact however long a loaded
    // machine takes between building the snapshot and rendering it.
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    try {
      attention.data = SNAPSHOT;
      renderWithProviders(<ConnectedSidebar layout="native" />);
      const needs = screen.getByTestId('sidebar-needs-you');
      expect(within(needs).getByRole('link', { name: /Fix flaky checkout test/ }).getAttribute('href')).toBe('/chats/c1');
      expect(needs.textContent).toContain('Allow git push?');
      const running = screen.getByTestId('sidebar-running');
      expect(within(running).getByTestId('sidebar-running-row').textContent).toMatch(/Memory leak in worker0:38/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the strip layout drops search and the switcher (the title strip holds them)', () => {
    renderWithProviders(<ConnectedSidebar layout="strip" />);
    expect(screen.queryByTestId('sidebar-search')).toBeNull();
    expect(screen.queryByTestId('sidebar-server-switcher')).toBeNull();
    expect(screen.getByTestId('sidebar-new-chat')).toBeTruthy();
  });
});
