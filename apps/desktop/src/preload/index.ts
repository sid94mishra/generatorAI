// ────────────────────────────────────────────────────────────────
// Preload — runs in the renderer (the GeneratorAI web app) before page
// scripts. Exposes a minimal, safe `window.generatoraiDesktop` bridge via
// contextBridge. The SPA reaches it only through apps/web/src/lib/desktop.ts
// (the native folder picker: `getAppInfo().localServer` + `selectDirectory`, D-136).
// ────────────────────────────────────────────────────────────────

import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  IPC_EVENT,
  type AppInfo,
  type ServerStatus,
  type DesktopAppearancePush,
  type DesktopAppearanceRequest,
  type SaveFileOptions,
  type DesktopCommand,
  type DesktopPairingCode,
  type DesktopServerEntry,
  type DesktopShellStatePush,
  type FindInPageResult,
  type DesktopUpdateState,
  type NavHistoryState,
  type WindowChrome,
  type WindowStateChange,
} from '../shared/ipc';
import { parseWindowChromeArg } from '../shared/window-chrome-arg';
import {
  BROWSER_IPC,
  BROWSER_IPC_EVENT,
  type AnnotationPalette,
  type BrowserBounds,
  type NativeBrowserDescriptor,
  type NativeBrowserEvent,
} from '../shared/browser-ipc';

type Unsubscribe = () => void;

/**
 * The last Back / Forward state main reported for this document. Main sends it
 * on every navigation and when the page finishes loading, which can be before
 * a component subscribes (the strip, or a sidebar row mounted later), so each
 * new subscriber is handed the current value at once. Registered before any
 * subscriber, so it is always current when theirs runs.
 */
let navHistory: NavHistoryState | undefined;
ipcRenderer.on(IPC_EVENT.navHistoryChanged, (_e: unknown, state: NavHistoryState) => {
  navHistory = state;
});

const api = {
  isDesktop: true as const,

  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.getAppInfo),
  getServerStatus: (): Promise<ServerStatus> => ipcRenderer.invoke(IPC.getServerStatus),
  restartServer: (): Promise<void> => ipcRenderer.invoke(IPC.restartServer),

  /**
   * Requests a single-use pairing code so the renderer can enrol itself as a
   * device against the embedded server. Only the shell can call this — it is
   * gated on a per-launch handshake token held by the main process.
   */
  requestPairingCode: (deviceName?: string): Promise<DesktopPairingCode | null> =>
    ipcRenderer.invoke(IPC.requestPairingCode, deviceName),

  selectDirectory: (opts?: { defaultPath?: string }): Promise<string | null> =>
    ipcRenderer.invoke(IPC.selectDirectory, opts),
  selectFile: (filters?: { name: string; extensions: string[] }[]): Promise<string | null> =>
    ipcRenderer.invoke(IPC.selectFile, filters),
  saveFile: (opts: SaveFileOptions): Promise<string | null> =>
    ipcRenderer.invoke(IPC.saveFile, opts),
  /** Resolves false when the path does not exist on this machine. */
  findInPage: (text: string, opts?: { forward?: boolean; findNext?: boolean }): Promise<void> =>
    ipcRenderer.invoke(IPC.findInPage, { text, ...opts }),

  stopFindInPage: (): Promise<void> => ipcRenderer.invoke(IPC.stopFindInPage),

  onFoundInPage: (cb: (r: FindInPageResult) => void): (() => void) => {
    const handler = (_e: unknown, r: FindInPageResult) => cb(r);
    ipcRenderer.on(IPC_EVENT.foundInPage, handler);
    return () => ipcRenderer.removeListener(IPC_EVENT.foundInPage, handler);
  },

  /** A mode picked in the native View ▸ Appearance menu; ThemeProvider applies it (D-25). */
  onAppearanceRequest: (cb: (request: DesktopAppearanceRequest) => void): (() => void) => {
    const handler = (_e: unknown, r: DesktopAppearanceRequest) => cb(r);
    ipcRenderer.on(IPC_EVENT.appearanceRequest, handler);
    return () => ipcRenderer.removeListener(IPC_EVENT.appearanceRequest, handler);
  },

  /** The renderer's appearance, mirrored by main (background, caption glyphs, themeSource). */
  setAppearance: (appearance: DesktopAppearancePush): Promise<void> =>
    ipcRenderer.invoke(IPC.setAppearance, appearance),

  showItemInFolder: (fullPath: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.showItemInFolder, fullPath),

  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.openExternal, url),

  getSetting: <T = unknown>(key: string): Promise<T | undefined> =>
    ipcRenderer.invoke(IPC.getSetting, key),
  setSetting: (key: string, value: unknown): Promise<void> =>
    ipcRenderer.invoke(IPC.setSetting, key, value),

  reload: (): Promise<void> => ipcRenderer.invoke(IPC.reload),
  toggleDevtools: (): Promise<void> => ipcRenderer.invoke(IPC.toggleDevtools),

  // ── Window chrome ──────────────────────────────────────────────
  //
  // The app draws its own title bar, so the renderer must know how much room
  // the OS window controls occupy — traffic lights sit top-LEFT on macOS,
  // min/max/close sit top-RIGHT everywhere else. Static per process, so main
  // passes it as a launch argument and it is a plain value here, readable
  // before first paint (06 §3.6). `undefined` when the argument is missing or
  // malformed: the web app then uses its native layout.
  chrome: parseWindowChromeArg(process.argv) as WindowChrome | undefined,

  window: {
    toggleMaximize: (): Promise<void> => ipcRenderer.invoke(IPC.windowMaximizeToggle),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowIsMaximized),
  },

  /**
   * Mirrors renderer UI state into the native menu, so `View ▸ Toggle
   * Sidebar` shows a real checkmark and `Back` greys out when it would no-op.
   */
  setMenuState: (state: Partial<DesktopShellStatePush>): Promise<void> =>
    ipcRenderer.invoke(IPC.setMenuState, state),

  // ── Server switcher (G-03) ──
  servers: {
    list: (): Promise<DesktopServerEntry[]> => ipcRenderer.invoke(IPC.getServers),
    switchTo: (id: string): Promise<void> => ipcRenderer.invoke(IPC.switchServer, id),
    add: (): Promise<void> => ipcRenderer.invoke(IPC.addServer),
    onChanged: (cb: () => void): Unsubscribe => {
      const handler = () => cb();
      ipcRenderer.on(IPC_EVENT.serversChanged, handler);
      return () => ipcRenderer.removeListener(IPC_EVENT.serversChanged, handler);
    },
  },

  // ── Updater (G-04) ──
  updates: {
    getState: (): Promise<DesktopUpdateState> => ipcRenderer.invoke(IPC.getUpdateState),
    install: (): Promise<void> => ipcRenderer.invoke(IPC.installUpdate),
    /**
     * Also tells main someone is listening: main skips its native "update
     * ready" dialog only while a renderer has subscribed and the window is
     * visible (P1-review P2-R3).
     */
    onChange: (cb: (state: DesktopUpdateState) => void): Unsubscribe => {
      const handler = (_e: unknown, state: DesktopUpdateState) => cb(state);
      ipcRenderer.on(IPC_EVENT.updateStateChanged, handler);
      void ipcRenderer.invoke(IPC.watchUpdates, true).catch(() => undefined);
      // Idempotent: main counts subscriptions, so a second call must not
      // report a second unsubscribe (P1-review P2-R39).
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        ipcRenderer.removeListener(IPC_EVENT.updateStateChanged, handler);
        void ipcRenderer.invoke(IPC.watchUpdates, false).catch(() => undefined);
      };
    },
  },

  // Subscriptions (main → renderer)
  onNavigate: (cb: (path: string) => void): Unsubscribe => {
    const handler = (_e: unknown, path: string) => cb(path);
    ipcRenderer.on(IPC_EVENT.navigate, handler);
    return () => ipcRenderer.removeListener(IPC_EVENT.navigate, handler);
  },
  onServerStatus: (cb: (status: ServerStatus) => void): Unsubscribe => {
    const handler = (_e: unknown, status: ServerStatus) => cb(status);
    ipcRenderer.on(IPC_EVENT.serverStatus, handler);
    return () => ipcRenderer.removeListener(IPC_EVENT.serverStatus, handler);
  },
  onCommand: (cb: (command: DesktopCommand) => void): Unsubscribe => {
    const handler = (_e: unknown, command: DesktopCommand) => cb(command);
    ipcRenderer.on(IPC_EVENT.command, handler);
    return () => ipcRenderer.removeListener(IPC_EVENT.command, handler);
  },
  /**
   * Whether Back / Forward can move, from Chromium's session history (06 §3.4).
   * Calls `cb` at once with the current value when main has reported one for
   * this document, then on every change.
   */
  onNavHistoryChanged: (cb: (state: NavHistoryState) => void): Unsubscribe => {
    const handler = (_e: unknown, state: NavHistoryState) => cb(state);
    ipcRenderer.on(IPC_EVENT.navHistoryChanged, handler);
    if (navHistory) cb(navHistory);
    return () => ipcRenderer.removeListener(IPC_EVENT.navHistoryChanged, handler);
  },
  /** Maximise/fullscreen/focus changes, so a custom title bar can restyle. */
  onWindowStateChanged: (cb: (state: WindowStateChange) => void): Unsubscribe => {
    const handler = (_e: unknown, state: WindowStateChange) => cb(state);
    ipcRenderer.on(IPC_EVENT.windowStateChanged, handler);
    return () => ipcRenderer.removeListener(IPC_EVENT.windowStateChanged, handler);
  },

  // ── Native browser (Phase 2, feature-flagged) ──
  //
  // When `GENERATORAI_DESKTOP_NATIVE_BROWSER=1` on the main side,
  // `browser.available()` resolves true and the SPA can drive a native
  // `WebContentsView` per workspace. When off, `available` resolves
  // false and the SPA falls through to the screencast path.
  browser: {
    available: (): Promise<boolean> => ipcRenderer.invoke(BROWSER_IPC.available),
    create: (tabId: string, workspaceId: string, active?: boolean): Promise<NativeBrowserDescriptor> =>
      ipcRenderer.invoke(BROWSER_IPC.create, tabId, workspaceId, active),
    destroy: (tabId: string): Promise<void> =>
      ipcRenderer.invoke(BROWSER_IPC.destroy, tabId),
    setActiveTab: (workspaceId: string, tabId: string): Promise<void> =>
      ipcRenderer.invoke(BROWSER_IPC.setActiveTab, workspaceId, tabId),
    setBounds: (tabId: string, bounds: BrowserBounds): Promise<void> =>
      ipcRenderer.invoke(BROWSER_IPC.setBounds, tabId, bounds),
    setVisible: (tabId: string, visible: boolean): Promise<void> =>
      ipcRenderer.invoke(BROWSER_IPC.setVisible, tabId, visible),
    navigate: (tabId: string, url: string): Promise<NativeBrowserDescriptor> =>
      ipcRenderer.invoke(BROWSER_IPC.navigate, tabId, url),
    back: (tabId: string): Promise<void> => ipcRenderer.invoke(BROWSER_IPC.back, tabId),
    forward: (tabId: string): Promise<void> => ipcRenderer.invoke(BROWSER_IPC.forward, tabId),
    reload: (tabId: string): Promise<void> => ipcRenderer.invoke(BROWSER_IPC.reload, tabId),
    screenshot: (tabId: string): Promise<string | null> =>
      ipcRenderer.invoke(BROWSER_IPC.screenshot, tabId),
    describe: (tabId: string): Promise<NativeBrowserDescriptor> =>
      ipcRenderer.invoke(BROWSER_IPC.describe, tabId),
    openDevtools: (tabId: string, panel?: string): Promise<void> =>
      ipcRenderer.invoke(BROWSER_IPC.openDevtools, tabId, panel),
    setEmulation: (tabId: string, params: unknown): Promise<void> =>
      ipcRenderer.invoke(BROWSER_IPC.setEmulation, tabId, params),
    setZoom: (tabId: string, factor: number): Promise<void> =>
      ipcRenderer.invoke(BROWSER_IPC.setZoom, tabId, factor),
    capture: (tabId: string, mode: 'visible' | 'full'): Promise<unknown> =>
      ipcRenderer.invoke(BROWSER_IPC.capture, tabId, mode),
    captureRegion: (tabId: string, palette?: AnnotationPalette): Promise<string | null> =>
      ipcRenderer.invoke(BROWSER_IPC.captureRegion, tabId, palette),
    annotateStart: (tabId: string, palette: AnnotationPalette): Promise<void> =>
      ipcRenderer.invoke(BROWSER_IPC.annotateStart, tabId, palette),
    annotateStop: (tabId: string): Promise<void> =>
      ipcRenderer.invoke(BROWSER_IPC.annotateStop, tabId),
    annotatePoll: (tabId: string): Promise<unknown> =>
      ipcRenderer.invoke(BROWSER_IPC.annotatePoll, tabId),
    annotateSend: (tabId: string, keys?: string[]): Promise<unknown> =>
      ipcRenderer.invoke(BROWSER_IPC.annotateSend, tabId, keys),
    annotateOpen: (tabId: string, key: string): Promise<void> =>
      ipcRenderer.invoke(BROWSER_IPC.annotateOpen, tabId, key),
    annotateRemove: (tabId: string, key: string): Promise<void> =>
      ipcRenderer.invoke(BROWSER_IPC.annotateRemove, tabId, key),
    annotateClear: (tabId: string): Promise<void> =>
      ipcRenderer.invoke(BROWSER_IPC.annotateClear, tabId),

    onDidNavigate: (cb: (evt: NativeBrowserEvent) => void): Unsubscribe => {
      const handler = (_e: unknown, evt: NativeBrowserEvent) => cb(evt);
      ipcRenderer.on(BROWSER_IPC_EVENT.didNavigate, handler);
      return () => ipcRenderer.removeListener(BROWSER_IPC_EVENT.didNavigate, handler);
    },
    onDidFinishLoad: (cb: (evt: NativeBrowserEvent) => void): Unsubscribe => {
      const handler = (_e: unknown, evt: NativeBrowserEvent) => cb(evt);
      ipcRenderer.on(BROWSER_IPC_EVENT.didFinishLoad, handler);
      return () => ipcRenderer.removeListener(BROWSER_IPC_EVENT.didFinishLoad, handler);
    },
    onDidFailLoad: (cb: (evt: NativeBrowserEvent) => void): Unsubscribe => {
      const handler = (_e: unknown, evt: NativeBrowserEvent) => cb(evt);
      ipcRenderer.on(BROWSER_IPC_EVENT.didFailLoad, handler);
      return () => ipcRenderer.removeListener(BROWSER_IPC_EVENT.didFailLoad, handler);
    },
    onTitleUpdated: (cb: (evt: NativeBrowserEvent) => void): Unsubscribe => {
      const handler = (_e: unknown, evt: NativeBrowserEvent) => cb(evt);
      ipcRenderer.on(BROWSER_IPC_EVENT.titleUpdated, handler);
      return () => ipcRenderer.removeListener(BROWSER_IPC_EVENT.titleUpdated, handler);
    },
    onFaviconUpdated: (cb: (evt: NativeBrowserEvent) => void): Unsubscribe => {
      const handler = (_e: unknown, evt: NativeBrowserEvent) => cb(evt);
      ipcRenderer.on(BROWSER_IPC_EVENT.faviconUpdated, handler);
      return () => ipcRenderer.removeListener(BROWSER_IPC_EVENT.faviconUpdated, handler);
    },
    onLoadingChanged: (cb: (evt: NativeBrowserEvent) => void): Unsubscribe => {
      const handler = (_e: unknown, evt: NativeBrowserEvent) => cb(evt);
      ipcRenderer.on(BROWSER_IPC_EVENT.loadingChanged, handler);
      return () => ipcRenderer.removeListener(BROWSER_IPC_EVENT.loadingChanged, handler);
    },
  },
};

contextBridge.exposeInMainWorld('generatoraiDesktop', api);
