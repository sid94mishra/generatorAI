// ────────────────────────────────────────────────────────────────
// ConnectionStatus tests — ≥6 test cases
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { screen } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { ConnectionStatus } from '@/components/status/ConnectionStatus.js';
import { renderWithProviders } from '../helpers/renderWithProviders.js';
import { useConnectionStore } from '@/stores/connectionStore.js';

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
        's1': { state: 'connected', lastEventTime: Date.now(), eventsReceived: 5 },
      },
    });
    renderWithProviders(<ConnectionStatus sessionId="s1" />);
    expect(screen.getByText(/connected/i)).toBeDefined();
  });

  it('renders reconnecting state', () => {
    useConnectionStore.setState({
      connections: {
        's1': { state: 'reconnecting', lastEventTime: Date.now(), eventsReceived: 0 },
      },
    });
    renderWithProviders(<ConnectionStatus sessionId="s1" />);
    expect(screen.getByText(/reconnecting/i)).toBeDefined();
  });

  it('shows green dot for connected', () => {
    useConnectionStore.setState({
      connections: {
        's1': { state: 'connected', lastEventTime: Date.now(), eventsReceived: 10 },
      },
    });
    renderWithProviders(<ConnectionStatus sessionId="s1" />);
    const dot = document.querySelector('.bg-green-500');
    expect(dot).toBeTruthy();
  });

  it('shows yellow dot for reconnecting', () => {
    useConnectionStore.setState({
      connections: {
        's1': { state: 'reconnecting', lastEventTime: Date.now(), eventsReceived: 0 },
      },
    });
    renderWithProviders(<ConnectionStatus sessionId="s1" />);
    const dot = document.querySelector('.bg-yellow-500') ?? document.querySelector('[class*="yellow"]');
    expect(dot).toBeTruthy();
  });

  it('shows red dot for disconnected', () => {
    useConnectionStore.setState({
      connections: {
        's1': { state: 'disconnected', lastEventTime: 0, eventsReceived: 0 },
      },
    });
    renderWithProviders(<ConnectionStatus sessionId="s1" />);
    const dot = document.querySelector('.bg-red-500') ?? document.querySelector('[class*="red"]');
    expect(dot).toBeTruthy();
  });
});
