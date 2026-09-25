// ────────────────────────────────────────────────────────────────
// useServers / switchServer / addServer — the G-03 web hooks.
//
// Pinned: desktop picks the IPC list + probes it; plain web falls back to the
// client-runtime catalog; `onChanged` invalidates the query on desktop only;
// switching/adding delegate to the right side depending on platform.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  isDesktop: false,
  serversAvailable: true,
  list: vi.fn(async () => [] as Array<{ id: string; label: string; url: string; kind: 'embedded' | 'remote'; active: boolean }>),
  switchTo: vi.fn(),
  add: vi.fn(),
  onChangedHandlers: [] as Array<() => void>,
}));

vi.mock('@/lib/desktop.js', () => ({
  get isDesktop() {
    return state.isDesktop;
  },
  desktopServers: {
    isAvailable: () => state.serversAvailable,
    list: state.list,
    switchTo: state.switchTo,
    add: state.add,
    onChanged: (cb: () => void) => {
      state.onChangedHandlers.push(cb);
      return () => {
        state.onChangedHandlers = state.onChangedHandlers.filter((h) => h !== cb);
      };
    },
  },
}));

const webAuth = vi.hoisted(() => ({
  listConnections: vi.fn(() => [] as Array<{ serverId: string; label: string; endpoint: string; kind: 'local' | 'remote' }>),
  getActiveConnection: vi.fn(() => null as { serverId: string } | null),
  switchConnection: vi.fn(),
}));
vi.mock('@/platform/authRuntime.js', () => webAuth);

const probeServer = vi.hoisted(() => vi.fn());
vi.mock('@generatorai/client-runtime', () => ({ probeServer }));

import { addServer, serverKeys, switchServer, useServers } from '@/hooks/serverQueries.js';

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  state.isDesktop = false;
  state.serversAvailable = true;
  state.onChangedHandlers = [];
  state.list.mockReset().mockResolvedValue([]);
  state.switchTo.mockReset();
  state.add.mockReset();
  webAuth.listConnections.mockReset().mockReturnValue([]);
  webAuth.getActiveConnection.mockReset().mockReturnValue(null);
  webAuth.switchConnection.mockReset();
  probeServer.mockReset().mockResolvedValue({ status: 'connected', serverName: 'Studio', latencyMs: 12 });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useServers', () => {
  it('is undefined until loaded, then desktop entries probed for reachability', async () => {
    state.isDesktop = true;
    state.list.mockResolvedValue([
      { id: 'embedded', label: 'This computer (GeneratorAI)', url: 'http://127.0.0.1:3100', kind: 'embedded', active: true },
      { id: 'srv-1', label: 'studio', url: 'https://studio.example:3100', kind: 'remote', active: false },
    ]);

    const { result } = renderHook(() => useServers(), { wrapper });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data).toHaveLength(2));

    expect(result.current.data).toEqual([
      {
        id: 'embedded',
        label: 'This computer (GeneratorAI)',
        url: 'http://127.0.0.1:3100',
        kind: 'embedded',
        active: true,
        status: 'connected',
        serverName: 'Studio',
        latencyMs: 12,
      },
      {
        id: 'srv-1',
        label: 'studio',
        url: 'https://studio.example:3100',
        kind: 'remote',
        active: false,
        status: 'connected',
        serverName: 'Studio',
        latencyMs: 12,
      },
    ]);
    expect(probeServer).toHaveBeenCalledWith('http://127.0.0.1:3100', { timeoutMs: 2500 });
  });

  it('falls back to the client-runtime catalog off desktop', async () => {
    state.isDesktop = false;
    webAuth.listConnections.mockReturnValue([
      { serverId: 'srv-a', label: 'Home server', endpoint: 'https://home.example', kind: 'remote' },
    ]);
    webAuth.getActiveConnection.mockReturnValue({ serverId: 'srv-a' });

    const { result } = renderHook(() => useServers(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data![0]).toMatchObject({ id: 'srv-a', kind: 'remote', active: true, status: 'connected' });
    expect(state.list).not.toHaveBeenCalled();
  });

  it('reports offline without probing when a server has no url', async () => {
    state.isDesktop = true;
    state.list.mockResolvedValue([{ id: 'embedded', label: 'This computer', url: '', kind: 'embedded', active: true }]);
    const { result } = renderHook(() => useServers(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data![0]?.status).toBe('offline');
    expect(probeServer).not.toHaveBeenCalled();
  });

  it('invalidates the query when the desktop bridge reports a change', async () => {
    state.isDesktop = true;
    state.list.mockResolvedValue([]);
    renderHook(() => useServers(), { wrapper });
    await waitFor(() => expect(state.onChangedHandlers).toHaveLength(1));

    state.list.mockClear();
    act(() => state.onChangedHandlers[0]!());
    await waitFor(() => expect(state.list).toHaveBeenCalledTimes(1));
  });

  it('exposes a stable query key', () => {
    expect(serverKeys.all).toEqual(['desktop-servers']);
  });
});

describe('switchServer', () => {
  it('uses the desktop bridge when available', () => {
    state.isDesktop = true;
    switchServer('srv-1');
    expect(state.switchTo).toHaveBeenCalledWith('srv-1');
    expect(webAuth.switchConnection).not.toHaveBeenCalled();
  });

  it('falls back to the web connection catalog off desktop', () => {
    state.isDesktop = false;
    switchServer('srv-1');
    expect(webAuth.switchConnection).toHaveBeenCalledWith('srv-1');
    expect(state.switchTo).not.toHaveBeenCalled();
  });
});

describe('addServer', () => {
  it('opens the desktop prompt only on desktop', () => {
    state.isDesktop = true;
    addServer();
    expect(state.add).toHaveBeenCalled();

    state.add.mockClear();
    state.isDesktop = false;
    addServer();
    expect(state.add).not.toHaveBeenCalled();
  });
});
