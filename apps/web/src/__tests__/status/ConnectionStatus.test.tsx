// ────────────────────────────────────────────────────────────────
// ConnectionStatus tests — ≥6 test cases
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { screen } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { ConnectionStatus } from '@/components/status/ConnectionStatus.js';
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
  });

  it('renders connected state', () => {
    useConnectionStore.setState({
      connections: {
        's1': conn({ state: 'connected', eventsReceived: 5 }),
      },
    });
    renderWithProviders(<ConnectionStatus sessionId="s1" />);
    expect(screen.getByText(/connected/i)).toBeDefined();
  });

  it('renders reconnecting state', () => {
    useConnectionStore.setState({
      connections: {
        's1': conn({ state: 'reconnecting' }),
      },
    });
    renderWithProviders(<ConnectionStatus sessionId="s1" />);
    expect(screen.getByText(/reconnecting/i)).toBeDefined();
  });

  it('shows green dot for connected', () => {
    useConnectionStore.setState({
      connections: {
        's1': conn({ state: 'connected', eventsReceived: 10 }),
      },
    });
    renderWithProviders(<ConnectionStatus sessionId="s1" />);
    const dot = document.querySelector('.bg-green-500');
    expect(dot).toBeTruthy();
  });

  it('shows yellow dot for reconnecting', () => {
    useConnectionStore.setState({
      connections: {
        's1': conn({ state: 'reconnecting' }),
      },
    });
    renderWithProviders(<ConnectionStatus sessionId="s1" />);
    const dot = document.querySelector('.bg-yellow-500') ?? document.querySelector('[class*="yellow"]');
    expect(dot).toBeTruthy();
  });

  it('shows red dot for disconnected', () => {
    useConnectionStore.setState({
      connections: {
        's1': conn({ state: 'disconnected', lastEventTime: 0 }),
      },
    });
    renderWithProviders(<ConnectionStatus sessionId="s1" />);
    const dot = document.querySelector('.bg-red-500') ?? document.querySelector('[class*="red"]');
    expect(dot).toBeTruthy();
  });
});
