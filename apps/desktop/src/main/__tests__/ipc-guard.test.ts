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
    // All 45 bridge channels (IPC.* + BROWSER_IPC.*) from the preload contract.
    expect(guarded.length).toBe(45);
  });
});
