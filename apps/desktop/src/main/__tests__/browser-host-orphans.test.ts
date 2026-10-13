// Who hides a native browser view when the page that placed it is gone?
//
// The view is a child of the WINDOW, but it is positioned, shown, hidden and
// destroyed by the PAGE — React mirrors a placeholder's rect over IPC and
// releases the view in an effect cleanup. Replace the document (reload, a
// Cmd-click on an in-app link, "Back to home", a backend switch, a renderer
// crash) and none of those cleanups run. The view used to stay exactly where
// it was, visible, over whatever screen came next, until the window closed.
//
// These pin the main-process side of the contract: a committed document
// change hides every view at once, the same tab id can claim its view back,
// and a view nobody claims is destroyed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (...args: unknown[]) => unknown;

const { FakeView, views, FakeAgentWindow } = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => unknown;
  const views: InstanceType<typeof FakeView>[] = [];
  class FakeTabContents {
    destroyed = false;
    session = {};
    on(_e: string, _fn: Listener) { return this; }
    once(_e: string, _fn: Listener) { return this; }
    setWindowOpenHandler() {}
    /** Like Electron: no URL until the first load commits (a tick after loadURL starts). */
    url = '';
    loadURL = vi.fn((url: string): Promise<void> => Promise.resolve().then(() => { this.url = url; }));
    getURL = () => this.url;
    getTitle = () => '';
    isLoading = () => false;
    isDestroyed = () => this.destroyed;
    close = vi.fn(() => { this.destroyed = true; });
    navigationHistory = { canGoBack: () => false, canGoForward: () => false };
    executeJavaScript = vi.fn(async () => undefined);
  }
  class FakeView {
    webContents = new FakeTabContents();
    visible = true;
    bounds = { x: 0, y: 0, width: 0, height: 0 };
    setVisible = vi.fn((v: boolean) => { this.visible = v; });
    setBounds = vi.fn((b: { x: number; y: number; width: number; height: number }) => { this.bounds = b; });
    constructor(_opts: unknown) { views.push(this); }
  }
  /** The hidden window agent tabs live in (D-105). */
  class FakeAgentWindow {
    static last: FakeAgentWindow | null = null;
    children: unknown[] = [];
    destroyed = false;
    opts: Record<string, unknown>;
    contentView = {
      addChildView: (v: unknown) => { this.children.push(v); },
      removeChildView: (v: unknown) => { this.children = this.children.filter((c) => c !== v); },
    };
    constructor(opts: Record<string, unknown>) { this.opts = opts; FakeAgentWindow.last = this; }
    on() { return this; }
    isDestroyed = () => this.destroyed;
    destroy = vi.fn(() => { this.destroyed = true; });
    loadURL = vi.fn(async () => undefined);
  }
  return { FakeView, views, FakeAgentWindow };
});

vi.mock('electron', () => ({
  WebContentsView: FakeView,
  BrowserWindow: FakeAgentWindow,
  session: { fromPartition: () => ({}) },
}));
vi.mock('../logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../session-hardening', () => ({ hardenBrowserTabSession: vi.fn() }));
vi.mock('../cdp/ScopedCdpProxy', () => ({
  ScopedCdpProxy: class { start = vi.fn(async () => 'ws://x'); stop = vi.fn(async () => undefined); },
}));
vi.mock('../cdp/ipc-token', () => ({ getIpcToken: () => 'token' }));
const server = vi.hoisted(() => ({ url: null as string | null }));
vi.mock('../server-manager', () => ({ getServerManager: () => ({ url: server.url, getUrl: () => server.url, getState: () => ({}) }) }));

import { NativeBrowserHost, ORPHAN_GRACE_MS } from '../browser-host';

class FakeWindow {
  listeners = new Map<string, Listener[]>();
  children: unknown[] = [];
  contentView = {
    addChildView: (v: unknown) => { this.children.push(v); },
    removeChildView: (v: unknown) => { this.children = this.children.filter((c) => c !== v); },
  };
  webContents = {
    listeners: new Map<string, Listener[]>(),
    on(event: string, fn: Listener) {
      const list = this.listeners.get(event) ?? [];
      list.push(fn);
      this.listeners.set(event, list);
      return this;
    },
    emit(event: string, ...args: unknown[]) {
      for (const fn of this.listeners.get(event) ?? []) fn(...args);
    },
  };
  isDestroyed = () => false;
  once(event: string, fn: Listener) {
    const list = this.listeners.get(event) ?? [];
    list.push(fn);
    this.listeners.set(event, list);
    return this;
  }
}

const RECT = { x: 939, y: 161, width: 501, height: 709 };

function openTab(host: NativeBrowserHost, tabId = 'browser-1') {
  host.create(tabId, 'ws-1', true);
  host.setBounds(tabId, RECT);
  host.setVisible(tabId, true);
  return views[views.length - 1]!;
}

let host: NativeBrowserHost;
let win: FakeWindow;

beforeEach(() => {
  vi.useFakeTimers();
  views.length = 0;
  process.env['GENERATORAI_NATIVE_BROWSER'] = '1';
  host = new NativeBrowserHost();
  win = new FakeWindow();
  host.attachOwnerWindow(win as never);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a native browser view whose document went away', () => {
  it('is on screen while its page is', () => {
    const view = openTab(host);
    expect(view.visible).toBe(true);
    expect(view.bounds).toEqual(RECT);
  });

  it('is hidden the moment a new app document commits', () => {
    const view = openTab(host);
    win.webContents.emit('did-navigate');
    expect(view.visible).toBe(false);
    // Still alive: the reloaded page may be about to ask for it back.
    expect(win.children).toContain(view);
  });

  it('is hidden when the app renderer dies', () => {
    const view = openTab(host);
    win.webContents.emit('render-process-gone');
    expect(view.visible).toBe(false);
  });

  it('is left alone by a route change inside the page', () => {
    // pushState navigation — React unmounts the pane and releases the view
    // itself. Main must not second-guess it.
    const view = openTab(host);
    win.webContents.emit('did-navigate-in-page');
    win.webContents.emit('did-start-navigation');
    expect(view.visible).toBe(true);
  });

  it('cannot be put back on screen by a stale "show" from the old page', () => {
    const view = openTab(host);
    win.webContents.emit('did-navigate');
    host.setVisible('browser-1', true);
    expect(view.visible).toBe(false);
  });

  it('is handed back, page intact, to the document that asks for the same tab', () => {
    const view = openTab(host);
    win.webContents.emit('did-navigate');

    host.create('browser-1', 'ws-1', false);
    expect(views).toHaveLength(1); // adopted, not rebuilt
    expect(view.visible).toBe(false); // hidden until the new page places it
    host.setVisible('browser-1', true);
    expect(view.visible).toBe(true);

    // …and the reaper leaves a claimed view alone.
    vi.advanceTimersByTime(ORPHAN_GRACE_MS + 1);
    expect(win.children).toContain(view);
    expect(view.webContents.close).not.toHaveBeenCalled();
  });

  it('is destroyed when nobody claims it', () => {
    const view = openTab(host);
    win.webContents.emit('did-navigate');
    vi.advanceTimersByTime(ORPHAN_GRACE_MS - 1);
    expect(win.children).toContain(view);
    vi.advanceTimersByTime(2);
    expect(win.children).not.toContain(view);
    expect(view.webContents.close).toHaveBeenCalledTimes(1);
  });

  it('reaps only the unclaimed views when several tabs were open', () => {
    const kept = openTab(host, 'browser-kept');
    const dropped = openTab(host, 'browser-dropped');
    win.webContents.emit('did-navigate');
    host.create('browser-kept', 'ws-1', false);
    vi.advanceTimersByTime(ORPHAN_GRACE_MS + 1);
    expect(win.children).toContain(kept);
    expect(win.children).not.toContain(dropped);
  });
});

describe('restoring a page into a tab that was only just created', () => {
  it('does not start the navigation until the discovery page has landed', async () => {
    // `create()` starts `about:blank#gai-…`. The renderer asks for the
    // remembered page the moment `create()` returns — a few milliseconds
    // later — and two in-flight navigations do not commit in request order:
    // the blank page won and the tab came back empty.
    let landed!: () => void;
    const gate = new Promise<void>((resolve) => { landed = resolve; });
    const order: string[] = [];
    host.create('browser-2', 'ws-1', true);
    const tab = views[0]!.webContents;
    // The discovery load already started inside create(); hold it "in flight".
    tab.loadURL.mockImplementation(async (url: string) => { order.push(url); });
    (host as unknown as { sessions: Map<string, { ready: Promise<void> }> }).sessions.get('browser-2')!.ready = gate;

    const pending = host.navigate('browser-2', 'https://example.com/');
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([]); // held back while the first load is in flight
    landed();
    await pending;
    expect(order).toEqual(['https://example.com/']);
  });

  it('gives up cleanly when the tab is closed while it waits', async () => {
    host.create('browser-3', 'ws-1', true);
    let landed!: () => void;
    (host as unknown as { sessions: Map<string, { ready: Promise<void> }> }).sessions.get('browser-3')!.ready =
      new Promise<void>((resolve) => { landed = resolve; });
    const pending = host.navigate('browser-3', 'https://example.com/');
    host.destroy('browser-3');
    landed();
    await expect(pending).rejects.toThrow(/No browser tab/);
  });
});

describe('the agent tab (D-105)', () => {
  it('lives in a hidden window at a desktop size, shown there, and is made active when the workspace has no tab', () => {
    host.ensureAgentTab('ws-9');
    const view = views[views.length - 1]!;
    // A view hidden in the app window renders at 0x0; in the never-shown agent window it is shown and laid out.
    expect(FakeAgentWindow.last!.opts).toMatchObject({ show: false, paintWhenInitiallyHidden: true });
    expect(FakeAgentWindow.last!.children).toContain(view);
    expect(win.children).not.toContain(view);
    expect(view.visible).toBe(true);
    expect(view.bounds).toEqual({ x: 0, y: 0, width: 1280, height: 800 });
    expect(host.describe('agent-ws-9').workspaceId).toBe('ws-9');
  });

  it('is not created when the workspace already has a tab', () => {
    openTab(host);
    const count = views.length;
    host.ensureAgentTab('ws-1');
    expect(views.length).toBe(count);
  });

  it('hands its page to the Browser tab the person opens, then goes away', async () => {
    host.ensureAgentTab('ws-1');
    const agent = views[views.length - 1]!;
    agent.webContents.getURL = () => 'https://example.com/';
    // Opening the Browser dock creates its tab: it takes over at once, before any visibility tick — while the new
    // tab still reports no URL.
    host.create('browser-1', 'ws-1', false);
    const dock = views[views.length - 1]!;
    await vi.waitFor(() => expect(dock.webContents.loadURL).toHaveBeenCalledWith('https://example.com/'));
    expect(agent.webContents.close).toHaveBeenCalled();
    expect(win.children).not.toContain(agent);
    // No agent tab left: the hidden window goes too (it would keep the app from quitting on Windows / Linux).
    expect(FakeAgentWindow.last!.destroy).toHaveBeenCalled();
  });

  it('clears the server endpoint when it hands over, before the Browser tab pushes its own (U-60)', async () => {
    server.url = 'http://server';
    const pushed: Array<string | null> = [];
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      pushed.push((JSON.parse(init.body) as { wsUrl: string | null }).wsUrl);
      return { ok: true, status: 200 };
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      host.ensureAgentTab('ws-1');
      await vi.waitFor(() => expect(pushed).toEqual(['ws://x']));
      host.create('browser-1', 'ws-1', false);
      // Without the clear, the server kept the dead agent tab's endpoint until the new one landed and the dock's
      // start dialled it: ECONNREFUSED.
      await vi.waitFor(() => expect(pushed).toEqual(['ws://x', null, 'ws://x']));
    } finally {
      vi.unstubAllGlobals();
      server.url = null;
    }
  });
});
