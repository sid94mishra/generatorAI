// ────────────────────────────────────────────────────────────────
// Preload — runs in the renderer (the GeneratorAI web app) before page
// scripts. Exposes a minimal, safe `window.generatoraiDesktop` bridge via
// contextBridge and shims a couple of browser APIs so the *unmodified* web
// app transparently uses native dialogs when running inside the desktop shell.
// ────────────────────────────────────────────────────────────────

import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  IPC_EVENT,
  type AppInfo,
  type ServerStatus,
  type ThemePreference,
  type SaveFileOptions,
  type DesktopCommand,
  type DesktopPairingCode,
  type ShellState,
  type FindInPageResult,
  type WindowChrome,
  type WindowStateChange,
} from '../shared/ipc';
import {
  BROWSER_IPC,
  BROWSER_IPC_EVENT,
  type BrowserBounds,
  type NativeBrowserDescriptor,
  type NativeBrowserEvent,
} from '../shared/browser-ipc';

type Unsubscribe = () => void;

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

  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke(IPC.selectDirectory),
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

  onThemePreferenceChanged: (cb: (theme: ThemePreference) => void): (() => void) => {
    const handler = (_e: unknown, t: ThemePreference) => cb(t);
    ipcRenderer.on(IPC_EVENT.themePreferenceChanged, handler);
    return () => ipcRenderer.removeListener(IPC_EVENT.themePreferenceChanged, handler);
  },

  showItemInFolder: (fullPath: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.showItemInFolder, fullPath),

  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.openExternal, url),

  getTheme: (): Promise<ThemePreference> => ipcRenderer.invoke(IPC.getTheme),
  setTheme: (theme: ThemePreference): Promise<void> => ipcRenderer.invoke(IPC.setTheme, theme),

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
  // min/max/close sit top-RIGHT everywhere else.
  getWindowChrome: (): Promise<WindowChrome> => ipcRenderer.invoke(IPC.getWindowChrome),

  window: {
    toggleMaximize: (): Promise<void> => ipcRenderer.invoke(IPC.windowMaximizeToggle),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowIsMaximized),
  },

  /**
   * Mirrors renderer UI state into the native menu, so `View ▸ Toggle
   * Sidebar` shows a real checkmark and `Back` greys out when it would no-op.
   */
  setMenuState: (state: Partial<ShellState>): Promise<void> =>
    ipcRenderer.invoke(IPC.setMenuState, state),

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
  onThemeChanged: (cb: (resolved: 'light' | 'dark') => void): Unsubscribe => {
    const handler = (_e: unknown, resolved: 'light' | 'dark') => cb(resolved);
    ipcRenderer.on(IPC_EVENT.themeChanged, handler);
    return () => ipcRenderer.removeListener(IPC_EVENT.themeChanged, handler);
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
    pickElement: (tabId: string): Promise<unknown> =>
      ipcRenderer.invoke(BROWSER_IPC.pickElement, tabId),
    captureRegion: (tabId: string): Promise<string | null> =>
      ipcRenderer.invoke(BROWSER_IPC.captureRegion, tabId),
    annotateStart: (tabId: string, theme?: string): Promise<void> =>
      ipcRenderer.invoke(BROWSER_IPC.annotateStart, tabId, theme),
    annotateStop: (tabId: string): Promise<void> =>
      ipcRenderer.invoke(BROWSER_IPC.annotateStop, tabId),
    annotatePoll: (tabId: string): Promise<unknown> =>
      ipcRenderer.invoke(BROWSER_IPC.annotatePoll, tabId),
    annotateSend: (tabId: string, keys?: string[]): Promise<unknown> =>
      ipcRenderer.invoke(BROWSER_IPC.annotateSend, tabId, keys),
    annotateRegion: (tabId: string): Promise<void> =>
      ipcRenderer.invoke(BROWSER_IPC.annotateRegion, tabId),
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

// ── Native dialog shims ─────────────────────────────────────────────────────
// The web app already feature-detects `window.showDirectoryPicker`. We expose a
// shim that resolves to a minimal FileSystemDirectoryHandle-like object whose
// `name` carries the chosen absolute path — which is exactly what the web's
// `HttpPlatformClient.selectDirectory()` consumes. This means the existing web
// code uses the OS-native folder picker with no changes.
contextBridge.exposeInMainWorld('__generatoraiNativePickers', {
  showDirectoryPicker: async () => {
    const dir = await ipcRenderer.invoke(IPC.selectDirectory);
    if (!dir) {
      // Match the browser's behaviour: an AbortError when the user cancels.
      throw new DOMException('The user aborted a request.', 'AbortError');
    }
    return { name: dir, kind: 'directory' as const };
  },
});
