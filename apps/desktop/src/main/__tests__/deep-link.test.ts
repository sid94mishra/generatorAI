// G-08: the deep-link handler per OS path. macOS delivers `open-url` (possibly
// before `ready`, with no window); Windows/Linux deliver argv (cold start after
// the window exists, warm start through `second-instance`). Every path must end
// in one `navigateTo` with the filtered route; the window manager holds it
// until the app page has loaded (window-manager.test.ts).

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  ready: false,
  listeners: new Map<string, (...args: unknown[]) => void>(),
  window: null as { isDestroyed: () => boolean } | null,
  navigateTo: vi.fn(),
  sendCommand: vi.fn(),
  restoreFromTray: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    isReady: () => state.ready,
    on: (event: string, fn: (...args: unknown[]) => void) => state.listeners.set(event, fn),
    setAsDefaultProtocolClient: vi.fn(),
  },
}));
vi.mock('../window-manager', () => ({
  getWindowManager: () => ({
    navigateTo: state.navigateTo,
    sendCommand: state.sendCommand,
    restoreFromTray: state.restoreFromTray,
    getMainWindow: () => state.window,
  }),
}));
vi.mock('../logger', () => ({ log: { info: state.logInfo, warn: state.logWarn, error: vi.fn() } }));

import { findDeepLinkInArgv, handleDeepLink, registerDeepLinks } from '../deep-link';

beforeEach(() => {
  state.ready = false;
  state.window = null;
  state.listeners.clear();
  state.navigateTo.mockReset();
  state.sendCommand.mockReset();
  state.restoreFromTray.mockReset();
  state.logInfo.mockReset();
  state.logWarn.mockReset();
});

describe('macOS open-url', () => {
  it('cold start: a link before ready is handed to navigateTo and no window is forced', () => {
    registerDeepLinks();
    const event = { preventDefault: vi.fn() };
    state.listeners.get('open-url')!(event, 'generatorai://pair?code=ABCD-EFGH-JKLM');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(state.navigateTo).toHaveBeenCalledWith('/?pair=ABCD-EFGH-JKLM');
    expect(state.restoreFromTray).not.toHaveBeenCalled();
  });

  it('warm start with every window closed: brings a window back so the held route is applied', () => {
    state.ready = true;
    registerDeepLinks();
    state.listeners.get('open-url')!({ preventDefault: vi.fn() }, 'generatorai://chats/c1?dock=changes&x=1');
    expect(state.navigateTo).toHaveBeenCalledWith('/chats/c1?dock=changes');
    expect(state.restoreFromTray).toHaveBeenCalledTimes(1);
  });

  it('warm start with a window: navigates only', () => {
    state.ready = true;
    state.window = { isDestroyed: () => false };
    registerDeepLinks();
    state.listeners.get('open-url')!({ preventDefault: vi.fn() }, 'generatorai://workflows');
    expect(state.navigateTo).toHaveBeenCalledWith('/workflows');
    expect(state.restoreFromTray).not.toHaveBeenCalled();
  });
});

describe('Windows / Linux argv', () => {
  it('cold start: process.argv link → navigateTo with the filtered route', () => {
    state.ready = true;
    state.window = { isDestroyed: () => false };
    const link = findDeepLinkInArgv(['C:\\GeneratorAI.exe', 'generatorai://pair/?code=ABCD-EFGH-JKLM']);
    handleDeepLink(link!);
    expect(state.navigateTo).toHaveBeenCalledWith('/?pair=ABCD-EFGH-JKLM');
  });

  it('warm start: second-instance argv with Chromium switches', () => {
    state.ready = true;
    state.window = { isDestroyed: () => false };
    const link = findDeepLinkInArgv(['/usr/bin/generatorai', '--no-sandbox', 'generatorai://chats/c1?run=r1&tab=x#h']);
    handleDeepLink(link!);
    expect(state.navigateTo).toHaveBeenCalledWith('/chats/c1?run=r1&tab=x');
  });

  it('ignores a non-link and never logs the pairing code', () => {
    handleDeepLink('https://example.com');
    expect(state.navigateTo).not.toHaveBeenCalled();
    handleDeepLink('generatorai://pair?code=SECRET-CODE-1234');
    expect(JSON.stringify(state.logInfo.mock.calls)).not.toContain('SECRET');
  });
});

describe('generatorai://command/<id> (06 §8, P3-06)', () => {
  it('macOS cold start: open-url before ready hands the command to the window manager, which holds it', () => {
    registerDeepLinks();
    state.listeners.get('open-url')!({ preventDefault: vi.fn() }, 'generatorai://command/chat.new');
    expect(state.sendCommand).toHaveBeenCalledWith('chat.new');
    expect(state.navigateTo).not.toHaveBeenCalled();
    expect(state.restoreFromTray).not.toHaveBeenCalled();
  });

  it('macOS warm start with every window closed: brings a window back for the held command', () => {
    state.ready = true;
    registerDeepLinks();
    state.listeners.get('open-url')!({ preventDefault: vi.fn() }, 'generatorai://command/workflow.new');
    expect(state.sendCommand).toHaveBeenCalledWith('workflow.new');
    expect(state.restoreFromTray).toHaveBeenCalledTimes(1);
  });

  it('Windows JumpList / Linux .desktop action: second-instance argv runs the command', () => {
    state.ready = true;
    state.window = { isDestroyed: () => false };
    const link = findDeepLinkInArgv(['C:\\GeneratorAI.exe', '--allow-file-access', '"generatorai://command/chat.new"']);
    handleDeepLink(link!);
    expect(state.sendCommand).toHaveBeenCalledWith('chat.new');
    expect(state.navigateTo).not.toHaveBeenCalled();
  });

  it('a command that is not allowlisted is ignored and logged, never routed', () => {
    state.ready = true;
    state.window = { isDestroyed: () => false };
    for (const url of [
      'generatorai://command/app.settings',
      'generatorai://command/window.reload',
      'generatorai://command/devtools.toggle',
      'generatorai://command/nope',
      'generatorai://command/',
      'generatorai://command/chat.new/extra',
    ]) {
      handleDeepLink(url);
    }
    expect(state.sendCommand).not.toHaveBeenCalled();
    expect(state.navigateTo).not.toHaveBeenCalled();
    expect(state.logWarn).toHaveBeenCalledTimes(6);
  });
});
