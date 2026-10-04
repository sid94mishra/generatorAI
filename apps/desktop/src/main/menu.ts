// ────────────────────────────────────────────────────────────────
// Native application menu.
//
// Structure follows the conventions every desktop user already knows:
//
//     File · Edit · View · Window · Help
//
// Two rules drive the layout:
//
//   1. Navigation lives under `View`, not a bespoke `Go` menu. That is where
//      Safari, Finder and VS Code put it, so it is where users look.
//   2. Every command item comes from the shared command registry
//      (`@generatorai/shared/ui-contract`, D-24; `commandItem`): its label
//      (title-cased), its accelerator for this platform (`Cmd+1..9` means
//      "switch tab" on macOS, so sections are `Cmd+Shift+<letter>` there;
//      Windows and Linux get `Ctrl+1..7` in sidebar order) and, for renderer
//      commands, `sendCommand(id)`. Sections come from NAV_DESTINATIONS and
//      File ▸ New from the registry's `create` commands. The same table drives
//      the web key handler and the shortcuts sheet, so the menu, the palette
//      hints and Help ▸ Keyboard Shortcuts cannot disagree.
//
// The menu is REBUILT whenever renderer state changes, so checkmarks, radio
// groups and enabled/disabled items reflect the app rather than decorating it.
// ────────────────────────────────────────────────────────────────

import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import * as path from 'node:path';
import { getWindowManager, navigateHistory } from './window-manager';
import { getServerManager } from './server-manager';
import { resolvePaths } from './paths';
import { loadSettings } from './config';
import {
  COMMAND_IDS,
  COMMANDS,
  NAV_DESTINATIONS,
  isRendererCommandId,
  toElectronAccelerator,
  type CommandId,
} from '@generatorai/shared/ui-contract';
import { menuLabel } from './menu-label';
import { isMac, mnemonic } from './platform';
import { log } from './logger';
import {
  connectionState,
  forgetRemoteConnection,
  promptForRemoteServer,
  switchToEmbedded,
  switchToRemote,
} from './backend-switcher';
import type { MenuState, DesktopThemePreference } from '../shared/ipc';

export interface MenuActions {
  showAbout: () => void;
  checkForUpdates: () => void;
  /** Installs the downloaded update (`update.install`; shown only while one is ready). */
  installUpdate: () => void;
}

/**
 * Last state pushed by the renderer.
 *
 * Seeded with sensible defaults so the menu is correct during the window's
 * first paint, before the renderer has had a chance to report anything.
 */
let menuState: MenuState = {
  sidebarOpen: true,
  rightPaneOpen: false,
  mode: 'dark',
  recent: [],
};

let cachedActions: MenuActions | null = null;

/**
 * Whether Back/Forward can move, asked of the thing that actually knows.
 *
 * The renderer used to report this: `canGoBack` guessed from
 * `window.history.length` and `canGoForward` hard-coded to `false`, which left
 * `View ▸ Forward` permanently greyed out even with somewhere to go. Chromium
 * tracks `pushState` entries, so its own history is the answer on every route
 * change, in both directions.
 */
function navHistory(): { back: boolean; forward: boolean } {
  const wc = getWindowManager().getMainWindow()?.webContents;
  if (!wc) return { back: false, forward: false };
  return { back: wc.navigationHistory.canGoBack(), forward: wc.navigationHistory.canGoForward() };
}

function nav(route: string): void {
  getWindowManager().navigateTo(route);
}

/** This platform's accelerator for a registry command (undefined = unbound here). */
export function accel(id: CommandId): string | undefined {
  const binding = COMMANDS[id][isMac ? 'desktopMac' : 'desktopWinLinux'];
  return binding === null ? undefined : toElectronAccelerator(binding);
}

/**
 * A menu item for a registry command: the registry label in title case (or a
 * platform-conventional `label`, e.g. "Settings…"), this platform's
 * accelerator, and — for renderer commands — `sendCommand(id)` on click. Main
 * commands pass their own `click`.
 */
export function commandItem(
  id: CommandId,
  overrides: Omit<MenuItemConstructorOptions, 'accelerator'> = {},
): MenuItemConstructorOptions {
  const accelerator = accel(id);
  return {
    label: menuLabel(COMMANDS[id].label),
    ...(accelerator ? { accelerator } : {}),
    ...(isRendererCommandId(id) ? { click: () => getWindowManager().sendCommand(id) } : {}),
    ...overrides,
  };
}

/** File ▸ New …: the registry's global `create` commands, in registry order. */
const CREATE_COMMANDS = COMMAND_IDS.filter((id) => COMMANDS[id].group === 'create' && COMMANDS[id].scope === 'global');

/**
 * The downloaded update's version while one is ready to install, else null.
 * Fed from the updater's state (`index.ts`); turns "Check for Updates…" into
 * "Restart to Update (v1.2.3)" (06 §8).
 */
let updateReadyVersion: string | null = null;

export function setMenuUpdateReady(version: string | null): void {
  if (version === updateReadyVersion) return;
  updateReadyVersion = version;
  if (cachedActions) buildMenu(cachedActions);
}

function updateItem(actions: MenuActions): MenuItemConstructorOptions {
  return updateReadyVersion
    ? commandItem('update.install', {
        label: `${menuLabel(COMMANDS['update.install'].label)} (v${updateReadyVersion})`,
        click: actions.installUpdate,
      })
    : commandItem('updates.check', { click: actions.checkForUpdates });
}

/**
 * Updates the menu to reflect renderer state.
 *
 * Electron's `Menu` cannot add or remove items after construction, so the
 * whole menu is rebuilt. That is cheap (a few dozen items) and keeps the
 * template declarative rather than imperatively patched.
 */
export function updateMenuState(patch: Partial<MenuState>): void {
  menuState = { ...menuState, ...patch };
  if (cachedActions) buildMenu(cachedActions);
}

/** What the last build showed, so a renderer push that changes nothing does not rebuild. */
let builtFrom = '';

function buildKey(): string {
  return JSON.stringify([menuState, navHistory()]);
}

/**
 * A renderer push (`setMenuState`): rebuilds only when it changes something
 * the menu shows, including Back/Forward. A rebuild can close a menu the user
 * has open (macOS), and the renderer re-sends every field whenever its
 * attention counts move (P1-review P2-R16).
 */
export function applyMenuPush(patch: Partial<MenuState>): void {
  menuState = { ...menuState, ...patch };
  if (cachedActions && buildKey() !== builtFrom) buildMenu(cachedActions);
}

export function buildMenu(actions: MenuActions): void {
  cachedActions = actions;
  builtFrom = buildKey();
  const wm = getWindowManager();
  const sm = getServerManager();
  const paths = resolvePaths();

  // ── App menu (macOS only) ────────────────────────────────────────
  const appMenu: MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: app.name,
          submenu: [
            { label: `About ${app.name}`, click: actions.showAbout },
            updateItem(actions),
            { type: 'separator' },
            commandItem('app.settings', { label: 'Settings…' }),
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
      ]
    : [];

  // ── File ─────────────────────────────────────────────────────────
  const recentSubmenu: MenuItemConstructorOptions[] =
    menuState.recent.length > 0
      ? menuState.recent.slice(0, 10).map((r) => ({
          label: r.label,
          click: () => nav(r.route),
        }))
      : [{ label: 'No Recent Items', enabled: false }];

  // ── Server ───────────────────────────────────────────────────────
  // Native chrome rather than in-app UI on purpose: the page belongs to one
  // backend, so a switcher rendered inside it dies with that backend — and if
  // the remote one is unreachable the page never renders to begin with.
  const servers = connectionState();
  const isRemote = servers.serverMode === 'remote';
  const serverMenu: MenuItemConstructorOptions = {
    label: mnemonic('Server', 'S'),
    submenu: [
      {
        label: 'This Computer',
        type: 'radio',
        checked: !isRemote,
        click: () => void switchToEmbedded(),
      },
      ...(servers.connections.length > 0
        ? ([{ type: 'separator' }] as MenuItemConstructorOptions[])
        : []),
      ...servers.connections.map<MenuItemConstructorOptions>((connection) => ({
        label: `${connection.label} — ${connection.url}`,
        type: 'radio',
        checked: isRemote && servers.activeConnectionId === connection.id,
        click: () => void switchToRemote(connection.id),
      })),
      { type: 'separator' },
      { label: 'Add Server…', click: () => void promptForRemoteServer() },
      ...(servers.connections.length > 0
        ? ([
            {
              label: 'Forget Server',
              submenu: servers.connections.map<MenuItemConstructorOptions>((connection) => ({
                label: connection.label,
                click: () => forgetRemoteConnection(connection.id),
              })),
            },
          ] as MenuItemConstructorOptions[])
        : []),
    ],
  };

  const fileMenu: MenuItemConstructorOptions = {
    label: mnemonic('File', 'F'),
    submenu: [
      // Routing for these lives in the renderer (useCommandHost), so
      // the menu only announces intent — one source of truth for where
      // "new X" actually goes.
      ...CREATE_COMMANDS.map((id) => commandItem(id)),
      { type: 'separator' },
      { label: 'Open Recent', submenu: recentSubmenu },
      { type: 'separator' },
      // Refreshes the scripts list wherever it is shown; no navigation.
      commandItem('scripts.reload'),
      // macOS puts Settings in the app menu; everywhere else it belongs here.
      ...(!isMac
        ? ([
            { type: 'separator' },
            commandItem('app.settings', { label: 'Settings' }),
          ] as MenuItemConstructorOptions[])
        : []),
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  };

  // ── Edit ─────────────────────────────────────────────────────────
  const editMenu: MenuItemConstructorOptions = {
    label: mnemonic('Edit', 'E'),
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      ...(isMac
        ? ([{ role: 'pasteAndMatchStyle' }, { role: 'delete' }] as MenuItemConstructorOptions[])
        : ([{ role: 'delete' }] as MenuItemConstructorOptions[])),
      { role: 'selectAll' },
      { type: 'separator' },
      // Find means find IN THIS PAGE, as it does in every other desktop app.
      // It used to open the command palette — which already has its own
      // shortcut — and `Find Next` dispatched an event nothing listened to.
      commandItem('find.open'),
      commandItem('find.next'),
      commandItem('find.previous'),
      // Speech is a macOS system service, not something we provide.
      ...(isMac
        ? ([
            { type: 'separator' },
            { label: 'Speech', submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] },
          ] as MenuItemConstructorOptions[])
        : []),
    ],
  };

  // ── View (absorbs navigation + appearance) ───────────────────────
  const viewMenu: MenuItemConstructorOptions = {
    label: mnemonic('View', 'V'),
    submenu: [
      // "Command Palette…" is what desktop menus call it (the registry's
      // "Search or jump to" is the palette's own wording).
      commandItem('palette.toggle', { label: 'Command Palette…' }),
      { type: 'separator' },
      // Sections in sidebar order (D-22). `navigateTo` (not the nav command)
      // because it also surfaces a window that was hidden to the tray.
      ...NAV_DESTINATIONS.map((d) => commandItem(d.command, { label: d.label, click: () => nav(d.path) })),
      { type: 'separator' },
      // D-93: on Windows/Linux Alt+←/→ are shown but not registered — the renderer handles them,
      // so a surface that owns its keys (the terminal's word-back) keeps them. ⌘[ / ⌘] stay accelerators.
      commandItem('nav.back', {
        enabled: navHistory().back,
        ...(isMac ? {} : { registerAccelerator: false }),
        click: () => {
          const win = wm.getMainWindow();
          if (win) navigateHistory(win, 'back');
        },
      }),
      commandItem('nav.forward', {
        enabled: navHistory().forward,
        ...(isMac ? {} : { registerAccelerator: false }),
        click: () => {
          const win = wm.getMainWindow();
          if (win) navigateHistory(win, 'forward');
        },
      }),
      { type: 'separator' },
      commandItem('sidebar.toggle', { type: 'checkbox', checked: menuState.sidebarOpen }),
      commandItem('activity.toggle'),
      commandItem('dock.toggle', { type: 'checkbox', checked: menuState.rightPaneOpen }),
      { type: 'separator' },
      {
        label: 'Appearance',
        submenu: (['light', 'dark', 'system'] as DesktopThemePreference[]).map((t) => ({
          label: t === 'system' ? 'Follow System' : t === 'dark' ? 'Dark' : 'Light',
          type: 'radio' as const,
          checked: menuState.mode === t,
          click: () => requestAppearance(t),
        })),
      },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { type: 'separator' },
      commandItem('window.reload', { click: () => wm.reload() }),
      { role: 'forceReload' },
      commandItem('devtools.toggle', { click: () => wm.toggleDevtools() }),
    ],
  };

  // ── Window ───────────────────────────────────────────────────────
  const windowMenu: MenuItemConstructorOptions = {
    label: mnemonic('Window', 'W'),
    submenu: isMac
      ? [
          { role: 'minimize', accelerator: 'Cmd+M' },
          { role: 'zoom' },
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' },
        ]
      : [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'close' }],
  };

  // ── Help (absorbs the old developer-facing "Server" menu) ────────
  const helpMenu: MenuItemConstructorOptions = {
    label: mnemonic('Help', 'H'),
    role: 'help',
    submenu: [
      { label: 'Documentation', click: () => wm.openExternalSafely('https://github.com/') },
      commandItem('shortcuts.show'),
      { type: 'separator' },
      {
        // Server plumbing is troubleshooting, not a first-class user task,
        // so it is nested rather than occupying a top-level menu.
        label: 'Troubleshooting',
        submenu: [
          commandItem('server.restart', {
            click: () => void sm.restart().catch((e) => log.error('Manual server restart failed', e)),
          }),
          {
            label: 'Server Health',
            click: () => { const u = sm.url; if (u) wm.openExternalSafely(`${u}/api/health`); },
          },
          { type: 'separator' },
          { label: 'Open Data Folder', click: () => void shell.openPath(paths.dataDir) },
          {
            label: 'View Logs',
            click: () => void shell.openPath(path.join(app.getPath('userData'), 'logs')),
          },
        ],
      },
      { type: 'separator' },
      updateItem(actions),
      // macOS already has About in the app menu; duplicating it is wrong there.
      ...(!isMac
        ? ([{ label: `About ${app.name}`, click: actions.showAbout }] as MenuItemConstructorOptions[])
        : []),
    ],
  };

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([...appMenu, fileMenu, editMenu, viewMenu, serverMenu, windowMenu, helpMenu]),
  );
}

/**
 * View ▸ Appearance asks the renderer; it does not apply anything itself.
 * ThemeProvider is the only appearance writer (D-25): it applies the mode and
 * pushes it back (IPC.setAppearance), which persists it, sets themeSource and
 * moves this radio. Writing themeSource here made "System" lie whenever the
 * renderer disagreed.
 */
function requestAppearance(mode: DesktopThemePreference): void {
  // Electron has already moved the radio. With no window to apply the mode,
  // nothing will push it back, so rebuild to put the radio back on the mode
  // that is actually in effect (P1-review P2-R23).
  if (!getWindowManager().sendAppearanceRequest(mode)) updateMenuState({});
}

/** Re-reads the persisted appearance mode into the menu. Called once at startup. */
export function syncMenuThemeFromSettings(): void {
  updateMenuState({ mode: loadSettings().appearance.mode });
}
