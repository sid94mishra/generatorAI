// ────────────────────────────────────────────────────────────────
// Shared IPC contract between the Electron main process and the preload
// bridge. Keeping channel names + payload types in one place prevents
// drift between the two sides.
// ────────────────────────────────────────────────────────────────

import type { AttentionCounts } from '@generatorai/shared';

export type ThemePreference = 'light' | 'dark' | 'system';

/**
 * What the renderer pushes on every appearance change (D-25; 06 §6.1–§6.4).
 * The renderer owns appearance; main only mirrors it: the chrome colours are
 * `#rrggbb` literals from the token package for BOTH appearances, so the next
 * launch paints the right window background even if the OS flipped between
 * light and dark while the app was closed.
 */
export interface AppearancePush {
  mode: ThemePreference;
  themeId: string;
  groundLight: string;
  groundDark: string;
  fgLight: string;
  fgDark: string;
}

/** Payload of {@link IPC_EVENT.appearanceRequest}. */
export interface AppearanceRequest {
  mode: ThemePreference;
}

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
  /** Radio state of View ▸ Appearance; set from the renderer's appearance push only. */
  mode: ThemePreference;
  /** Most recently visited routes, newest first. */
  recent: { label: string; route: string }[];
  /**
   * Needs-you / running totals from the D-36 attention feed (G-01), pushed by
   * the renderer's own live subscription (`useAttentionCounts`) — main holds
   * no server connection of its own, so it never fetches these directly (05
   * §G-05). `null` until the renderer has a first snapshot; the tray and menu
   * degrade to today's server-only text while it is null, and also once the
   * main window is destroyed (a dead renderer cannot refresh a stale count).
   *
   * `byEntity.chat.running` is what the tray calls "agents" (DesktopMac
   * board: "Server running · 3 agents").
   */
  attention: AttentionCounts | null;
}

/** One entry in the desktop server switcher (G-03). */
export interface DesktopServerEntry {
  /** `'embedded'` for this machine's own server; a connection id otherwise. */
  id: string;
  label: string;
  url: string;
  kind: 'embedded' | 'remote';
  active: boolean;
}

/**
 * Everything the renderer mirrors into the native shell.
 *
 * Back/Forward are deliberately absent: Chromium's own navigation history is
 * the authority for those (see `menu.ts`), and the renderer's guess left
 * `View ▸ Forward` permanently disabled.
 */
export interface ShellState extends MenuState {
  /** True while the renderer holds edits that closing would discard. */
  hasUnsavedWork: boolean;
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
  /**
   * The renderer's appearance ({@link AppearancePush}). Main persists it,
   * mirrors `nativeTheme.themeSource`, repaints the window background and the
   * caption glyphs, and updates the View ▸ Appearance radio.
   */
  setAppearance: 'desktop:setAppearance',
  getSetting: 'desktop:getSetting',
  setSetting: 'desktop:setSetting',
  reload: 'desktop:reload',
  toggleDevtools: 'desktop:toggleDevtools',
  showItemInFolder: 'desktop:showItemInFolder',
  /**
   * Find-in-page. Chromium owns the search — it is the only thing that can see
   * text inside canvas-rendered panes, virtualised lists and cross-origin
   * frames — so the renderer draws the bar and delegates the searching.
   */
  findInPage: 'desktop:findInPage',
  stopFindInPage: 'desktop:stopFindInPage',
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
  /** Known servers (this machine + paired remotes), for the switcher (G-03). */
  getServers: 'desktop:getServers',
  switchServer: 'desktop:switchServer',
  addServer: 'desktop:addServer',
  /** Updater state, for the renderer's "Restart to update" pill (G-04). */
  getUpdateState: 'desktop:getUpdateState',
  installUpdate: 'desktop:installUpdate',
} as const;

/** Result of {@link IPC.requestPairingCode}. */
export interface DesktopPairingCode {
  pairingCode: string;
  pairingUrl: string;
  expiresAt: number;
}

// Main → renderer (send/on)
/**
 * The text-prompt window's only channel. Electron does not implement
 * `window.prompt`, so asking the user for one line — a server address, say —
 * needs a real window of our own.
 */
export const PROMPT_IPC = {
  result: 'desktop-prompt:result',
} as const;

export const IPC_EVENT = {
  navigate: 'desktop:navigate',
  serverStatus: 'desktop:server-status',
  command: 'desktop:command',
  /** Window maximize/unmaximize/fullscreen, so a custom bar can restyle. */
  windowStateChanged: 'desktop:window-state-changed',
  /** Match count for the current find-in-page query. */
  foundInPage: 'desktop:found-in-page',
  /**
   * The user picked a mode in the native View ▸ Appearance menu
   * ({@link AppearanceRequest}). Main does not apply it: the renderer's
   * ThemeProvider is the only appearance writer (D-25), applies the mode and
   * pushes the result back through {@link IPC.setAppearance}.
   */
  appearanceRequest: 'desktop:appearance-request',
  /** The known-servers list changed (switched, added, forgotten) — G-03. */
  serversChanged: 'desktop:servers-changed',
  /** Updater state changed (checking/downloading/ready/error) — G-04. */
  updateStateChanged: 'desktop:update-state-changed',
} as const;

/** Payload of {@link IPC_EVENT.windowStateChanged}. */
export interface WindowStateChange {
  maximized: boolean;
  fullScreen: boolean;
  focused: boolean;
}

/**
 * Auto-updater state, mirrored to the renderer for the "Restart to update"
 * pill (G-04, 06-desktop-and-shell.md §8). `currentVersion` is always the
 * running build's version, even while `status` is `'idle'`; `nextVersion`
 * and `percent` are only meaningful once a check has found something.
 */
export interface UpdateState {
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'error';
  currentVersion: string;
  nextVersion?: string;
  /** 0–100, while `status === 'downloading'`. */
  percent?: number;
  error?: string;
}

/** Result of one find-in-page pass, as Chromium reports it. */
export interface FindInPageResult {
  activeMatchOrdinal: number;
  matches: number;
}

/**
 * Commands main sends to the renderer (menu items, accelerators, tray): the
 * registry's global renderer commands (`@generatorai/shared/ui-contract`, D-24).
 * The renderer handles every one of them exhaustively (useCommandHost).
 */
export type { RendererCommandId as DesktopCommand } from '@generatorai/shared/ui-contract';
