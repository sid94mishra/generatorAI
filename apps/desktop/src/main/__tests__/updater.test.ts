// updater.ts (G-04): the state machine pushed to the renderer, the
// no-window-visible fallback dialog, and the R5 install-path fix — running
// the shared bounded shutdown and calling `quitAndInstall()` instead of the
// forced `app.exit(0)` `before-quit` uses, which never emits the events
// `electron-updater`'s own quit-time install depends on.

import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  isPackaged: true,
  version: '1.0.0',
  showMessageBox: vi.fn(async () => ({ response: 1 })),
  mainWindow: null as { isDestroyed: () => boolean; isVisible: () => boolean } | null,
  runQuitShutdown: vi.fn(async () => true),
}));

class FakeUpdater extends EventEmitter {
  autoDownload = false;
  logger: unknown = null;
  checkForUpdates = vi.fn(async () => ({ updateInfo: { version: '1.0.0' } }));
  quitAndInstall = vi.fn();
}

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return state.isPackaged;
    },
    getVersion: () => state.version,
  },
  dialog: { showMessageBox: state.showMessageBox },
}));

vi.mock('../window-manager', () => ({
  getWindowManager: () => ({ getMainWindow: () => state.mainWindow }),
}));

vi.mock('../quit-coordinator', () => ({ runQuitShutdown: state.runQuitShutdown }));
vi.mock('../logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

// A dynamic `import('electron-updater')` (inside `getUpdater()`) is not
// guaranteed to re-run this factory on every `vi.resetModules()` the way a
// fresh `import('../updater')` re-runs THAT module's own top-level code —
// confirmed by a first version of this file, where listeners piled up on one
// shared `FakeUpdater` across tests. A getter sidesteps the question
// entirely: whichever way the factory itself is cached, reading
// `autoUpdater` always returns whatever `updaterInstance` currently points
// to, and `beforeEach` below replaces it with a clean emitter every time.
let updaterInstance = new FakeUpdater();
vi.mock('electron-updater', () => ({
  get autoUpdater() {
    return updaterInstance;
  },
}));

async function loadUpdater() {
  vi.resetModules();
  return import('../updater');
}

function visibleWindow() {
  return { isDestroyed: () => false, isVisible: () => true };
}

/** Yields the event loop enough times for the `update-downloaded` listener's own await chain (dialog → installUpdate → runQuitShutdown → quitAndInstall) to finish. */
async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  state.isPackaged = true;
  state.version = '1.0.0';
  state.showMessageBox.mockReset().mockResolvedValue({ response: 1 });
  state.mainWindow = null;
  state.runQuitShutdown.mockReset().mockResolvedValue(true);
  updaterInstance = new FakeUpdater();
});

describe('getUpdateState / initAutoUpdates', () => {
  it('starts idle, with the running build version, and does nothing when unpackaged', async () => {
    state.isPackaged = false;
    const updater = await loadUpdater();
    expect(updater.getUpdateState()).toEqual({ status: 'idle', currentVersion: '1.0.0' });
    await updater.initAutoUpdates('standalone');
    expect(updater.getUpdateState().status).toBe('idle');
  });

  it('follows checking → downloading → ready through the real event names', async () => {
    const updater = await loadUpdater();
    state.mainWindow = visibleWindow();
    const pushed: unknown[] = [];
    updater.onUpdateStateChange((s) => pushed.push(s));

    await updater.initAutoUpdates('standalone');
    updaterInstance.emit('checking-for-update');
    expect(updater.getUpdateState().status).toBe('checking');

    updaterInstance.emit('update-available', { version: '1.1.0' });
    expect(updater.getUpdateState()).toMatchObject({ status: 'downloading', nextVersion: '1.1.0', percent: 0 });

    updaterInstance.emit('download-progress', { percent: 42 });
    expect(updater.getUpdateState()).toMatchObject({ status: 'downloading', percent: 42 });

    updaterInstance.emit('update-downloaded', { version: '1.1.0' });
    await flush();
    expect(updater.getUpdateState()).toMatchObject({ status: 'ready', nextVersion: '1.1.0', percent: 100 });

    expect(pushed.length).toBeGreaterThan(0);
  });

  it('reports an error state', async () => {
    const updater = await loadUpdater();
    await updater.initAutoUpdates('standalone');
    updaterInstance.emit('error', new Error('feed unreachable'));
    expect(updater.getUpdateState()).toMatchObject({ status: 'error', error: 'feed unreachable' });
  });

  it('shows the native dialog on update-downloaded only when there is no visible window', async () => {
    const updater = await loadUpdater();
    state.mainWindow = null; // no window at all
    await updater.initAutoUpdates('standalone');
    updaterInstance.emit('update-downloaded', { version: '1.1.0' });
    await flush();
    expect(state.showMessageBox).toHaveBeenCalled();
  });

  it('does not show the native dialog when a visible window exists', async () => {
    const updater = await loadUpdater();
    state.mainWindow = visibleWindow();
    await updater.initAutoUpdates('standalone');
    updaterInstance.emit('update-downloaded', { version: '1.1.0' });
    await flush();
    expect(state.showMessageBox).not.toHaveBeenCalled();
  });

  it('installs when the user picks Restart Now on the fallback dialog', async () => {
    const updater = await loadUpdater();
    state.mainWindow = null;
    state.showMessageBox.mockResolvedValue({ response: 0 });
    await updater.initAutoUpdates('standalone');
    updaterInstance.emit('update-downloaded', { version: '1.1.0' });
    await flush();
    expect(state.runQuitShutdown).toHaveBeenCalledWith('standalone');
    expect(updaterInstance.quitAndInstall).toHaveBeenCalled();
  });
});

describe('installUpdate — R5 install path', () => {
  it('does nothing when no update is ready', async () => {
    const updater = await loadUpdater();
    await updater.installUpdate();
    expect(state.runQuitShutdown).not.toHaveBeenCalled();
  });

  it('runs the shared bounded shutdown and calls quitAndInstall — never app.exit', async () => {
    const updater = await loadUpdater();
    await updater.initAutoUpdates('standalone');
    updaterInstance.emit('update-downloaded', { version: '1.1.0' });
    await flush();

    await updater.installUpdate();
    expect(state.runQuitShutdown).toHaveBeenCalledWith('standalone');
    expect(updaterInstance.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('does not install when the shutdown was declined (unsaved work)', async () => {
    const updater = await loadUpdater();
    await updater.initAutoUpdates('standalone');
    updaterInstance.emit('update-downloaded', { version: '1.1.0' });
    await flush();

    state.runQuitShutdown.mockResolvedValue(false);
    await updater.installUpdate();
    expect(updaterInstance.quitAndInstall).not.toHaveBeenCalled();
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
