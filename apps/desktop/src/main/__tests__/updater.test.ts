// updater.ts (G-04): the state machine pushed to the renderer (P1-review
// P2-R7), when the native "update ready" dialog shows (P2-R3, R37), and the
// install sequence per OS (D-54; P2-R4, R27, R28), run through the real
// quit-coordinator the way index.ts wires it (`before-quit` → `quitApp`).
//
// The fakes model electron-updater 6.8.9 as read in its source:
// - `BaseUpdater` (Windows, Linux): `install()` is synchronous and returns
//   whether the installer started; NSIS reports a failed spawn on a later
//   tick; `quitAndInstall()` is `install()` + `setImmediate(app.quit)`.
// - `MacUpdater` emits its own `update-downloaded` before Squirrel.Mac has the
//   update; Electron's native `autoUpdater` emits `update-downloaded` when it
//   does; `quitAndInstall()` makes Squirrel close the windows and quit.
// The last block drives the real `BaseUpdater` class (P2-R27).

import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ElectronUpdater from 'electron-updater';

const state = vi.hoisted(() => ({
  isPackaged: true,
  version: '1.0.0',
  nativeStage: false,
  showMessageBox: vi.fn(async (..._a: unknown[]) => ({ response: 1 })),
  mainWindow: null as { isDestroyed: () => boolean; isVisible: () => boolean; isMinimized: () => boolean } | null,
  confirmDiscard: vi.fn(async () => true),
  setQuitting: vi.fn(),
  restoreFromTray: vi.fn(),
  stopServer: vi.fn(async (): Promise<void> => undefined),
  destroyTray: vi.fn(),
  relaunch: vi.fn(),
  exit: vi.fn(),
  order: [] as string[],
}));

// Read by the `electron` mock factory below only when `../updater` is
// imported (after this module's top level has run), so no hoisting is needed.
const fakes = { app: new EventEmitter(), native: new EventEmitter() };

const tmp = mkdtempSync(path.join(tmpdir(), 'gai-updater-test-'));
const installerFile = path.join(tmp, 'GeneratorAI-Setup-1.1.0.exe');
writeFileSync(installerFile, '');
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

class FakeUpdater extends EventEmitter {
  autoDownload = false;
  autoRunAppAfterInstall = true;
  logger: unknown = null;
  downloadedUpdateHelper: { file: string | null } | null = { file: installerFile };
  checkForUpdates = vi.fn(async () => ({ updateInfo: { version: '1.0.0' } }));
  /** BaseUpdater: starts the installer, reports whether it did. */
  install = vi.fn((_isSilent?: boolean, _isForceRunAfter?: boolean) => {
    state.order.push('installer');
    return true;
  });
  /** MacUpdater: Squirrel closes the windows and quits. */
  quitAndInstall = vi.fn(() => {
    state.order.push('quitAndInstall');
    setImmediate(() => fakes.app.emit('before-quit'));
  });
}

/** A MacUpdater has no synchronous `install()`. */
function macUpdater(): FakeUpdater {
  const u = new FakeUpdater();
  Object.defineProperty(u, 'install', { value: undefined });
  return u;
}

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return state.isPackaged;
    },
    getVersion: () => state.version,
    on: (event: string, fn: (...a: unknown[]) => void) => fakes.app.on(event, fn),
    removeListener: (event: string, fn: (...a: unknown[]) => void) => fakes.app.removeListener(event, fn),
    quit: () => fakes.app.emit('before-quit'),
    relaunch: (...a: unknown[]) => state.relaunch(...a),
    exit: (code: number) => state.exit(code),
  },
  autoUpdater: fakes.native,
  dialog: { showMessageBox: (...a: unknown[]) => state.showMessageBox(...a) },
}));

vi.mock('../window-manager', () => ({
  getWindowManager: () => ({
    getMainWindow: () => state.mainWindow,
    confirmDiscard: state.confirmDiscard,
    setQuitting: state.setQuitting,
    restoreFromTray: state.restoreFromTray,
  }),
}));
vi.mock('../server-manager', () => ({ getServerManager: () => ({ stop: state.stopServer }) }));
vi.mock('../computer-host-registry', () => ({ disposeComputerHost: async () => undefined }));
vi.mock('../tray', () => ({ destroyTray: state.destroyTray }));

vi.mock('../platform', () => ({
  get updaterHasNativeInstallStage() {
    return state.nativeStage;
  },
}));
vi.mock('../logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

// A getter, so each test's fresh updater is what `import('electron-updater')` yields.
let updaterInstance: FakeUpdater = new FakeUpdater();
vi.mock('electron-updater', () => ({
  get autoUpdater() {
    return updaterInstance;
  },
}));

/** Fresh modules, wired like index.ts: every `before-quit` goes to `quitApp`. */
async function loadUpdater() {
  vi.resetModules();
  const coordinator = await import('../quit-coordinator');
  fakes.app.on('before-quit', () => void coordinator.quitApp('standalone'));
  const mod = await import('../updater');
  return mod;
}

async function initialised() {
  const updater = await loadUpdater();
  await updater.initAutoUpdates();
  return updater;
}

function visibleWindow(minimised = false) {
  return { isDestroyed: () => false, isVisible: () => true, isMinimized: () => minimised };
}

/** Lets pending promise chains and `setImmediate` callbacks run. */
async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function downloaded(updater: Awaited<ReturnType<typeof loadUpdater>>, version = '1.1.0') {
  updaterInstance.emit('update-available', { version });
  updaterInstance.emit('update-downloaded', { version });
  await flush();
  return updater;
}

const savedAppImage = process.env.APPIMAGE;

beforeEach(() => {
  state.isPackaged = true;
  state.version = '1.0.0';
  state.nativeStage = false;
  state.showMessageBox.mockReset().mockResolvedValue({ response: 1 });
  state.mainWindow = null;
  state.confirmDiscard.mockReset().mockImplementation(async () => (state.order.push('confirm'), true));
  state.setQuitting.mockReset().mockImplementation((v: boolean) => void state.order.push(`quitting:${v}`));
  state.restoreFromTray.mockReset();
  state.stopServer.mockReset().mockImplementation(async () => void state.order.push('server-stopped'));
  state.destroyTray.mockReset();
  state.relaunch.mockReset().mockImplementation(() => void state.order.push('relaunch'));
  state.exit.mockReset().mockImplementation((code: number) => void state.order.push(`exit:${code}`));
  state.order = [];
  fakes.app.removeAllListeners();
  fakes.native.removeAllListeners();
  updaterInstance = new FakeUpdater();
  delete process.env.APPIMAGE;
});

afterEach(() => {
  vi.useRealTimers();
  if (savedAppImage === undefined) delete process.env.APPIMAGE;
  else process.env.APPIMAGE = savedAppImage;
});

describe('state machine (R7)', () => {
  it('starts idle with the running version, and does nothing when unpackaged', async () => {
    state.isPackaged = false;
    const updater = await loadUpdater();
    expect(updater.getUpdateState()).toEqual({ status: 'idle', currentVersion: '1.0.0' });
    await updater.initAutoUpdates();
    expect(updater.getUpdateState().status).toBe('idle');
    expect(updaterInstance.checkForUpdates).not.toHaveBeenCalled();
  });

  it('follows checking → downloading → ready through the real event names', async () => {
    const updater = await initialised();
    const pushed: unknown[] = [];
    updater.onUpdateStateChange((s) => pushed.push(s));

    updaterInstance.emit('checking-for-update');
    expect(updater.getUpdateState()).toEqual({ status: 'checking', currentVersion: '1.0.0' });

    updaterInstance.emit('update-available', { version: '1.1.0' });
    expect(updater.getUpdateState()).toEqual({ status: 'downloading', currentVersion: '1.0.0', nextVersion: '1.1.0', percent: 0 });

    updaterInstance.emit('download-progress', { percent: 42 });
    expect(updater.getUpdateState()).toMatchObject({ status: 'downloading', percent: 42 });

    updaterInstance.emit('update-downloaded', { version: '1.1.0' });
    await flush();
    expect(updater.getUpdateState()).toEqual({
      status: 'ready',
      currentVersion: '1.0.0',
      nextVersion: '1.1.0',
      downloadedVersion: '1.1.0',
    });
    expect(pushed).toHaveLength(4);
  });

  it('a check that fails before any download is idle + error, not a stuck error state', async () => {
    const updater = await initialised();
    updaterInstance.emit('checking-for-update');
    updaterInstance.emit('error', new Error('feed unreachable'));
    expect(updater.getUpdateState()).toEqual({ status: 'idle', currentVersion: '1.0.0', error: 'feed unreachable' });
  });

  it('the next successful transition clears a stale error', async () => {
    const updater = await initialised();
    updaterInstance.emit('error', new Error('feed unreachable'));
    updaterInstance.emit('checking-for-update');
    expect(updater.getUpdateState().error).toBeUndefined();
    updaterInstance.emit('error', new Error('again'));
    updaterInstance.emit('update-not-available');
    expect(updater.getUpdateState()).toEqual({ status: 'idle', currentVersion: '1.0.0' });
  });

  it('a later check or error does not hide a downloaded update (Help ▸ Check for Updates while offline)', async () => {
    const updater = await downloaded(await initialised());
    updaterInstance.emit('checking-for-update');
    expect(updater.getUpdateState()).toMatchObject({ status: 'ready', downloadedVersion: '1.1.0' });
    updaterInstance.emit('error', new Error('offline'));
    expect(updater.getUpdateState()).toEqual({
      status: 'ready',
      currentVersion: '1.0.0',
      nextVersion: '1.1.0',
      downloadedVersion: '1.1.0',
      error: 'offline',
    });
    // …and it can still be installed.
    expect(await updater.installUpdate()).toBe('quitting');
  });

  it('a newer version found later replaces the downloaded one', async () => {
    const updater = await downloaded(await initialised(), '1.1.0');
    updaterInstance.emit('update-available', { version: '1.2.0' });
    expect(updater.getUpdateState()).toMatchObject({ status: 'downloading', nextVersion: '1.2.0' });
    expect(updater.getUpdateState().downloadedVersion).toBeUndefined();
  });

  it('update-cancelled returns to idle and drops the progress', async () => {
    const updater = await initialised();
    updaterInstance.emit('update-available', { version: '1.1.0' });
    updaterInstance.emit('download-progress', { percent: 30 });
    updaterInstance.emit('update-cancelled', { version: '1.1.0' });
    expect(updater.getUpdateState()).toEqual({ status: 'idle', currentVersion: '1.0.0' });
  });

  it('with a native install stage (Squirrel.Mac), ready only once Electron’s autoUpdater has the update', async () => {
    state.nativeStage = true;
    const updater = await initialised();
    updaterInstance.emit('update-available', { version: '1.1.0' });
    updaterInstance.emit('update-downloaded', { version: '1.1.0' });
    await flush();
    expect(updater.getUpdateState()).toMatchObject({ status: 'downloading', percent: 100 });
    expect(await updater.installUpdate()).toBe('not-ready');

    fakes.native.emit('update-downloaded');
    await flush();
    expect(updater.getUpdateState()).toMatchObject({ status: 'ready', downloadedVersion: '1.1.0' });
  });

  it('with a native install stage, a Squirrel failure before it has the update is idle + error', async () => {
    state.nativeStage = true;
    const updater = await initialised();
    updaterInstance.emit('update-downloaded', { version: '1.1.0' });
    updaterInstance.emit('error', new Error('Code signature did not match'));
    expect(updater.getUpdateState()).toEqual({ status: 'idle', currentVersion: '1.0.0', error: 'Code signature did not match' });
  });

  it('with a native install stage, an unrelated error does not lose the version Squirrel is fetching (P2-R37)', async () => {
    state.nativeStage = true;
    const updater = await initialised();
    updaterInstance.emit('update-downloaded', { version: '1.1.0' });
    updaterInstance.emit('error', new Error('feed unreachable'));
    fakes.native.emit('update-downloaded');
    await flush();
    expect(updater.getUpdateState()).toMatchObject({ status: 'ready', downloadedVersion: '1.1.0' });
  });
});

describe('the native "update ready" dialog (R3)', () => {
  it('shows with a visible window while no renderer has subscribed (today, until the P3-06 pill)', async () => {
    state.mainWindow = visibleWindow();
    await downloaded(await initialised());
    expect(state.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ message: 'GeneratorAI 1.1.0 has been downloaded.' }));
  });

  it('shows when there is no window at all, even with a stale subscription', async () => {
    const updater = await initialised();
    updater.setUpdateWatch(7, true);
    await downloaded(updater);
    expect(state.showMessageBox).toHaveBeenCalledTimes(1);
  });

  it('is skipped only while a subscribed renderer is on screen', async () => {
    state.mainWindow = visibleWindow();
    const updater = await initialised();
    updater.setUpdateWatch(7, true);
    expect(updater.rendererWatchesUpdates()).toBe(true);
    await downloaded(updater);
    expect(state.showMessageBox).not.toHaveBeenCalled();
  });

  it('counts subscriptions per renderer, and a renderer reset forgets them', async () => {
    const updater = await loadUpdater();
    updater.setUpdateWatch(7, true);
    updater.setUpdateWatch(7, true);
    updater.setUpdateWatch(7, false);
    expect(updater.rendererWatchesUpdates()).toBe(true);
    updater.setUpdateWatch(7, false);
    expect(updater.rendererWatchesUpdates()).toBe(false);
    updater.setUpdateWatch(7, true);
    updater.clearUpdateWatchers();
    expect(updater.rendererWatchesUpdates()).toBe(false);
  });

  it('offers once per download, not again when a later check keeps it ready', async () => {
    const updater = await downloaded(await initialised());
    updaterInstance.emit('checking-for-update');
    updaterInstance.emit('update-not-available');
    await flush();
    expect(updater.getUpdateState().status).toBe('ready');
    expect(state.showMessageBox).toHaveBeenCalledTimes(1);
  });


  it('is shown for a minimised window even with a subscriber (P2-R37)', async () => {
    state.mainWindow = visibleWindow(true);
    const updater = await initialised();
    updater.setUpdateWatch(7, true);
    await downloaded(updater);
    expect(state.showMessageBox).toHaveBeenCalledTimes(1);
  });

  it('"Restart Now" installs', async () => {
    state.showMessageBox.mockResolvedValue({ response: 0 });
    await downloaded(await initialised());
    await flush();
    expect(updaterInstance.install).toHaveBeenCalledTimes(1);
    expect(updaterInstance.quitAndInstall).not.toHaveBeenCalled();
  });

  it('"Restart Now" that fails says so (P2-R37)', async () => {
    state.showMessageBox.mockResolvedValueOnce({ response: 0 }).mockResolvedValue({ response: 0 });
    updaterInstance.downloadedUpdateHelper = { file: path.join(tmp, 'gone.exe') };
    await downloaded(await initialised());
    await flush();
    expect(state.showMessageBox).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'error', message: 'The update could not be installed.' }),
    );
  });
});

describe('installUpdate on Windows and Linux: shutdown first, installer last (P2-R28)', () => {
  it('does nothing when no update is ready', async () => {
    const updater = await initialised();
    expect(await updater.installUpdate()).toBe('not-ready');
    expect(state.confirmDiscard).not.toHaveBeenCalled();
  });

  it('commits when the quit is accepted, then stops the server, then starts the installer, then exits', async () => {
    const updater = await downloaded(await initialised());
    const pushed: string[] = [];
    updater.onUpdateStateChange((s) => pushed.push(s.status));

    expect(await updater.installUpdate()).toBe('quitting');
    await flush();
    expect(state.order).toEqual(['confirm', 'confirm', 'quitting:true', 'server-stopped', 'installer', 'exit:0']);
    // quitAndInstall()'s own arguments: not silent, run the app afterwards.
    expect(updaterInstance.install).toHaveBeenCalledWith(false, true);
    expect(pushed).toContain('installing');
    expect(state.relaunch).not.toHaveBeenCalled();
  });

  it('a missing installer file fails before anything is touched', async () => {
    const updater = await downloaded(await initialised());
    updaterInstance.downloadedUpdateHelper = { file: path.join(tmp, 'gone.exe') };
    expect(await updater.installUpdate()).toBe('failed');
    await flush();
    expect(state.order).toEqual([]);
    expect(updater.getUpdateState()).toMatchObject({ status: 'ready', error: expect.stringContaining('missing') });
  });

  it('AppImage: not started from an AppImage file fails before anything is touched; started from one installs', async () => {
    const appImage = path.join(tmp, 'GeneratorAI-1.1.0.AppImage');
    writeFileSync(appImage, '');
    updaterInstance.downloadedUpdateHelper = { file: appImage };
    const updater = await downloaded(await initialised());
    expect(await updater.installUpdate()).toBe('failed');
    expect(state.order).toEqual([]);

    process.env.APPIMAGE = path.join(tmp, 'GeneratorAI.AppImage');
    writeFileSync(process.env.APPIMAGE, '');
    expect(await updater.installUpdate()).toBe('quitting');
    await flush();
    expect(state.order).toEqual(['confirm', 'confirm', 'quitting:true', 'server-stopped', 'installer', 'exit:0']);
  });

  it('declining the unsaved-work prompt changes nothing', async () => {
    const updater = await downloaded(await initialised());
    state.confirmDiscard.mockResolvedValue(false);
    expect(await updater.installUpdate()).toBe('declined');
    await flush();
    expect(state.order).toEqual([]);
    expect(updater.getUpdateState().status).toBe('ready');
  });

  it('a quit that is not accepted leaves the app running and the update ready', async () => {
    const updater = await downloaded(await initialised());
    state.confirmDiscard.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await updater.installUpdate()).toBe('declined');
    await flush();
    expect(state.stopServer).not.toHaveBeenCalled();
    expect(updaterInstance.install).not.toHaveBeenCalled();
    expect(state.setQuitting).toHaveBeenLastCalledWith(false);
    expect(updater.getUpdateState().status).toBe('ready');
  });

  it('deb/rpm: install() refusing after the shutdown (pkexec cancelled) relaunches the current version', async () => {
    const updater = await downloaded(await initialised());
    updaterInstance.install.mockImplementation(() => {
      updaterInstance.emit('error', new Error('Command pkexec exited with code 126'));
      return false;
    });
    expect(await updater.installUpdate()).toBe('quitting');
    await flush();
    expect(state.order).toEqual(['confirm', 'confirm', 'quitting:true', 'server-stopped', 'relaunch', 'exit:0']);
    expect(state.relaunch).toHaveBeenCalledWith();
  });

  it('NSIS: a spawn failure reported on the next tick relaunches too', async () => {
    const updater = await downloaded(await initialised());
    updaterInstance.install.mockImplementation(() => {
      process.nextTick(() => updaterInstance.emit('error', new Error('spawn UNKNOWN')));
      return true;
    });
    expect(await updater.installUpdate()).toBe('quitting');
    await flush();
    expect(state.order.slice(-2)).toEqual(['relaunch', 'exit:0']);
  });

  it('AppImage: a failure after the shutdown relaunches the AppImage file, not the vanished mount', async () => {
    const appImage = path.join(tmp, 'GeneratorAI-1.1.0.AppImage');
    writeFileSync(appImage, '');
    process.env.APPIMAGE = path.join(tmp, 'GeneratorAI.AppImage');
    writeFileSync(process.env.APPIMAGE, '');
    updaterInstance.downloadedUpdateHelper = { file: appImage };
    updaterInstance.install.mockImplementation(() => {
      throw new Error('mv failed');
    });
    const updater = await downloaded(await initialised());
    expect(await updater.installUpdate()).toBe('quitting');
    await flush();
    expect(state.relaunch).toHaveBeenCalledWith({ execPath: process.env.APPIMAGE });
  });

  it('is idempotent once committed: a second request never reaches electron-updater (P2-R27)', async () => {
    const updater = await downloaded(await initialised());
    const a = updater.installUpdate();
    const b = updater.installUpdate();
    expect(await a).toBe('quitting');
    expect(await b).toBe('quitting');
    await flush();
    expect(await updater.installUpdate()).toBe('quitting');
    await flush();
    expect(updaterInstance.install).toHaveBeenCalledTimes(1);
    expect(state.confirmDiscard).toHaveBeenCalledTimes(2); // the updater's question and quitApp's (answered from memory in the app)
    expect(state.exit).toHaveBeenCalledTimes(1);
  });

  it('a request during an ordinary quit that is already shutting down does not start a second install', async () => {
    const updater = await downloaded(await initialised());
    let release!: () => void;
    state.stopServer.mockImplementation(() => new Promise<void>((r) => (release = r)));
    fakes.app.emit('before-quit');
    await vi.waitFor(() => expect(state.stopServer).toHaveBeenCalled());
    expect(await updater.installUpdate()).toBe('quitting');
    release();
    await flush();
    // electron-updater's own autoInstallOnAppQuit handles it on `quit` with code 0.
    expect(updaterInstance.install).not.toHaveBeenCalled();
  });

  it('fails when the app does not start quitting before the deadline, and can be retried', async () => {
    const updater = await downloaded(await initialised());
    fakes.app.removeAllListeners('before-quit');
    vi.useFakeTimers();
    const pending = updater.installUpdate();
    await vi.advanceTimersByTimeAsync(updater.INSTALL_HANDOFF_DEADLINE_MS);
    expect(await pending).toBe('failed');
    expect(updater.getUpdateState()).toMatchObject({ status: 'ready', error: expect.stringContaining('did not start quitting') });
    expect(state.setQuitting).toHaveBeenLastCalledWith(false);
  });
});

describe('installUpdate on macOS: installer first (Squirrel.Mac, P2-R28)', () => {
  beforeEach(() => {
    state.nativeStage = true;
    updaterInstance = macUpdater();
  });

  async function nativeReady() {
    const updater = await initialised();
    updaterInstance.emit('update-downloaded', { version: '1.1.0' });
    fakes.native.emit('update-downloaded');
    await flush();
    return updater;
  }

  it('hands over to quitAndInstall; its quit then runs the normal shutdown and ShipIt installs after exit', async () => {
    const updater = await nativeReady();
    expect(await updater.installUpdate()).toBe('quitting');
    await flush();
    expect(state.order).toEqual(['confirm', 'quitting:true', 'quitAndInstall', 'confirm', 'quitting:true', 'server-stopped', 'exit:0']);
    expect(state.restoreFromTray).not.toHaveBeenCalled();
  });

  it('a second request after the hand-over does not call quitAndInstall again (P2-R27)', async () => {
    const updater = await nativeReady();
    expect(await updater.installUpdate()).toBe('quitting');
    expect(await updater.installUpdate()).toBe('quitting');
    await flush();
    expect(updaterInstance.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('an error instead of a quit: back to ready + error, window restored, app still running', async () => {
    const updater = await nativeReady();
    updaterInstance.quitAndInstall.mockImplementation(() => {
      updaterInstance.emit('error', new Error('Squirrel is busy'));
    });
    expect(await updater.installUpdate()).toBe('failed');
    expect(updater.getUpdateState()).toMatchObject({ status: 'ready', error: 'Squirrel is busy' });
    expect(state.setQuitting).toHaveBeenLastCalledWith(false);
    expect(state.restoreFromTray).toHaveBeenCalled();
    expect(state.exit).not.toHaveBeenCalled();
  });

  it('fails after the deadline when nothing happens, and can be retried', async () => {
    const updater = await nativeReady();
    vi.useFakeTimers();
    updaterInstance.quitAndInstall.mockImplementation(() => undefined);
    const pending = updater.installUpdate();
    await vi.advanceTimersByTimeAsync(updater.INSTALL_HANDOFF_DEADLINE_MS);
    expect(await pending).toBe('failed');
    expect(updater.getUpdateState()).toMatchObject({ status: 'ready', error: expect.stringContaining('did not start') });
    vi.useRealTimers();

    updaterInstance.quitAndInstall.mockImplementation(() => {
      setImmediate(() => fakes.app.emit('before-quit'));
    });
    expect(await updater.installUpdate()).toBe('quitting');
  });
});

describe('checkForUpdatesInteractive', () => {
  it('tells the user updates need a packaged build', async () => {
    state.isPackaged = false;
    const updater = await loadUpdater();
    await updater.checkForUpdatesInteractive();
    expect(state.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Updates are only available in packaged builds.' }),
    );
  });

  it('reports "up to date" when the check finds the running version', async () => {
    const updater = await loadUpdater();
    await updater.checkForUpdatesInteractive();
    expect(state.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ message: 'You are up to date.' }));
  });

  it('after "Later", offers the downloaded update again instead of checking (P2-R37)', async () => {
    state.mainWindow = visibleWindow();
    const updater = await downloaded(await initialised());
    updater.setUpdateWatch(7, true); // even with a subscribed renderer on screen: the user asked
    state.showMessageBox.mockClear();
    updaterInstance.checkForUpdates.mockClear();
    await updater.checkForUpdatesInteractive();
    expect(updaterInstance.checkForUpdates).not.toHaveBeenCalled();
    expect(state.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ message: 'GeneratorAI 1.1.0 has been downloaded.' }));
  });
});

describe('against the real electron-updater BaseUpdater (P2-R27)', () => {
  type RealModule = typeof ElectronUpdater;

  /** A real BaseUpdater whose `doInstall` only counts, with a fake Electron app adapter. */
  async function realUpdater() {
    const actual = await vi.importActual<RealModule>('electron-updater');
    const quitHandlers: Array<(exitCode: number) => void> = [];
    let installs = 0;
    class ProbeUpdater extends actual.BaseUpdater {
      constructor() {
        super(null, {
          version: '1.0.0',
          name: 'GeneratorAI',
          isPackaged: false,
          appUpdateConfigPath: path.join(tmp, 'app-update.yml'),
          userDataPath: tmp,
          baseCachePath: tmp,
          whenReady: () => Promise.resolve(),
          relaunch: () => undefined,
          quit: () => undefined,
          onQuit: (handler: (exitCode: number) => void) => void quitHandlers.push(handler),
        });
      }
      protected doInstall(): boolean {
        installs++;
        return true;
      }
      protected doDownloadUpdate(): Promise<string[]> {
        return Promise.resolve([]);
      }
    }
    const updater = new ProbeUpdater();
    // What a finished download leaves behind (BaseUpdater.executeDownload).
    Object.assign(updater, {
      downloadedUpdateHelper: { file: installerFile, packageFile: null, downloadedFileInfo: { isAdminRightsRequired: false } },
    });
    (updater as unknown as { addQuitHandler(): void }).addQuitHandler();
    return { updater, installs: () => installs, quit: (code: number) => quitHandlers.forEach((h) => h(code)) };
  }

  it('the module on its own installs twice when asked twice (the hazard)', async () => {
    const probe = await realUpdater();
    expect(probe.updater.install(false, true)).toBe(true);
    // A second quitAndInstall: install() refuses and quitAndInstall resets its guard…
    probe.updater.quitAndInstall();
    // …so the quit handler installs again on a clean exit.
    probe.quit(0);
    expect(probe.installs()).toBe(2);
  });

  it('installUpdate twice after the hand-off, then a clean exit: installed exactly once', async () => {
    const probe = await realUpdater();
    updaterInstance = probe.updater as unknown as FakeUpdater;
    const updater = await initialised();
    probe.updater.emit('update-downloaded', { version: '1.1.0' } as never);
    await flush();
    expect(updater.getUpdateState().status).toBe('ready');

    expect(await updater.installUpdate()).toBe('quitting');
    await flush();
    expect(state.exit).toHaveBeenCalledWith(0);
    expect(probe.installs()).toBe(1);

    expect(await updater.installUpdate()).toBe('quitting');
    probe.quit(0); // `app.exit(0)` → `quit` with code 0
    expect(probe.installs()).toBe(1);
  });
});
