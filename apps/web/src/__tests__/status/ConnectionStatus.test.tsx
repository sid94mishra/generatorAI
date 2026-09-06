// ────────────────────────────────────────────────────────────────
// ConnectionStatus — review 5.7 / plan item 10.
//
// The gap-detection machinery (store field, recordGap, resume logic) was fully
// built and the badge that surfaces it had exactly one importer: this file.
// These tests pin (a) the badge itself, (b) that clicking it refetches and
// clears the gap, and (c) that the component is actually mounted in the app
// header — the assertion that fails if it is unwired again.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConnectionStatus, summarizeConnections } from '@/components/status/ConnectionStatus.js';
import { Header } from '@/components/layout/Header.js';
import { renderWithProviders } from '../helpers/renderWithProviders.js';
import { useConnectionStore } from '@/stores/connectionStore.js';

/** A connection row with the N4 gap fields defaulted — most cases don't set them. */
function conn(over: {
  state: 'connected' | 'reconnecting' | 'disconnected';
  lastEventTime?: number | null;
  eventsReceived?: number;
  unrecoverableEvents?: number;
  lastGapAt?: number | null;
}) {
  return {
    lastEventTime: Date.now(),
    eventsReceived: 0,
    unrecoverableEvents: 0,
    lastGapAt: null,
    ...over,
  };
}

describe('ConnectionStatus', () => {
  beforeEach(() => {
    // Reset connection store state
    useConnectionStore.setState({ connections: {} });
  });

  it('renders disconnected state when no connection exists', () => {
    renderWithProviders(<ConnectionStatus sessionId="unknown-session" />);
    expect(screen.getByText(/disconnected/i)).toBeDefined();
    expect(screen.getByTestId('connection-status').dataset['state']).toBe('disconnected');
  });

  it('renders connected state', () => {
    useConnectionStore.setState({
      connections: {
        's1': conn({ state: 'connected', eventsReceived: 5 }),
      },
    });
    renderWithProviders(<ConnectionStatus sessionId="s1" />);
    expect(screen.getByText(/^connected/i)).toBeDefined();
    expect(screen.getByTestId('connection-status').dataset['state']).toBe('connected');
  });

  it('renders reconnecting state', () => {
    useConnectionStore.setState({
      connections: {
        's1': conn({ state: 'reconnecting' }),
      },
    });
    renderWithProviders(<ConnectionStatus sessionId="s1" />);
    expect(screen.getByText(/reconnecting/i)).toBeDefined();
    expect(screen.getByTestId('connection-status').dataset['state']).toBe('reconnecting');
  });

  it('is silent while healthy when asked to be (the header mode)', () => {
    useConnectionStore.setState({
      connections: { s1: conn({ state: 'connected', eventsReceived: 3 }) },
    });
    renderWithProviders(<ConnectionStatus quietWhenHealthy />);
    expect(screen.queryByTestId('connection-status')).toBeNull();
  });

  it('aggregate mode ignores never-opened scopes but reports a real drop', () => {
    expect(
      summarizeConnections(
        [
          conn({ state: 'disconnected', eventsReceived: 0 }),
          conn({ state: 'connected', eventsReceived: 4 }),
        ],
        false,
      ).state,
    ).toBe('connected');
    expect(
      summarizeConnections(
        [conn({ state: 'connected', eventsReceived: 4 }), conn({ state: 'reconnecting' })],
        false,
      ).state,
    ).toBe('reconnecting');
    expect(
      summarizeConnections(
        [conn({ state: 'reconnecting' }), conn({ state: 'disconnected', eventsReceived: 9 })],
        false,
      ).state,
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

  it('shows the gap badge naming when events went missing, even while connected', () => {
    const gapAt = new Date(2026, 8, 3, 10, 42, 7).getTime();
    useConnectionStore.setState({
      connections: {
        s1: conn({ state: 'connected', eventsReceived: 40, unrecoverableEvents: 3, lastGapAt: gapAt }),
      },
    });
    renderWithProviders(<ConnectionStatus quietWhenHealthy />);
    const badge = screen.getByTestId('connection-gap-badge');
    expect(badge.textContent).toContain('Events may be missing');
    expect(badge.textContent).toContain(new Date(gapAt).toLocaleTimeString());
    expect(badge.getAttribute('aria-label')).toContain('3 events could not be recovered');
  });

  it('clicking the badge refetches every query and clears the recorded gap', async () => {
    useConnectionStore.setState({
      connections: {
        s1: conn({ state: 'connected', eventsReceived: 40, unrecoverableEvents: 2, lastGapAt: Date.now() }),
      },
    });
    const { queryClient } = renderWithProviders(<ConnectionStatus />);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    fireEvent.click(screen.getByTestId('connection-gap-badge'));

    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(useConnectionStore.getState().connections['s1']!.unrecoverableEvents).toBe(0),
    );
    expect(useConnectionStore.getState().connections['s1']!.lastGapAt).toBeNull();
    await waitFor(() => expect(screen.queryByTestId('connection-gap-badge')).toBeNull());
  });

  it('clearGap scoped to one session leaves the others alone', () => {
    useConnectionStore.setState({
      connections: {
        a: conn({ state: 'connected', unrecoverableEvents: 1, lastGapAt: 1 }),
        b: conn({ state: 'connected', unrecoverableEvents: 4, lastGapAt: 2 }),
      },
    });
    useConnectionStore.getState().clearGap('a');
    expect(useConnectionStore.getState().connections['a']!.unrecoverableEvents).toBe(0);
    expect(useConnectionStore.getState().connections['b']!.unrecoverableEvents).toBe(4);
  });

  it('is mounted in the app header, so a gap is visible on every page', () => {
    useConnectionStore.setState({
      connections: {
        s1: conn({ state: 'reconnecting', eventsReceived: 12, unrecoverableEvents: 1, lastGapAt: Date.now() }),
      },
    });
    renderWithProviders(<Header sidebarOpen onToggleSidebar={() => {}} />, {
      initialEntries: ['/projects'],
    });
    const header = screen.getByTestId('app-header');
    expect(header.querySelector('[data-testid="connection-status"]')).not.toBeNull();
    expect(header.querySelector('[data-testid="connection-gap-badge"]')).not.toBeNull();
    expect(header.textContent).toContain('Reconnecting');
  });
});
