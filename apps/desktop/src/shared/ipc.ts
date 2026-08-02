// ────────────────────────────────────────────────────────────────
// Shared IPC contract between the Electron main process and the preload
// bridge. Keeping channel names + payload types in one place prevents
// drift between the two sides.
// ────────────────────────────────────────────────────────────────

export type ThemePreference = 'light' | 'dark' | 'system';

export type ServerState =
  | 'idle'
  | 'starting'
  | 'ready'
  | 'restarting'
  | 'crashed'
  | 'stopped';

export interface ServerStatus {
  state: ServerState;
  url: string | null;
  port: number | null;
  pid: number | null;
  healthy: boolean;
  /** Populated from GET /api/health when available. */
  harness?: { type: string; healthy: boolean } | null;
  lastError?: string | null;
  /** Number of times the server process has been (re)started this session. */
  restarts: number;
}

export interface AppInfo {
  name: string;
  version: string;
  versions: { electron: string; node: string; chrome: string; v8: string };
  platform: NodeJS.Platform;
  arch: string;
  isPackaged: boolean;
  mode: 'dev' | 'standalone';
  dataDir: string;
  logFile: string;
  serverUrl: string | null;
}

export interface SaveFileOptions {
  defaultPath?: string;
  /** Raw text/base64 content to write. If omitted, only the path is returned. */
  content?: string;
  encoding?: 'utf8' | 'base64';
  filters?: { name: string; extensions: string[] }[];
}

/**
 * How the window frame is drawn, so the renderer can lay out its header to
 * match. The web app is served in a browser too, where this is simply absent.
 */
export interface WindowChrome {
  platform: NodeJS.Platform;
  /**
   * `native` — the OS draws a full title bar above our content (fallback).
   * `hidden-inset` — macOS: traffic lights float over our header.
   * `overlay` — Windows/Linux: the OS paints min/max/close INTO our header.
   */
  titleBarStyle: 'native' | 'hidden-inset' | 'overlay';
  /** Height in px the app must reserve for the draggable strip. */
  titleBarHeight: number;
  /** Space to keep clear on the LEFT (macOS traffic lights). */
  insetLeft: number;
  /** Space to keep clear on the RIGHT (Windows/Linux window controls). */
  insetRight: number;
  /** Wayland forbids programmatic move/resize — the UI should not offer it. */
  isWayland: boolean;
}

/**
 * Renderer-owned UI state mirrored into the native menu.
 *
 * A native menu that never reflects the app is decoration; this is what makes
 * `View ▸ Toggle Sidebar` show a real checkmark and `Back` grey out.
 */
export interface MenuState {
  sidebarOpen: boolean;
  rightPaneOpen: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  theme: ThemePreference;
  /** Most recently visited routes, newest first. */
  recent: { label: string; route: string }[];
}

// Renderer → main (invoke/handle)
export const IPC = {
  getAppInfo: 'desktop:getAppInfo',
  getServerStatus: 'desktop:getServerStatus',
  restartServer: 'desktop:restartServer',
  selectDirectory: 'desktop:selectDirectory',
  selectFile: 'desktop:selectFile',
  saveFile: 'desktop:saveFile',
  openExternal: 'desktop:openExternal',
  getTheme: 'desktop:getTheme',
  setTheme: 'desktop:setTheme',
  getSetting: 'desktop:getSetting',
  setSetting: 'desktop:setSetting',
  reload: 'desktop:reload',
  toggleDevtools: 'desktop:toggleDevtools',
  showItemInFolder: 'desktop:showItemInFolder',
  /**
   * Asks the shell for a single-use pairing code so the renderer can enrol
   * itself as a device. Returns null when the server is not running.
   */
  requestPairingCode: 'desktop:requestPairingCode',
  /** Window chrome geometry so the renderer can lay out its header. */
  getWindowChrome: 'desktop:getWindowChrome',
  /** Renderer pushes UI state up so the native menu can mirror it. */
  setMenuState: 'desktop:setMenuState',
  /** Native window controls, used only when we draw our own title bar. */
  windowMaximizeToggle: 'desktop:windowMaximizeToggle',
  windowIsMaximized: 'desktop:windowIsMaximized',
} as const;

/** Result of {@link IPC.requestPairingCode}. */
export interface DesktopPairingCode {
  pairingCode: string;
  pairingUrl: string;
  expiresAt: number;
}

// Main → renderer (send/on)
export const IPC_EVENT = {
  navigate: 'desktop:navigate',
  serverStatus: 'desktop:server-status',
  command: 'desktop:command',
  themeChanged: 'desktop:theme-changed',
  /** Window maximize/unmaximize/fullscreen, so a custom bar can restyle. */
  windowStateChanged: 'desktop:window-state-changed',
} as const;

/** Payload of {@link IPC_EVENT.windowStateChanged}. */
export interface WindowStateChange {
  maximized: boolean;
  fullScreen: boolean;
  focused: boolean;
}

/** High-level commands dispatched from native menus / shortcuts to the renderer. */
export type DesktopCommand =
  | 'new-chat'
  | 'new-workflow'
  | 'new-project'
  | 'new-automation'
  | 'command-palette'
  | 'focus-search'
  | 'find-next'
  | 'toggle-sidebar'
  | 'toggle-right-pane'
  | 'show-shortcuts'
  | 'reload-scripts';
