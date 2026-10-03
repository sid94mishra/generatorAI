// listServers()/switchServerById() (G-03): the desktop shell is the source of
// truth for which servers exist, because localStorage is per-origin and
// cannot hold it once the window has navigated to a server's own origin. What
// matters here is that the list always includes "this computer", that
// `active` tracks the real connection state, and that changes are announced
// so the renderer's popover and the tray text can refresh.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  settings: {
    servers: { serverMode: 'embedded' as 'embedded' | 'remote', connections: [] as Array<{ id: string; url: string; label: string }>, activeConnectionId: null as string | null },
  },
  serverUrl: 'http://127.0.0.1:3100' as string | null,
}));

vi.mock('electron', () => ({
  app: { getName: () => 'GeneratorAI', quit: vi.fn() },
  dialog: { showMessageBox: vi.fn(async () => ({ response: 1 })) },
}));

vi.mock('../config', () => ({
  loadSettings: () => state.settings,
  saveSettings: (patch: { servers?: typeof state.settings.servers }) => {
    if (patch.servers) state.settings = { ...state.settings, servers: patch.servers };
  },
}));

vi.mock('../server-manager', () => ({
  getServerManager: () => ({
    get url() {
      return state.serverUrl;
    },
    start: vi.fn(async () => undefined),
  }),
}));

const wm = vi.hoisted(() => ({ repointMainWindow: vi.fn(), showError: vi.fn(), getMainWindow: vi.fn(() => null) }));
vi.mock('../window-manager', () => ({ getWindowManager: () => wm }));
vi.mock('../prompt-window', () => ({ showPrompt: vi.fn() }));
vi.mock('../logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  addRemoteConnection,
  connectionState,
  currentBackendLabel,
  forgetRemoteConnection,
  listServers,
  onServersChanged,
  switchServerById,
  switchToRemote,
} from '../backend-switcher';

beforeEach(() => {
  state.settings = { servers: { serverMode: 'embedded', connections: [], activeConnectionId: null } };
  state.serverUrl = 'http://127.0.0.1:3100';
  vi.clearAllMocks();
});

describe('listServers', () => {
  it('always includes the embedded entry, active when no remote is selected', () => {
    expect(listServers()).toEqual([
      { id: 'embedded', label: 'This computer', url: 'http://127.0.0.1:3100', kind: 'embedded', active: true },
    ]);
  });

  it('reflects the active remote connection', async () => {
    const connection = addRemoteConnection({ url: 'https://studio.example:3100', label: 'Studio' });
    // Adding a connection does not itself activate it.
    expect(connectionState().serverMode).toBe('embedded');
    await switchToRemote(connection.id);
    expect(listServers()).toEqual([
      { id: 'embedded', label: 'This computer', url: 'http://127.0.0.1:3100', kind: 'embedded', active: false },
      { id: connection.id, label: 'Studio', url: 'https://studio.example:3100', kind: 'remote', active: true },
    ]);
  });

  it('reports an empty url when the embedded server has not started', () => {
    state.serverUrl = null;
    expect(listServers()[0]).toMatchObject({ id: 'embedded', url: '' });
  });
});

describe('switchServerById', () => {
  it("routes 'embedded' to switchToEmbedded", async () => {
    const connection = addRemoteConnection({ url: 'https://studio.example:3100' });
    await switchToRemote(connection.id);
    expect(connectionState().serverMode).toBe('remote');

    await switchServerById('embedded');
    expect(connectionState().serverMode).toBe('embedded');
  });

  it('routes any other id to switchToRemote', async () => {
    const connection = addRemoteConnection({ url: 'https://studio.example:3100' });
    await switchServerById(connection.id);
    expect(connectionState()).toMatchObject({ serverMode: 'remote', activeConnectionId: connection.id });
  });

  it('ignores an unknown remote id rather than throwing', async () => {
    await expect(switchServerById('does-not-exist')).resolves.toBeUndefined();
    expect(connectionState().serverMode).toBe('embedded');
  });
});

describe('onServersChanged', () => {
  it('fires whenever the connection state is persisted', async () => {
    const listener = vi.fn();
    const unsubscribe = onServersChanged(listener);

    const connection = addRemoteConnection({ url: 'https://studio.example:3100' });
    expect(listener).toHaveBeenCalledTimes(1);

    await switchToRemote(connection.id);
    expect(listener).toHaveBeenCalledTimes(2);

    forgetRemoteConnection(connection.id);
    // forgetRemoteConnection persists once itself, then switches back to
    // embedded (a second persist) because the connection you were looking at
    // was just removed.
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(3);

    unsubscribe();
    listener.mockClear();
    addRemoteConnection({ url: 'https://other.example:3100' });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('currentBackendLabel', () => {
  it('reuses the embedded label helper', () => {
    expect(currentBackendLabel()).toBe('This computer');
  });

  it('is the remote label once switched', async () => {
    const connection = addRemoteConnection({ url: 'https://studio.example:3100', label: 'Studio' });
    await switchToRemote(connection.id);
    expect(currentBackendLabel()).toBe('Studio');
  });
});
