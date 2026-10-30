// ────────────────────────────────────────────────────────────────
// useServers / switchServer / addServer — the G-03 web hooks.
//
// Pinned: desktop takes the IPC list with the status main probed; plain web
// falls back to the client-runtime catalog and probes only its own origin
// (P1-review P2-R6); `onChanged` invalidates the query on desktop only;
// switching/adding delegate to the right side depending on platform.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopServerEntry } from '@generatorai/shared';

const state = vi.hoisted(() => ({
  isDesktop: false,
  serversAvailable: true,
  list: vi.fn(async (): Promise<DesktopServerEntry[]> => []),
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

import { THIS_ORIGIN_SERVER_ID, addServer, serverKeys, switchServer, useServers } from '@/hooks/serverQueries.js';

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
  it('is undefined until loaded, then the desktop entries with the status main probed (R6)', async () => {
    state.isDesktop = true;
    const entries: DesktopServerEntry[] = [
      { id: 'embedded', label: 'This computer (GeneratorAI)', url: 'http://127.0.0.1:3100', kind: 'embedded', active: true, status: 'connected', serverName: 'Mine', latencyMs: 3 },
      { id: 'srv-1', label: 'studio', url: 'https://studio.example:3100', kind: 'remote', active: false, status: 'offline' },
    ];
    state.list.mockResolvedValue(entries);

    const { result } = renderHook(() => useServers(), { wrapper });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data).toHaveLength(2));

    expect(result.current.data).toEqual(entries);
    // The renderer never probes on desktop: its CSP only allows its own origin.
    expect(probeServer).not.toHaveBeenCalled();
  });

  it('surfaces a failed desktop list as a query error, not an empty list (R23)', async () => {
    state.isDesktop = true;
    state.list.mockRejectedValue(new Error('ipc failed'));
    const { result } = renderHook(() => useServers(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("off desktop: the catalog, probing only the entry on this page's own origin (R6)", async () => {
    state.isDesktop = false;
    const here = window.location.origin;
    webAuth.listConnections.mockReturnValue([
      { serverId: 'srv-here', label: 'This server', endpoint: here, kind: 'local' },
      { serverId: 'srv-a', label: 'Home server', endpoint: 'https://home.example', kind: 'remote' },
    ]);
    webAuth.getActiveConnection.mockReturnValue({ serverId: 'srv-here' });

    const { result } = renderHook(() => useServers(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(result.current.data![0]).toMatchObject({ id: 'srv-here', active: true, status: 'connected', serverName: 'Studio' });
    expect(result.current.data![1]).toEqual({
      id: 'srv-a',
      label: 'Home server',
      url: 'https://home.example',
      kind: 'remote',
      active: false,
      status: 'unknown',
    });
    expect(probeServer).toHaveBeenCalledTimes(1);
    expect(probeServer).toHaveBeenCalledWith(here, { timeoutMs: 2500, expectedServerId: 'srv-here' });
    expect(state.list).not.toHaveBeenCalled();
  });

  it("off desktop: the page's own server is listed (probed, active) when the catalog has no entry for it", async () => {
    state.isDesktop = false;
    const here = window.location.origin;
    webAuth.listConnections.mockReturnValue([{ serverId: 'srv-a', label: 'Home server', endpoint: 'https://home.example', kind: 'remote' }]);
    const { result } = renderHook(() => useServers(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(result.current.data![0]).toMatchObject({
      id: THIS_ORIGIN_SERVER_ID,
      label: 'Studio',
      url: here,
      active: true,
      status: 'connected',
      serverName: 'Studio',
    });
    expect(result.current.data![1]).toMatchObject({ id: 'srv-a', active: false, status: 'unknown' });
    expect(probeServer).toHaveBeenCalledWith(here, { timeoutMs: 2500 });
  });

  it("off desktop: an unreachable own server keeps its host as the label and says so", async () => {
    state.isDesktop = false;
    probeServer.mockResolvedValue({ status: 'offline' });
    const { result } = renderHook(() => useServers(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data![0]).toMatchObject({ label: new URL(window.location.origin).host, status: 'offline', active: true });
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
