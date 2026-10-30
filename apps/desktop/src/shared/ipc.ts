// ────────────────────────────────────────────────────────────────
// Shared IPC contract between the Electron main process and the preload
// bridge. Keeping channel names + payload types in one place prevents
// drift between the two sides.
// ────────────────────────────────────────────────────────────────

// The payloads that cross the bridge live in `@generatorai/shared`
// (`types/DesktopShell.ts`), so the renderer's `desktop-bridge.d.ts` uses the
// same declarations (P1-review P2-R24, P2-R41). Type-only: erased from both bundles.
export type {
  DesktopAppearancePush,
  DesktopAppearanceRequest,
  DesktopServerEntry,
  DesktopShellStatePush,
  DesktopThemePreference,
  DesktopUpdateState,
  NavHistoryState,
  WindowChrome,
  WindowStateChange,
  FindInPageResult,
} from '@generatorai/shared';
import type { DesktopShellStatePush, DesktopThemePreference } from '@generatorai/shared';

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
  /**
   * True when the asking page is this computer's own server (embedded, or the
   * dev server the shell was started against) — the case where a path picked
   * in a native dialog means something to the server. False for a remote
   * server's page (D-126/D-130), which also cannot call the local-only dialogs.
   */
  localServer: boolean;
}

export interface SaveFileOptions {
  defaultPath?: string;
  /** Raw text/base64 content to write. If omitted, only the path is returned. */
  content?: string;
  encoding?: 'utf8' | 'base64';
  filters?: { name: string; extensions: string[] }[];
}

/**
 * Renderer-owned UI state mirrored into the native menu.
 *
 * A native menu that never reflects the app is decoration; this is what makes
 * `View ▸ Toggle Sidebar` show a real checkmark and `Back` grey out. Back and
 * Forward are deliberately absent: Chromium's own navigation history is the
 * authority for those (see `menu.ts`). The attention counts are not menu
 * state either: they feed the tray and the badge (`attention-state.ts`), and
 * the menu does not show them.
 */
export interface MenuState extends Pick<DesktopShellStatePush, 'sidebarOpen' | 'rightPaneOpen' | 'recent'> {
  /** Radio state of View ▸ Appearance; set from the renderer's appearance push only. */
  mode: DesktopThemePreference;
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
   * macOS Accessibility + Screen Recording for computer use (U-67): `status` reads them, `request` asks macOS
   * (listing GeneratorAI under both Privacy panes), `openSettings` opens Screen Recording settings. Null off macOS.
   * Local-only: a remote server's page must not prompt for this computer's grants.
   */
  computerPermissions: 'desktop:computerPermissions',
  /**
   * The renderer's appearance ({@link DesktopAppearancePush}). Main persists it,
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
  /**
   * Renderer pushes UI state up so the native menu can mirror it. The first
   * push from a document also tells main that document's bridge listeners are
   * up, so routes can go over {@link IPC_EVENT.navigate} (06 §3.4).
   */
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
  /**
   * The preload's `updates.onChange` reports each subscribe (`true`) and
   * unsubscribe (`false`). Main suppresses the native "update ready" dialog
   * only while a renderer is actually listening and the window is visible
   * (P1-review P2-R3).
   */
  watchUpdates: 'desktop:watchUpdates',
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
   * ({@link DesktopAppearanceRequest}). Main does not apply it: the renderer's
   * ThemeProvider is the only appearance writer (D-25), applies the mode and
   * pushes the result back through {@link IPC.setAppearance}.
   */
  appearanceRequest: 'desktop:appearance-request',
  /** The known-servers list changed (switched, added, forgotten) — G-03. */
  serversChanged: 'desktop:servers-changed',
  /** Updater state changed (checking/downloading/ready/installing) — G-04. */
  updateStateChanged: 'desktop:update-state-changed',
  /**
   * Whether the window's session history can go back / forward
   * ({@link NavHistoryState}), from Chromium's own history. Sent on every
   * navigation and when a document finishes loading (06 §3.4); drives the
   * title strip's and the native-frame sidebar row's Back / Forward buttons.
   */
  navHistoryChanged: 'desktop:nav-history-changed',
} as const;

/**
 * Commands main sends to the renderer (menu items, accelerators, tray): the
 * registry's global renderer commands (`@generatorai/shared/ui-contract`, D-24).
 * The renderer handles every one of them exhaustively (useCommandHost).
 */
export type { RendererCommandId as DesktopCommand } from '@generatorai/shared/ui-contract';
