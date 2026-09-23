// The main window's own event handlers, exercised against a fake Electron:
// same-window navigation stays on the app origin, a close click hides to the
// tray when asked, and `repointMainWindow` moves both the page AND the URL the
// guards compare against.

import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (...args: unknown[]) => unknown;

// `vi.mock('electron', ...)` below is hoisted to the top of the file, above
// any top-level `class`/`const` declaration (classes stay in the TDZ just
// like `let`/`const` — they are not hoisted the way function declarations
// are). Referencing `FakeBrowserWindow` from the mock factory therefore used
// to throw "Cannot access 'FakeBrowserWindow' before initialization" at
// collection time, failing the whole file before a single test ran.
// `vi.hoisted()` runs its callback before the mock factories, so the fakes
// it returns are already initialized by the time `vi.mock` needs them.
const { FakeBrowserWindow, openExternal } = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => unknown;

  class FakeWebContents {
    id = 1;
    listeners = new Map<string, Listener[]>();
    session = {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      webRequest: { onHeadersReceived: vi.fn() },
    };
    windowOpenHandler: ((d: { url: string }) => unknown) | null = null;
    on(event: string, fn: Listener) {
      const list = this.listeners.get(event) ?? [];
      list.push(fn);
      this.listeners.set(event, list);
      return this;
    }
    once = this.on;
    setWindowOpenHandler(fn: (d: { url: string }) => unknown) {
      this.windowOpenHandler = fn;
    }
    send = vi.fn();
    loadURL = vi.fn(async () => undefined);
    executeJavaScript = vi.fn(async (_code: string): Promise<unknown> => undefined);
    reload = vi.fn();
    isDevToolsOpened = () => false;
    emit(event: string, ...args: unknown[]) {
      for (const fn of this.listeners.get(event) ?? []) fn(...args);
    }
  }

  class FakeBrowserWindow {
    static instances: FakeBrowserWindow[] = [];
    webContents = new FakeWebContents();
    listeners = new Map<string, Listener[]>();
    destroyed = false;
    visible = false;
    minimized = false;
    loadURL = vi.fn(async () => undefined);
    loadFile = vi.fn(async () => undefined);
    hide = vi.fn(() => (this.visible = false));
    show = vi.fn(() => (this.visible = true));
    focus = vi.fn();
    restore = vi.fn(() => (this.minimized = false));
    maximize = vi.fn();
    close = vi.fn();
    isDestroyed = () => this.destroyed;
    isVisible = () => this.visible;
    isMinimized = () => this.minimized;
    isMaximized = () => false;
    isFullScreen = () => false;
    isFocused = () => true;
    getBounds = () => ({ x: 0, y: 0, width: 1440, height: 900 });
    setTitleBarOverlay = vi.fn();
    constructor(_opts: unknown) {
      FakeBrowserWindow.instances.push(this);
    }
    on(event: string, fn: Listener) {
      const list = this.listeners.get(event) ?? [];
      list.push(fn);
      this.listeners.set(event, list);
      return this;
    }
    once = this.on;
    emit(event: string, ...args: unknown[]) {
      for (const fn of this.listeners.get(event) ?? []) fn(...args);
    }
  }

  return { FakeBrowserWindow, openExternal: vi.fn() };
});

const settings = {
  theme: 'system',
  window: { width: 1440, height: 900 },
  serverPort: 0,
  harnessType: 'copilot',
  minimizeToTray: false,
  servers: { serverMode: 'embedded', connections: [], activeConnectionId: null },
};

vi.mock('electron', () => ({
  BrowserWindow: FakeBrowserWindow,
  shell: { openExternal: (...a: unknown[]) => openExternal(...a) },
  nativeTheme: { shouldUseDarkColors: false },
  screen: { getAllDisplays: () => [] },
  app: { getPath: () => 'C:/tmp' },
  ipcMain: { handle: vi.fn() },
}));
vi.mock('../config', () => ({
  loadSettings: () => settings,
  saveSettings: vi.fn(),
}));
vi.mock('../logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../platform', () => ({
  isMac: false,
  isWayland: true,
  titleBarOptions: () => ({}),
  titleBarSymbolColor: () => '#000',
  TITLE_BAR_HEIGHT: 36,
  useCustomTitleBar: () => false,
}));

import { WindowManager, shouldHideOnClose } from '../window-manager';

const APP = 'http://127.0.0.1:3100';

function makeWindow(url = APP, opts?: { cspFloor?: boolean }) {
  FakeBrowserWindow.instances.length = 0;
  const wm = new WindowManager();
  wm.createMainWindow(url, opts);
  const win = FakeBrowserWindow.instances[0]!;
  return { wm, win };
}

beforeEach(() => {
  openExternal.mockReset();
  settings.minimizeToTray = false;
});

describe('will-navigate', () => {
  function navigate(win: InstanceType<typeof FakeBrowserWindow>, url: string) {
    const event = { preventDefault: vi.fn() };
    win.webContents.emit('will-navigate', event, url);
    return event.preventDefault.mock.calls.length > 0;
  }

  it('allows navigation within the app origin', () => {
    const { win } = makeWindow();
    expect(navigate(win, `${APP}/chats/1`)).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('blocks the userinfo bypass and hands it to the OS browser', () => {
    const { win } = makeWindow();
    expect(navigate(win, 'http://127.0.0.1:3100@evil.com/')).toBe(true);
    expect(openExternal).toHaveBeenCalledWith('http://127.0.0.1:3100@evil.com/');
  });

  it('blocks javascript: and empty URLs without opening anything', () => {
    const { win } = makeWindow();
    expect(navigate(win, 'javascript:alert(1)')).toBe(true);
    expect(navigate(win, '')).toBe(true);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('follows a repoint: the new origin is allowed, the old one is not', () => {
    const { wm, win } = makeWindow();
    wm.repointMainWindow('http://127.0.0.1:4200');
    expect(navigate(win, 'http://127.0.0.1:4200/runs')).toBe(false);
    expect(navigate(win, `${APP}/runs`)).toBe(true);
  });
});

describe('window open handler', () => {
  it('denies every new window and opens http(s) externally only', () => {
    const { win } = makeWindow();
    expect(win.webContents.windowOpenHandler!({ url: 'https://docs.example' })).toEqual({ action: 'deny' });
    expect(openExternal).toHaveBeenCalledWith('https://docs.example');
    openExternal.mockReset();
    expect(win.webContents.windowOpenHandler!({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('opens an in-app route as a route change, not by reloading the app', () => {
    // Cmd/Ctrl/middle-click on a sidebar link. `loadURL` got to the same
    // screen by replacing the document, which skips every React cleanup — a
    // native browser view open in the side pane was left painted over the
    // page the user had just opened.
    const { win } = makeWindow();
    win.loadURL.mockClear();
    expect(win.webContents.windowOpenHandler!({ url: `${APP}/projects?tab=all#top` })).toEqual({ action: 'deny' });
    expect(win.webContents.loadURL).not.toHaveBeenCalled();
    expect(win.webContents.executeJavaScript).toHaveBeenCalledTimes(1);
    expect(String(win.webContents.executeJavaScript.mock.calls[0]![0])).toContain('"/projects?tab=all#top"');
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('still loads a server resource, which no client route can render', () => {
    const { win } = makeWindow();
    win.webContents.windowOpenHandler!({ url: `${APP}/api/files/raw?path=a.png` });
    expect(win.webContents.loadURL).toHaveBeenCalledWith(`${APP}/api/files/raw?path=a.png`);
    expect(win.webContents.executeJavaScript).not.toHaveBeenCalled();
  });
});

describe('session hardening is installed on the main window session', () => {
  it('sets both permission handlers and the CSP floor by default', () => {
    const { win } = makeWindow();
    expect(win.webContents.session.setPermissionRequestHandler).toHaveBeenCalledTimes(1);
    expect(win.webContents.session.setPermissionCheckHandler).toHaveBeenCalledTimes(1);
    expect(win.webContents.session.webRequest.onHeadersReceived).toHaveBeenCalledTimes(1);
  });

  it('skips the CSP floor when asked (dev mode)', () => {
    const { win } = makeWindow(APP, { cspFloor: false });
    expect(win.webContents.session.webRequest.onHeadersReceived).not.toHaveBeenCalled();
    expect(win.webContents.session.setPermissionRequestHandler).toHaveBeenCalledTimes(1);
  });
});

describe('close → tray', () => {
  it('shouldHideOnClose is true only with the setting on and not quitting', () => {
    expect(shouldHideOnClose({ minimizeToTray: true, quitting: false })).toBe(true);
    expect(shouldHideOnClose({ minimizeToTray: true, quitting: true })).toBe(false);
    expect(shouldHideOnClose({ minimizeToTray: false, quitting: false })).toBe(false);
  });

  it('hides instead of closing when minimizeToTray is on', () => {
    settings.minimizeToTray = true;
    const { win } = makeWindow();
    const event = { preventDefault: vi.fn() };
    win.emit('close', event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(win.hide).toHaveBeenCalled();
  });

  it('closes normally when the setting is off', () => {
    const { win } = makeWindow();
    const event = { preventDefault: vi.fn() };
    win.emit('close', event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(win.hide).not.toHaveBeenCalled();
  });

  it('closes for real once quitting, so Quit from the tray finishes', () => {
    settings.minimizeToTray = true;
    const { wm, win } = makeWindow();
    wm.setQuitting(true);
    const event = { preventDefault: vi.fn() };
    win.emit('close', event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('restoreFromTray shows and focuses the hidden window', () => {
    settings.minimizeToTray = true;
    const { wm, win } = makeWindow();
    win.emit('close', { preventDefault: vi.fn() });
    expect(win.visible).toBe(false);
    win.minimized = true;
    wm.restoreFromTray();
    expect(win.restore).toHaveBeenCalled();
    expect(win.show).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
  });

  it('restoreFromTray recreates the window if it was destroyed', () => {
    const { wm, win } = makeWindow();
    win.destroyed = true;
    win.emit('closed');
    wm.restoreFromTray();
    expect(FakeBrowserWindow.instances).toHaveLength(2);
    expect(FakeBrowserWindow.instances[1]!.loadURL).toHaveBeenCalledWith(APP);
  });
});

describe('repointMainWindow', () => {
  it('loads the new URL in the existing window and updates getAppUrl()', () => {
    const { wm, win } = makeWindow();
    win.loadURL.mockClear();
    wm.repointMainWindow('http://127.0.0.1:4200');
    expect(win.loadURL).toHaveBeenCalledWith('http://127.0.0.1:4200');
    expect(wm.getAppUrl()).toBe('http://127.0.0.1:4200');
    expect(win.focus).toHaveBeenCalled();
  });

  it('creates a window when none exists', () => {
    const { wm, win } = makeWindow();
    win.destroyed = true;
    win.emit('closed');
    wm.repointMainWindow('http://127.0.0.1:4200');
    expect(FakeBrowserWindow.instances).toHaveLength(2);
    expect(FakeBrowserWindow.instances[1]!.loadURL).toHaveBeenCalledWith('http://127.0.0.1:4200');
  });
});
