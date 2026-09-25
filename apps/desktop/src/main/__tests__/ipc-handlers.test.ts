// ipc.ts's new G-03/G-04/G-05 IPC handlers, exercised directly against the
// registered handler functions (the sender-trust check itself is
// `ipc-guard.test.ts`'s job — this file mocks it away to a passthrough so it
// can focus on the new handler logic: argument validation, delegation to
// backend-switcher/updater, and the tray/badge side effects G-05 wires
// through `setMenuState`).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC, IPC_EVENT, type UpdateState } from '../../shared/ipc';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const handlers = vi.hoisted(() => new Map<string, Handler>());

const state = vi.hoisted(() => ({
  mainWindow: null as { isDestroyed: () => boolean; webContents: { send: ReturnType<typeof vi.fn> } } | null,
  listServers: vi.fn(() => [] as unknown[]),
  switchServerById: vi.fn(async () => undefined),
  promptForRemoteServer: vi.fn(async () => undefined),
  onServersChangedListener: null as (() => void) | null,
  getUpdateState: vi.fn((): UpdateState => ({ status: 'idle', currentVersion: '1.0.0' })),
  installUpdate: vi.fn(async () => undefined),
  onUpdateStateChangeListener: null as ((s: unknown) => void) | null,
  refreshTrayMenu: vi.fn(),
  applyAttentionBadge: vi.fn(),
  updateMenuState: vi.fn(),
  setUnsavedWork: vi.fn(),
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

vi.mock('../paths', () => ({ resolvePaths: () => ({ dataDir: '/tmp/data' }) }));
vi.mock('../config', () => ({ loadSettings: () => ({}), saveSettings: vi.fn() }));
vi.mock('../platform', () => ({ windowChrome: () => ({}) }));
vi.mock('../menu', () => ({ updateMenuState: state.updateMenuState }));
vi.mock('../tray', () => ({ refreshTrayMenu: state.refreshTrayMenu }));
vi.mock('../badge', () => ({ applyAttentionBadge: state.applyAttentionBadge }));
vi.mock('../updater', () => ({
  getUpdateState: state.getUpdateState,
  installUpdate: state.installUpdate,
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
  state.getUpdateState.mockReturnValue({ status: 'idle', currentVersion: '1.0.0' });
  const { registerIpc } = await import('../ipc');
  registerIpc('standalone');
  return handlers;
}

function call(h: Map<string, Handler>, channel: string, ...args: unknown[]) {
  const handler = h.get(channel);
  if (!handler) throw new Error(`no handler registered for ${channel}`);
  return handler({}, ...args);
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
  it('getServers returns backend-switcher\'s list verbatim', async () => {
    const h = await setup();
    const entries = [{ id: 'embedded', label: 'This computer', url: 'http://127.0.0.1:3100', kind: 'embedded' as const, active: true }];
    state.listServers.mockReturnValue(entries);
    expect(await call(h, IPC.getServers)).toEqual(entries);
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

  it('relays onServersChanged to the renderer as IPC_EVENT.serversChanged', async () => {
    const h = await setup();
    expect(state.onServersChangedListener).toBeTypeOf('function');
    state.onServersChangedListener!();
    expect(state.mainWindow!.webContents.send).toHaveBeenCalledWith(IPC_EVENT.serversChanged);
  });

  it('does not send to a destroyed window', async () => {
    const h = await setup();
    state.mainWindow!.isDestroyed = () => true;
    state.onServersChangedListener!();
    expect(state.mainWindow!.webContents.send).not.toHaveBeenCalled();
  });
});

describe('IPC.getUpdateState / installUpdate (G-04)', () => {
  it('getUpdateState returns the updater module state verbatim', async () => {
    const h = await setup();
    state.getUpdateState.mockReturnValue({ status: 'ready', currentVersion: '1.0.0', nextVersion: '1.1.0' });
    expect(await call(h, IPC.getUpdateState)).toEqual({ status: 'ready', currentVersion: '1.0.0', nextVersion: '1.1.0' });
  });

  it('installUpdate delegates to the updater module', async () => {
    const h = await setup();
    await call(h, IPC.installUpdate);
    expect(state.installUpdate).toHaveBeenCalled();
  });

  it('relays onUpdateStateChange to the renderer as IPC_EVENT.updateStateChanged', async () => {
    const h = await setup();
    const next = { status: 'downloading', currentVersion: '1.0.0', percent: 10 };
    state.onUpdateStateChangeListener!(next);
    expect(state.mainWindow!.webContents.send).toHaveBeenCalledWith(IPC_EVENT.updateStateChanged, next);
  });
});

describe('IPC.setMenuState — attention (G-05)', () => {
  it('accepts null (no snapshot yet) and refreshes the tray/badge', async () => {
    const h = await setup();
    await call(h, IPC.setMenuState, { attention: null });
    expect(state.updateMenuState).toHaveBeenCalledWith(expect.objectContaining({ attention: null }));
    expect(state.refreshTrayMenu).toHaveBeenCalled();
    expect(state.applyAttentionBadge).toHaveBeenCalledWith(0, expect.anything());
  });

  it('accepts a well-formed AttentionCounts and forwards needsYou to the badge', async () => {
    const h = await setup();
    await call(h, IPC.setMenuState, { attention: attentionPatch({ needsYou: 4 }) });
    expect(state.updateMenuState).toHaveBeenCalledWith(
      expect.objectContaining({ attention: expect.objectContaining({ needsYou: 4 }) }),
    );
    expect(state.applyAttentionBadge).toHaveBeenCalledWith(4, expect.anything());
  });

  it('clamps counts to [0, 999] and fills in missing byEntity rows as zero', async () => {
    const h = await setup();
    await call(h, IPC.setMenuState, {
      attention: { needsYou: -5, running: 5000, byEntity: { chat: { needsYou: 1, running: 2 } } },
    });
    const pushed = state.updateMenuState.mock.calls.at(-1)![0];
    expect(pushed.attention).toEqual({
      needsYou: 0,
      running: 999,
      byEntity: {
        chat: { needsYou: 1, running: 2 },
        workflow_run: { needsYou: 0, running: 0 },
        automation_execution: { needsYou: 0, running: 0 },
      },
    });
  });

  it('drops a malformed attention value (no byEntity) and never touches the tray/badge', async () => {
    const h = await setup();
    await call(h, IPC.setMenuState, { attention: { needsYou: 1, running: 1 } });
    expect(state.updateMenuState).toHaveBeenCalledWith(expect.not.objectContaining({ attention: expect.anything() }));
    expect(state.refreshTrayMenu).not.toHaveBeenCalled();
    expect(state.applyAttentionBadge).not.toHaveBeenCalled();
  });

  it('does not refresh the tray/badge when the patch carries no attention key at all', async () => {
    const h = await setup();
    await call(h, IPC.setMenuState, { sidebarOpen: true });
    expect(state.refreshTrayMenu).not.toHaveBeenCalled();
    expect(state.applyAttentionBadge).not.toHaveBeenCalled();
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
    expect(state.updateMenuState).toHaveBeenCalledWith(
      expect.objectContaining({ sidebarOpen: true, rightPaneOpen: false, recent: [{ label: 'Home', route: '/' }] }),
    );
  });
});
