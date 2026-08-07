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
//   2. Accelerators are chosen PER PLATFORM. `Cmd+1..9` means "switch tab"
//      on macOS, so binding navigation there fights muscle memory; Windows
//      and Linux have no such convention and get `Ctrl+1..8`.
//
// The menu is REBUILT whenever renderer state changes, so checkmarks, radio
// groups and enabled/disabled items reflect the app rather than decorating it.
// ────────────────────────────────────────────────────────────────

import { app, Menu, shell, nativeTheme, type MenuItemConstructorOptions } from 'electron';
import * as path from 'node:path';
import { getWindowManager } from './window-manager';
import { getServerManager } from './server-manager';
import { resolvePaths } from './paths';
import { loadSettings, saveSettings } from './config';
import { isMac, mnemonic, sectionAccelerator } from './platform';
import { log } from './logger';
import {
  connectionState,
  forgetRemoteConnection,
  promptForRemoteServer,
  switchToEmbedded,
  switchToRemote,
} from './backend-switcher';
import type { MenuState, ThemePreference } from '../shared/ipc';

export interface MenuActions {
  showAbout: () => void;
  checkForUpdates: () => void;
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
  canGoBack: false,
  canGoForward: false,
  theme: 'system',
  recent: [],
};

let cachedActions: MenuActions | null = null;

function nav(route: string): void {
  getWindowManager().navigateTo(route);
}

/** The main sections, in sidebar order. */
const SECTIONS: { label: string; route: string; index: number; macKey: string }[] = [
  { label: 'Dashboard', route: '/', index: 1, macKey: 'D' },
  { label: 'Projects', route: '/projects', index: 2, macKey: 'P' },
  { label: 'Chats', route: '/chats', index: 3, macKey: 'C' },
  { label: 'Workflows', route: '/workflows', index: 4, macKey: 'W' },
  { label: 'Scripts', route: '/scripts', index: 5, macKey: 'S' },
  { label: 'Automations', route: '/automations', index: 6, macKey: 'A' },
];

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

export function buildMenu(actions: MenuActions): void {
  cachedActions = actions;
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
            { label: 'Check for Updates…', click: actions.checkForUpdates },
            { type: 'separator' },
            { label: 'Settings…', accelerator: 'Cmd+,', click: () => nav('/settings') },
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
      // Routing for these lives in the renderer (useDesktopIntegration), so
      // the menu only announces intent — one source of truth for where
      // "new X" actually goes.
      {
        label: 'New Chat',
        accelerator: 'CmdOrCtrl+N',
        click: () => wm.sendCommand('new-chat'),
      },
      { label: 'New Workflow', accelerator: 'CmdOrCtrl+Shift+N', click: () => wm.sendCommand('new-workflow') },
      { label: 'New Project', click: () => wm.sendCommand('new-project') },
      { label: 'New Automation', click: () => wm.sendCommand('new-automation') },
      { type: 'separator' },
      { label: 'Open Recent', submenu: recentSubmenu },
      { type: 'separator' },
      { label: 'Reload Scripts', click: () => { nav('/scripts'); wm.sendCommand('reload-scripts'); } },
      // macOS puts Settings in the app menu; everywhere else it belongs here.
      ...(!isMac
        ? ([
            { type: 'separator' },
            { label: 'Settings', accelerator: 'Ctrl+,', click: () => nav('/settings') },
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
      { label: 'Find', accelerator: 'CmdOrCtrl+F', click: () => wm.sendCommand('focus-search') },
      { label: 'Find Next', accelerator: 'CmdOrCtrl+G', click: () => wm.sendCommand('find-next') },
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
      {
        label: 'Command Palette…',
        accelerator: 'CmdOrCtrl+K',
        click: () => wm.sendCommand('command-palette'),
      },
      { type: 'separator' },
      ...SECTIONS.map<MenuItemConstructorOptions>((s) => ({
        label: s.label,
        accelerator: sectionAccelerator(s.index, s.macKey),
        click: () => nav(s.route),
      })),
      { type: 'separator' },
      {
        label: 'Back',
        accelerator: isMac ? 'Cmd+[' : 'Alt+Left',
        enabled: menuState.canGoBack,
        click: () => {
          const wc = wm.getMainWindow()?.webContents;
          if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
        },
      },
      {
        label: 'Forward',
        accelerator: isMac ? 'Cmd+]' : 'Alt+Right',
        enabled: menuState.canGoForward,
        click: () => {
          const wc = wm.getMainWindow()?.webContents;
          if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
        },
      },
      { type: 'separator' },
      {
        label: 'Toggle Sidebar',
        accelerator: 'CmdOrCtrl+B',
        type: 'checkbox',
        checked: menuState.sidebarOpen,
        click: () => wm.sendCommand('toggle-sidebar'),
      },
      {
        label: 'Toggle Right Panel',
        accelerator: 'CmdOrCtrl+Alt+B',
        type: 'checkbox',
        checked: menuState.rightPaneOpen,
        click: () => wm.sendCommand('toggle-right-pane'),
      },
      { type: 'separator' },
      {
        label: 'Appearance',
        submenu: (['light', 'dark', 'system'] as ThemePreference[]).map((t) => ({
          label: t === 'system' ? 'Follow System' : t === 'dark' ? 'Dark' : 'Light',
          type: 'radio' as const,
          checked: menuState.theme === t,
          click: () => setTheme(t),
        })),
      },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { type: 'separator' },
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => wm.reload() },
      { role: 'forceReload' },
      {
        label: 'Toggle Developer Tools',
        accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
        click: () => wm.toggleDevtools(),
      },
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
      {
        label: 'Keyboard Shortcuts',
        accelerator: 'CmdOrCtrl+/',
        click: () => wm.sendCommand('show-shortcuts'),
      },
      { type: 'separator' },
      {
        // Server plumbing is troubleshooting, not a first-class user task,
        // so it is nested rather than occupying a top-level menu.
        label: 'Troubleshooting',
        submenu: [
          {
            label: 'Restart Server',
            click: () => void sm.restart().catch((e) => log.error('Manual server restart failed', e)),
          },
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
      { label: 'Check for Updates…', click: actions.checkForUpdates },
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

/** Applies a theme everywhere: OS, persisted settings, renderer and menu. */
function setTheme(theme: ThemePreference): void {
  nativeTheme.themeSource = theme;
  saveSettings({ theme });
  updateMenuState({ theme });
}

/** Re-reads persisted theme into the menu. Called once at startup. */
export function syncMenuThemeFromSettings(): void {
  updateMenuState({ theme: loadSettings().theme });
}
