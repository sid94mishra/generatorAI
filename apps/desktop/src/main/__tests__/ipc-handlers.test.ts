// ipc.ts's G-03/G-04/G-05 IPC handlers, exercised directly against the
// registered handler functions (the sender-trust check itself is
// `ipc-guard.test.ts`'s job — this file mocks it away to a passthrough so it
// can focus on the handler logic: argument validation, delegation to
// backend-switcher/updater/attention-state, and the rebuilds a change needs).

import { describe, expect, it, vi } from 'vitest';
import { IPC, IPC_EVENT, type DesktopUpdateState } from '../../shared/ipc';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const handlers = vi.hoisted(() => new Map<string, Handler>());

const state = vi.hoisted(() => ({
  mainWindow: null as { isDestroyed: () => boolean; webContents: { send: ReturnType<typeof vi.fn> } } | null,
  listServers: vi.fn(() => [] as unknown[]),
  probeKnownServers: vi.fn(async (list: unknown[]) => list),
  switchServerById: vi.fn(async () => undefined),
  promptForRemoteServer: vi.fn(async () => undefined),
  onServersChangedListener: null as (() => void) | null,
  onRendererResetListener: null as (() => void) | null,
  getUpdateState: vi.fn((): DesktopUpdateState => ({ status: 'idle', currentVersion: '1.0.0' })),
  installUpdate: vi.fn(async () => 'quitting'),
  setUpdateWatch: vi.fn(),
  clearUpdateWatchers: vi.fn(),
  onUpdateStateChangeListener: null as ((s: unknown) => void) | null,
  refreshTrayMenu: vi.fn(),
  setAttention: vi.fn(),
  clearAttention: vi.fn(),
  updateMenuState: vi.fn(),
  applyMenuPush: vi.fn(),
  setUnsavedWork: vi.fn(),
  markRendererReady: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getName: () => 'GeneratorAI', getVersion: () => '1.0.0', isPackaged: false },
  dialog: { showMessageBox: vi.fn(async () => ({ response: 1 })) },
  shell: { showItemInFolder: vi.fn(), openPath: vi.fn() },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false, themeSource: 'system' },
  BrowserWindow: { getFocusedWindow: () => null, fromWebContents: () => null },
}));

vi.mock('../ipc-guard', () => ({
  createIpcGuard: () => ({
    guardedHandle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
    assertTrusted: () => undefined,
    channels: () => [...handlers.keys()],
  }),
  defaultFromWebContents: () => null,
}));

vi.mock('../window-manager', () => ({
  getWindowManager: () => ({
    getMainWindow: () => state.mainWindow,
    getAppUrl: () => 'http://127.0.0.1:3100',
    refreshTitleBarTheme: vi.fn(),
    markRendererReady: state.markRendererReady,
    onRendererReset: (listener: () => void) => {
      state.onRendererResetListener = listener;
      return () => (state.onRendererResetListener = null);
    },
  }),
}));

vi.mock('../server-manager', () => ({
  getServerManager: () => ({ url: 'http://127.0.0.1:3100', on: vi.fn(), getStatus: () => ({ state: 'ready' }) }),
}));

vi.mock('../browser-host', () => ({ getNativeBrowserHost: () => ({ isEnabled: () => false }) }));

vi.mock('../backend-switcher', () => ({
  connectionState: () => ({ serverMode: 'embedded', connections: [], activeConnectionId: null }),
  listServers: state.listServers,
  switchServerById: state.switchServerById,
  promptForRemoteServer: state.promptForRemoteServer,
  onServersChanged: (listener: () => void) => {
    state.onServersChangedListener = listener;
    return () => (state.onServersChangedListener = null);
  },
}));

vi.mock('../server-probe', () => ({ probeKnownServers: state.probeKnownServers }));
vi.mock('../paths', () => ({ resolvePaths: () => ({ dataDir: '/tmp/data' }) }));
vi.mock('../config', () => ({ loadSettings: () => ({}), saveSettings: vi.fn() }));
vi.mock('../menu', () => ({ updateMenuState: state.updateMenuState, applyMenuPush: state.applyMenuPush }));
vi.mock('../tray', () => ({ refreshTrayMenu: state.refreshTrayMenu }));
vi.mock('../attention-state', () => ({ setAttention: state.setAttention, clearAttention: state.clearAttention }));
vi.mock('../updater', () => ({
  getUpdateState: state.getUpdateState,
  installUpdate: state.installUpdate,
  setUpdateWatch: state.setUpdateWatch,
  clearUpdateWatchers: state.clearUpdateWatchers,
  onUpdateStateChange: (listener: (s: unknown) => void) => {
    state.onUpdateStateChangeListener = listener;
    return () => (state.onUpdateStateChangeListener = null);
  },
}));
vi.mock('../unsaved-work', () => ({ setUnsavedWork: state.setUnsavedWork }));
vi.mock('../logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), getLogFilePath: () => null } }));
vi.mock('../pairing-gate', () => ({
  admitPairingRequest: vi.fn(),
  PairingGate: class {
    check() {
      return { ok: true };
    }
  },
}));
vi.mock('../settings-schema', () => ({
  isRendererSettingKey: () => false,
  validateSettingValue: () => ({ ok: false, error: 'unknown' }),
}));

async function setup() {
  handlers.clear();
  vi.clearAllMocks();
  state.mainWindow = { isDestroyed: () => false, webContents: { send: vi.fn() } };
  state.listServers.mockReturnValue([]);
  state.probeKnownServers.mockImplementation(async (list: unknown[]) => list);
  state.getUpdateState.mockReturnValue({ status: 'idle', currentVersion: '1.0.0' });
  const { registerIpc } = await import('../ipc');
  registerIpc('standalone');
  return handlers;
}

function callFrom(h: Map<string, Handler>, event: unknown, channel: string, ...args: unknown[]) {
  const handler = h.get(channel);
  if (!handler) throw new Error(`no handler registered for ${channel}`);
  return handler(event, ...args);
}

function call(h: Map<string, Handler>, channel: string, ...args: unknown[]) {
  return callFrom(h, {}, channel, ...args);
}

const attentionPatch = (over: Partial<{ needsYou: number; running: number }> = {}) => ({
  needsYou: 2,
  running: 3,
  byEntity: {
    chat: { needsYou: 2, running: 1 },
    workflow_run: { needsYou: 0, running: 2 },
    automation_execution: { needsYou: 0, running: 0 },
  },
  ...over,
});

describe('IPC.getServers / switchServer / addServer (G-03)', () => {
  it("getServers returns backend-switcher's list with main-process reachability (R6)", async () => {
    const h = await setup();
    const known = { id: 'embedded', label: 'This computer', url: 'http://127.0.0.1:3100', kind: 'embedded' as const, active: true };
    state.listServers.mockReturnValue([known]);
    state.probeKnownServers.mockResolvedValue([{ ...known, status: 'connected', latencyMs: 4 }]);
    expect(await call(h, IPC.getServers)).toEqual([{ ...known, status: 'connected', latencyMs: 4 }]);
    expect(state.probeKnownServers).toHaveBeenCalledWith([known]);
  });

  it('switchServer delegates to switchServerById for a valid string id', async () => {
    const h = await setup();
    await call(h, IPC.switchServer, 'srv-1');
    expect(state.switchServerById).toHaveBeenCalledWith('srv-1');
  });

  it('switchServer ignores a non-string or empty id', async () => {
    const h = await setup();
    await call(h, IPC.switchServer, 42);
    await call(h, IPC.switchServer, '');
    await call(h, IPC.switchServer, undefined);
    expect(state.switchServerById).not.toHaveBeenCalled();
  });

  it('addServer opens the prompt', async () => {
    const h = await setup();
    await call(h, IPC.addServer);
    expect(state.promptForRemoteServer).toHaveBeenCalled();
  });

  it('a servers change reaches the renderer, the native Server menu and the tray (R23)', async () => {
    await setup();
    expect(state.onServersChangedListener).toBeTypeOf('function');
    state.onServersChangedListener!();
    expect(state.mainWindow!.webContents.send).toHaveBeenCalledWith(IPC_EVENT.serversChanged);
    expect(state.updateMenuState).toHaveBeenCalledWith({});
    expect(state.refreshTrayMenu).toHaveBeenCalled();
  });

  it('does not send to a destroyed window, but still rebuilds the menu', async () => {
    await setup();
    state.mainWindow!.isDestroyed = () => true;
    state.onServersChangedListener!();
    expect(state.mainWindow!.webContents.send).not.toHaveBeenCalled();
    expect(state.updateMenuState).toHaveBeenCalledWith({});
  });
});

describe('IPC.getUpdateState / installUpdate / watchUpdates (G-04)', () => {
  it('getUpdateState returns the updater module state verbatim', async () => {
    const h = await setup();
    const ready: DesktopUpdateState = { status: 'ready', currentVersion: '1.0.0', nextVersion: '1.1.0', downloadedVersion: '1.1.0' };
    state.getUpdateState.mockReturnValue(ready);
    expect(await call(h, IPC.getUpdateState)).toEqual(ready);
  });

  it('installUpdate delegates to the updater module', async () => {
    const h = await setup();
    await call(h, IPC.installUpdate);
    expect(state.installUpdate).toHaveBeenCalled();
  });

  it('relays onUpdateStateChange to the renderer as IPC_EVENT.updateStateChanged', async () => {
    await setup();
    const next = { status: 'downloading', currentVersion: '1.0.0', percent: 10 };
    state.onUpdateStateChangeListener!(next);
    expect(state.mainWindow!.webContents.send).toHaveBeenCalledWith(IPC_EVENT.updateStateChanged, next);
  });

  it('watchUpdates records subscriptions per sender and ignores non-boolean payloads (R3)', async () => {
    const h = await setup();
    await callFrom(h, { sender: { id: 7 } }, IPC.watchUpdates, true);
    await callFrom(h, { sender: { id: 7 } }, IPC.watchUpdates, false);
    await callFrom(h, { sender: { id: 7 } }, IPC.watchUpdates, 'yes');
    expect(state.setUpdateWatch.mock.calls).toEqual([
      [7, true],
      [7, false],
    ]);
  });
});

describe('IPC.setMenuState (G-05, R16)', () => {
  it('accepts null (no snapshot yet) and hands it to attention-state', async () => {
    const h = await setup();
    await call(h, IPC.setMenuState, { attention: null });
    expect(state.setAttention).toHaveBeenCalledWith(null);
  });

  it('hands a well-formed AttentionCounts to attention-state, never to the menu', async () => {
    const h = await setup();
    await call(h, IPC.setMenuState, { sidebarOpen: true, attention: attentionPatch({ needsYou: 4 }) });
    expect(state.setAttention).toHaveBeenCalledWith(expect.objectContaining({ needsYou: 4 }));
    expect(state.applyMenuPush).toHaveBeenCalledWith({ sidebarOpen: true });
    expect(state.updateMenuState).not.toHaveBeenCalled();
  });

  it('clamps counts to [0, 999] and fills in missing byEntity rows as zero', async () => {
    const h = await setup();
    await call(h, IPC.setMenuState, {
      attention: { needsYou: -5, running: 5000, byEntity: { chat: { needsYou: 1, running: 2 } } },
    });
    expect(state.setAttention).toHaveBeenCalledWith({
      needsYou: 0,
      running: 999,
      byEntity: {
        chat: { needsYou: 1, running: 2 },
        workflow_run: { needsYou: 0, running: 0 },
        automation_execution: { needsYou: 0, running: 0 },
      },
    });
  });

  it('drops a malformed attention value (no byEntity)', async () => {
    const h = await setup();
    await call(h, IPC.setMenuState, { attention: { needsYou: 1, running: 1 } });
    expect(state.setAttention).not.toHaveBeenCalled();
  });

  it('does not touch the counts when the patch carries no attention key at all', async () => {
    const h = await setup();
    await call(h, IPC.setMenuState, { sidebarOpen: true });
    expect(state.setAttention).not.toHaveBeenCalled();
  });

  it('still validates the pre-existing fields (sidebarOpen, recent, hasUnsavedWork)', async () => {
    const h = await setup();
    await call(h, IPC.setMenuState, {
      sidebarOpen: true,
      rightPaneOpen: false,
      hasUnsavedWork: true,
      recent: [{ label: 'Home', route: '/' }, { notAnEntry: true }],
    });
    expect(state.setUnsavedWork).toHaveBeenCalledWith(true);
    expect(state.applyMenuPush).toHaveBeenCalledWith({
      sidebarOpen: true,
      rightPaneOpen: false,
      recent: [{ label: 'Home', route: '/' }],
    });
  });
});

describe('renderer reset (R8, R3)', () => {
  it('clears the attention counts and the update subscriptions', async () => {
    await setup();
    expect(state.onRendererResetListener).toBeTypeOf('function');
    state.onRendererResetListener!();
    expect(state.clearAttention).toHaveBeenCalled();
    expect(state.clearUpdateWatchers).toHaveBeenCalled();
  });
});
