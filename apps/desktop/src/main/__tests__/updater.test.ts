// updater.ts (G-04): the state machine pushed to the renderer (P1-review
// P2-R7), when the native "update ready" dialog shows (P2-R3), and the
// install hand-over that stops nothing until the install is committed (P2-R4).
//
// The fakes model electron-updater 6.8.9 as read in its source:
// - `BaseUpdater.quitAndInstall()` (Windows/Linux) runs `install()`
//   synchronously; on success it `setImmediate`s `app.quit()` (→ `before-quit`);
//   on failure it dispatches `error` and does not quit.
// - `MacUpdater` emits its own `update-downloaded` before Squirrel.Mac has the
//   update; Electron's native `autoUpdater` emits `update-downloaded` when it
//   does.

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  isPackaged: true,
  version: '1.0.0',
  nativeStage: false,
  showMessageBox: vi.fn(async () => ({ response: 1 })),
  mainWindow: null as { isDestroyed: () => boolean; isVisible: () => boolean } | null,
  confirmDiscard: vi.fn(async () => true),
  setQuitting: vi.fn(),
  restoreFromTray: vi.fn(),
}));

// Read by the `electron` mock factory below only when `../updater` is
// imported (after this module's top level has run), so no hoisting is needed.
const fakes = { app: new EventEmitter(), native: new EventEmitter() };

class FakeUpdater extends EventEmitter {
  autoDownload = false;
  logger: unknown = null;
  checkForUpdates = vi.fn(async () => ({ updateInfo: { version: '1.0.0' } }));
  /** Default: a successful BaseUpdater hand-over. */
  quitAndInstall = vi.fn(() => {
    setImmediate(() => fakes.app.emit('before-quit'));
  });
}

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return state.isPackaged;
    },
    getVersion: () => state.version,
    on: (event: string, fn: (...a: unknown[]) => void) => fakes.app.on(event, fn),
    removeListener: (event: string, fn: (...a: unknown[]) => void) => fakes.app.removeListener(event, fn),
  },
  autoUpdater: fakes.native,
  dialog: { showMessageBox: state.showMessageBox },
}));

vi.mock('../window-manager', () => ({
  getWindowManager: () => ({
    getMainWindow: () => state.mainWindow,
    confirmDiscard: state.confirmDiscard,
    setQuitting: state.setQuitting,
    restoreFromTray: state.restoreFromTray,
  }),
}));

vi.mock('../platform', () => ({
  get updaterHasNativeInstallStage() {
    return state.nativeStage;
  },
}));
vi.mock('../logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

// A getter, so each test's fresh `FakeUpdater` is what `import('electron-updater')` yields.
let updaterInstance = new FakeUpdater();
vi.mock('electron-updater', () => ({
  get autoUpdater() {
    return updaterInstance;
  },
}));

async function loadUpdater() {
  vi.resetModules();
  const mod = await import('../updater');
  return mod;
}

async function initialised() {
  const updater = await loadUpdater();
  await updater.initAutoUpdates();
  return updater;
}

function visibleWindow() {
  return { isDestroyed: () => false, isVisible: () => true };
}

/** Lets pending promise chains and `setImmediate` callbacks run. */
async function flush(times = 4): Promise<void> {
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

beforeEach(() => {
  state.isPackaged = true;
  state.version = '1.0.0';
  state.nativeStage = false;
  state.showMessageBox.mockReset().mockResolvedValue({ response: 1 });
  state.mainWindow = null;
  state.confirmDiscard.mockReset().mockResolvedValue(true);
  state.setQuitting.mockReset();
  state.restoreFromTray.mockReset();
  fakes.app.removeAllListeners();
  fakes.native.removeAllListeners();
  updaterInstance = new FakeUpdater();
});

afterEach(() => {
  vi.useRealTimers();
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
    fakes.native.emit('update-downloaded');
    expect(updater.getUpdateState().status).toBe('idle');
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

  it('"Restart Now" installs', async () => {
    state.showMessageBox.mockResolvedValue({ response: 0 });
    await downloaded(await initialised());
    await flush();
    expect(updaterInstance.quitAndInstall).toHaveBeenCalledTimes(1);
  });
});

describe('installUpdate (R4)', () => {
  it('does nothing when no update is ready', async () => {
    const updater = await initialised();
    expect(await updater.installUpdate()).toBe('not-ready');
    expect(state.confirmDiscard).not.toHaveBeenCalled();
    expect(updaterInstance.quitAndInstall).not.toHaveBeenCalled();
  });

  it('asks about unsaved work first; declining changes nothing', async () => {
    const updater = await downloaded(await initialised());
    state.confirmDiscard.mockResolvedValue(false);
    expect(await updater.installUpdate()).toBe('declined');
    expect(updaterInstance.quitAndInstall).not.toHaveBeenCalled();
    expect(state.setQuitting).not.toHaveBeenCalled();
    expect(updater.getUpdateState().status).toBe('ready');
  });

  it('hands over to quitAndInstall and is committed once the app starts quitting (the normal quit path then shuts down)', async () => {
    const updater = await downloaded(await initialised());
    const order: string[] = [];
    state.confirmDiscard.mockImplementation(async () => (order.push('confirm'), true));
    state.setQuitting.mockImplementation((v: boolean) => void order.push(`quitting:${v}`));
    updaterInstance.quitAndInstall.mockImplementation(() => {
      order.push('quitAndInstall');
      setImmediate(() => fakes.app.emit('before-quit'));
    });

    const pushed: string[] = [];
    updater.onUpdateStateChange((s) => pushed.push(s.status));
    expect(await updater.installUpdate()).toBe('quitting');
    expect(order).toEqual(['confirm', 'quitting:true', 'quitAndInstall']);
    expect(pushed).toContain('installing');
    expect(state.restoreFromTray).not.toHaveBeenCalled();
    // The hand-over listener is gone once settled.
    expect(fakes.app.listenerCount('before-quit')).toBe(0);
  });

  it('a second request while one is in flight shares it', async () => {
    const updater = await downloaded(await initialised());
    const a = updater.installUpdate();
    const b = updater.installUpdate();
    expect(await a).toBe('quitting');
    expect(await b).toBe('quitting');
    expect(updaterInstance.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('install failure (install() false → error, e.g. pkexec cancelled): back to ready + error, app left running', async () => {
    const updater = await downloaded(await initialised());
    updaterInstance.quitAndInstall.mockImplementation(() => {
      updaterInstance.emit('error', new Error('Command pkexec exited with code 126'));
    });
    expect(await updater.installUpdate()).toBe('failed');
    expect(updater.getUpdateState()).toMatchObject({
      status: 'ready',
      downloadedVersion: '1.1.0',
      error: 'Command pkexec exited with code 126',
    });
    expect(state.setQuitting).toHaveBeenLastCalledWith(false);
    expect(state.restoreFromTray).toHaveBeenCalled();
    expect(fakes.app.listenerCount('before-quit')).toBe(0);
  });

  it('quitAndInstall throwing counts as a failure too', async () => {
    const updater = await downloaded(await initialised());
    updaterInstance.quitAndInstall.mockImplementation(() => {
      throw new Error('APPIMAGE env is not defined');
    });
    expect(await updater.installUpdate()).toBe('failed');
    expect(updater.getUpdateState()).toMatchObject({ status: 'ready', error: 'APPIMAGE env is not defined' });
  });

  it('fails after the deadline when nothing happens, and can be retried', async () => {
    const updater = await downloaded(await initialised());
    vi.useFakeTimers();
    updaterInstance.quitAndInstall.mockImplementation(() => undefined);
    const pending = updater.installUpdate();
    await vi.advanceTimersByTimeAsync(updater.INSTALL_HANDOFF_DEADLINE_MS);
    expect(await pending).toBe('failed');
    expect(updater.getUpdateState()).toMatchObject({ status: 'ready', error: expect.stringContaining('did not start') });
    expect(state.setQuitting).toHaveBeenLastCalledWith(false);
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
});
