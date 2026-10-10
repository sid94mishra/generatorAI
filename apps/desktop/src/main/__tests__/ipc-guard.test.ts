// Every bridge channel must refuse anyone who is not the main window's top
// frame. The guard is exercised with fake events shaped like Electron's, and
// `ipc.ts` is checked at source level so a handler can never be registered
// around the guard.

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn() },
  ipcMain: { handle: vi.fn() },
}));

import { createIpcGuard, rejectionReason, UntrustedIpcSenderError, type GuardableEvent } from '../ipc-guard';
import { isLocalOnlyChannel, isSameOrigin, REMOTE_ALLOWED_CHANNELS } from '../ipc-scope';
import { IPC } from '../../shared/ipc';
import { BROWSER_IPC } from '../../shared/browser-ipc';

const APP = 'http://127.0.0.1:3100';

function fakeWindow(id: number) {
  const mainFrame = { url: `${APP}/` };
  const win = {
    isDestroyed: () => false,
    webContents: { id, mainFrame },
  };
  return { win, mainFrame };
}

function deps(main: ReturnType<typeof fakeWindow>['win'] | null, owner?: unknown) {
  const log = { warn: vi.fn() };
  return {
    log,
    d: {
      getMainWindow: () => main as never,
      getAppUrl: () => APP,
      fromWebContents: owner === undefined ? undefined : () => owner as never,
      log,
    },
  };
}

describe('rejectionReason', () => {
  it('trusts the main window top frame on the app origin', () => {
    const { win, mainFrame } = fakeWindow(1);
    const event: GuardableEvent = { sender: { id: 1, mainFrame }, senderFrame: mainFrame };
    expect(rejectionReason(event, deps(win, win).d)).toBeNull();
  });

  it('refuses a browser-tab WebContentsView (different webContents, not owned by the window)', () => {
    const { win } = fakeWindow(1);
    const tabFrame = { url: 'https://some-site.example/' };
    const event: GuardableEvent = { sender: { id: 7, mainFrame: tabFrame }, senderFrame: tabFrame };
    expect(rejectionReason(event, deps(win, null).d)).toMatch(/not the main window/);
  });

  it('refuses another window even when it is a BrowserWindow', () => {
    const { win } = fakeWindow(1);
    const other = fakeWindow(2);
    const event: GuardableEvent = {
      sender: { id: 2, mainFrame: other.mainFrame },
      senderFrame: other.mainFrame,
    };
    expect(rejectionReason(event, deps(win, other.win).d)).toMatch(/not the main window/);
  });

  it('refuses a sub-frame of the main window', () => {
    const { win, mainFrame } = fakeWindow(1);
    const iframe = { url: `${APP}/widget` };
    const event: GuardableEvent = { sender: { id: 1, mainFrame }, senderFrame: iframe };
    expect(rejectionReason(event, deps(win, win).d)).toBe('sender is a sub-frame');
  });

  it('refuses the main frame once it has navigated off the app origin', () => {
    const { win } = fakeWindow(1);
    const mainFrame = { url: 'https://evil.example/' };
    win.webContents.mainFrame = mainFrame;
    const event: GuardableEvent = { sender: { id: 1, mainFrame }, senderFrame: mainFrame };
    expect(rejectionReason(event, deps(win, win).d)).toMatch(/frame origin https:\/\/evil\.example is not the app/);
  });

  it('refuses the userinfo look-alike origin', () => {
    const { win } = fakeWindow(1);
    const mainFrame = { url: 'http://127.0.0.1:3100@evil.com/' };
    win.webContents.mainFrame = mainFrame;
    const event: GuardableEvent = { sender: { id: 1, mainFrame }, senderFrame: mainFrame };
    expect(rejectionReason(event, deps(win, win).d)).not.toBeNull();
  });

  it('refuses everything while there is no main window', () => {
    const event: GuardableEvent = { sender: { id: 1 } };
    expect(rejectionReason(event, deps(null).d)).toBe('no main window');
  });

  it('refuses when the owning window lookup disagrees', () => {
    const { win, mainFrame } = fakeWindow(1);
    const event: GuardableEvent = { sender: { id: 1, mainFrame }, senderFrame: mainFrame };
    expect(rejectionReason(event, deps(win, null).d)).toBe('sender is not owned by the main window');
  });
});

describe('guardedHandle', () => {
  it('runs the handler for a trusted sender and throws + logs for an untrusted one', async () => {
    const { win, mainFrame } = fakeWindow(1);
    const { d, log } = deps(win, win);
    const registered = new Map<string, (...args: unknown[]) => unknown>();
    const guard = createIpcGuard(d, (channel, listener) => {
      registered.set(channel, listener as never);
    });
    const handler = vi.fn((_e: unknown, a: number, b: number) => a + b);
    guard.guardedHandle('math:add', handler as never);

    const trusted: GuardableEvent = { sender: { id: 1, mainFrame }, senderFrame: mainFrame };
    expect(registered.get('math:add')!(trusted, 2, 3)).toBe(5);
    expect(handler).toHaveBeenCalledTimes(1);

    const tabFrame = { url: 'https://site.example/' };
    const untrusted: GuardableEvent = { sender: { id: 9, mainFrame: tabFrame }, senderFrame: tabFrame };
    expect(() => registered.get('math:add')!(untrusted, 2, 3)).toThrow(UntrustedIpcSenderError);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      '[ipc] refused call from untrusted sender',
      expect.objectContaining({ channel: 'math:add' }),
    );
    expect(guard.channels()).toEqual(['math:add']);
  });
});

describe('ipc.ts registers every channel through the guard', () => {
  it('has no bare ipcMain.handle / ipcMain.on left', () => {
    const src = readFileSync(join(__dirname, '..', 'ipc.ts'), 'utf8');
    expect(src).not.toMatch(/ipcMain\.(handle|on)\(/);
    const guarded = src.match(/guardedHandle\(/g) ?? [];
    // All 49 bridge channels (IPC.* + BROWSER_IPC.*) from the preload contract —
    // 45 at P0, minus getTheme/setTheme plus setAppearance (P1-T8, D-25), plus
    // G-03's getServers/switchServer/addServer, G-04's
    // getUpdateState/installUpdate (P2-03) and watchUpdates (P1-review P2-R3),
    // minus getWindowChrome (P3-04: a preload launch argument now, 06 §3.6).
    expect(guarded.length).toBe(49);
  });
});

// The window can show ANOTHER machine's server (remote mode, D-126). Its page is
// the main window's top frame on the window's current origin, so it passes the
// checks above; channels that act on this computer must still refuse it.
describe('local-only channels refuse a remote server page', () => {
  const LOCAL = 'http://127.0.0.1:3100';
  const REMOTE = 'https://studio.tail1234.ts.net';

  function windowShowing(url: string) {
    const mainFrame = { url: `${url}/chats` };
    const win = { isDestroyed: () => false, webContents: { id: 1, mainFrame } };
    const log = { warn: vi.fn() };
    const d = {
      getMainWindow: () => win as never,
      getAppUrl: () => url,
      fromWebContents: () => win as never,
      log,
      isLocalOnlyChannel,
      isLocalOrigin: (frameUrl: string | undefined) => isSameOrigin(frameUrl, LOCAL),
    };
    const event: GuardableEvent = { sender: { id: 1, mainFrame }, senderFrame: mainFrame };
    return { d, event, log };
  }

  it('lets this computer\'s server call a local-only channel and refuses the remote page', () => {
    const local = windowShowing(LOCAL);
    expect(rejectionReason(local.event, local.d, { localOnly: true })).toBeNull();
    const remote = windowShowing(REMOTE);
    expect(rejectionReason(remote.event, remote.d)).toBeNull(); // window-level calls stay open
    expect(rejectionReason(remote.event, remote.d, { localOnly: true })).toMatch(/is not this computer's server/);
  });

  it('fails closed when no local-origin check is wired or the frame URL is missing', () => {
    const { d, event } = windowShowing(LOCAL);
    expect(rejectionReason(event, { ...d, isLocalOrigin: undefined }, { localOnly: true })).not.toBeNull();
    expect(rejectionReason({ sender: event.sender, senderFrame: null }, d, { localOnly: true })).not.toBeNull();
  });

  it('guardedHandle applies the default-deny scope: a remote page reaches find, not restart or the settings file', () => {
    const remote = windowShowing(REMOTE);
    const registered = new Map<string, (...args: unknown[]) => unknown>();
    const guard = createIpcGuard(remote.d, (channel, listener) => registered.set(channel, listener as never));
    for (const channel of [IPC.findInPage, IPC.restartServer, IPC.setSetting, BROWSER_IPC.navigate]) {
      guard.guardedHandle(channel, () => 'ran');
    }
    expect(registered.get(IPC.findInPage)!(remote.event)).toBe('ran');
    for (const channel of [IPC.restartServer, IPC.setSetting, BROWSER_IPC.navigate]) {
      expect(() => registered.get(channel)!(remote.event)).toThrow(UntrustedIpcSenderError);
    }
    expect(guard.localOnlyChannels()).toEqual([IPC.restartServer, IPC.setSetting, BROWSER_IPC.navigate]);
    expect(guard.isLocalSender(remote.event)).toBe(false);
    const local = windowShowing(LOCAL);
    expect(createIpcGuard(local.d, () => undefined).isLocalSender(local.event)).toBe(true);
  });

  it('classifies every bridge channel: what acts on this computer is local-only', () => {
    const localOnly = [
      IPC.getServerStatus,
      IPC.restartServer,
      IPC.selectDirectory,
      IPC.selectFile,
      IPC.saveFile,
      IPC.showItemInFolder,
      IPC.getSetting,
      IPC.setSetting,
      IPC.installUpdate,
      IPC.requestPairingCode,
      ...Object.values(BROWSER_IPC).filter((c) => c !== BROWSER_IPC.available),
    ];
    for (const channel of localOnly) expect(isLocalOnlyChannel(channel), channel).toBe(true);
    // The remote allowlist names real channels only, and nothing sensitive.
    const all = new Set<string>([...Object.values(IPC), ...Object.values(BROWSER_IPC)]);
    for (const channel of REMOTE_ALLOWED_CHANNELS) expect(all.has(channel), channel).toBe(true);
    expect([...REMOTE_ALLOWED_CHANNELS].filter((c) => (localOnly as readonly string[]).includes(c))).toEqual([]);
  });
});
