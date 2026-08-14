// ────────────────────────────────────────────────────────────────
// GeneratorAI Desktop — Electron main process entry.
//
// Boots the embedded GeneratorAI server (production mode: serves the built web
// SPA same-origin + the /api surface), then opens a window onto that single
// loopback URL. The web UI runs unmodified → full feature + look-and-feel
// parity with the web app, and full CLI parity at the API layer.
// ────────────────────────────────────────────────────────────────

import { app, dialog, nativeTheme, BrowserWindow, Menu, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { log } from './logger';
import { loadSettings } from './config';
import { getServerManager } from './server-manager';
import { resolveTarget } from './serverConnections';
import { getWindowManager } from './window-manager';
import { getNativeBrowserHost, nativeBrowserEnabled } from './browser-host';
import { disposeComputerHost, initComputerHost } from './computer-host-registry';
import { setIpcToken } from './cdp/ipc-token';
import { registerIpc } from './ipc';
import { buildMenu, syncMenuThemeFromSettings } from './menu';
import { createTray, destroyTray, refreshTrayMenu } from './tray';
import { registerDownloadHandler } from './downloads';
import {
  registerDeepLinks,
  registerProtocolClient,
  handleDeepLink,
  findDeepLinkInArgv,
} from './deep-link';
import { initAutoUpdates, checkForUpdatesInteractive } from './updater';

const DEV_SERVER_URL = process.env['DESKTOP_DEV_SERVER_URL'] || null;
const mode: 'dev' | 'standalone' = DEV_SERVER_URL ? 'dev' : 'standalone';

let appUrl: string | null = null;
let isQuitting = false;
let quitHandled = false;
/**
 * One process-lifetime secret used to authenticate the desktop→server
 * handshake route that pushes each workspace's scoped CDP endpoint (see
 * browser-host.ts's `NativeBrowserHost`, which opens a `ScopedCdpProxy` per
 * active tab — never an app-wide CDP port). Null when the native-browser
 * feature flag is off. This is NOT a CDP credential; each ScopedCdpProxy has
 * its own random per-instance token for that.
 */
let ipcToken: string | null = null;

// Single-instance lock — focus the existing window instead of opening a 2nd.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (nativeBrowserEnabled()) {
    ipcToken = randomUUID();
    setIpcToken(ipcToken);
  }
  main();
}

function main(): void {
  registerProtocolClient();

  app.on('second-instance', (_event, argv) => {
    const win = getWindowManager().getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    const link = findDeepLinkInArgv(argv);
    if (link) handleDeepLink(link);
  });

  process.on('uncaughtException', (err) => log.error('uncaughtException', err));
  process.on('unhandledRejection', (reason) => log.error('unhandledRejection', reason));

  app.whenReady().then(onReady).catch((err) => {
    log.error('Fatal during startup', err);
    getWindowManager().showError(String(err instanceof Error ? err.message : err));
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && appUrl) {
      getWindowManager().createMainWindow(appUrl);
    }
  });

  app.on('window-all-closed', () => {
    const settings = loadSettings();
    if (process.platform !== 'darwin' && !settings.minimizeToTray) {
      app.quit();
    }
  });

  app.on('before-quit', async (event) => {
    if (quitHandled) return;
    event.preventDefault();
    quitHandled = true;
    isQuitting = true;
    log.info('Quitting — shutting down embedded server');
    try {
      // Before the server: the driver holds OS-level input grants, and
      // leaving it running past the app that is responsible for it is exactly
      // the orphaned-automation case the TCC model is meant to prevent.
      await disposeComputerHost();
      if (mode === 'standalone') await getServerManager().stop();
    } catch (e) {
      log.warn('Error stopping server during quit', e);
    } finally {
      destroyTray();
      app.exit(0);
    }
  });
}

async function onReady(): Promise<void> {
  const settings = loadSettings();
  nativeTheme.themeSource = settings.theme;

  const wm = getWindowManager();
  const sm = getServerManager();

  // Plumb the handshake token (if any) into the server manager so the
  // spawned server sees it as env and can authenticate the per-workspace
  // CDP-endpoint pushes NativeBrowserHost sends as tabs become active.
  sm.setElectronIpcToken(ipcToken);

  registerIpc(mode);
  registerDeepLinks();
  registerDownloadHandler(session.defaultSession);

  // Trust self-signed/invalid certs on loopback only — for a browser tab
  // hitting the user's own `https://localhost:PORT` dev server. Checks the
  // actual hostname Electron is validating, never a blanket accept; every
  // other host still fails normally.
  app.on('certificate-error', (event, _webContents, url, _error, _certificate, callback) => {
    let hostname = '';
    try { hostname = new URL(url).hostname; } catch { /* malformed URL — fall through to reject */ }
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      event.preventDefault();
      callback(true);
      return;
    }
    callback(false);
  });
  buildMenu({ showAbout, checkForUpdates: () => void checkForUpdatesInteractive() });
  syncMenuThemeFromSettings();
  registerNativeShortcuts();
  createTray();

  wm.showSplash();

  // Three ways to decide what the window loads:
  //   dev       — an external Vite server, chosen by env
  //   remote    — a server on another machine; nothing is spawned here
  //   embedded  — this shell's own child server (the default)
  const target = resolveTarget(settings.servers, null);

  if (mode === 'dev') {
    appUrl = DEV_SERVER_URL;
    log.info('Dev mode — attaching to external dev server', { appUrl });
  } else if (target?.mode === 'remote') {
    appUrl = target.url;
    log.info('Remote mode — attaching to a server on another machine', { appUrl });
    // The embedded server still starts, so switching back is instant and any
    // work already running locally keeps going. A failure here is not fatal:
    // the window is pointed somewhere else entirely.
    sm.on('status', () => refreshTrayMenu());
    void sm.start().catch((err: unknown) => {
      log.warn('Embedded server did not start while in remote mode', err);
    });
  } else {
    sm.on('status', () => refreshTrayMenu());
    try {
      await sm.start();
      appUrl = sm.url;
    } catch (err) {
      log.error('Embedded server failed to start', err);
      wm.showError(
        `The GeneratorAI server failed to start.\n\n${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
  }

  if (!appUrl) {
    wm.showError('No application URL could be resolved.');
    return;
  }

  // Constructed, not started: the driver spawns on the first workspace that
  // asks for it, so users who never enable computer use never see the macOS
  // Accessibility prompt.
  const serverBaseUrl = sm.url;
  const computerIpcToken = sm.ipcToken;
  if (serverBaseUrl && computerIpcToken) {
    initComputerHost({
      serverBaseUrl,
      ipcToken: computerIpcToken,
      log: (message) => log.info(message),
    });
  }

  wm.createMainWindow(appUrl);

  // Handle a deep link passed on first launch (Windows/Linux).
  const initialLink = findDeepLinkInArgv(process.argv);
  if (initialLink) handleDeepLink(initialLink);

  void initAutoUpdates();
}

/**
 * Native OS integrations that are not menus: the macOS About panel (so
 * `⌘ + About GeneratorAI` shows the standard sheet rather than a generic
 * dialog), the Dock menu, and the Windows JumpList. Each is a no-op on the
 * platforms that do not have that affordance.
 */
function registerNativeShortcuts(): void {
  app.setAboutPanelOptions({
    applicationName: 'GeneratorAI',
    applicationVersion: app.getVersion(),
    version: `Electron ${process.versions.electron}`,
    copyright: `© ${new Date().getFullYear()} GeneratorAI`,
  });

  const go = (route: string) => {
    const wm = getWindowManager();
    const win = wm.getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    wm.navigateTo(route);
  };

  if (process.platform === 'darwin') {
    app.dock?.setMenu(
      Menu.buildFromTemplate([
        { label: 'New Chat', click: () => go('/chats') },
        { label: 'New Workflow', click: () => go('/workflows/new') },
        { type: 'separator' },
        { label: 'Dashboard', click: () => go('/') },
      ]),
    );
  }

  if (process.platform === 'win32') {
    // JumpList tasks re-launch the exe with a `generatorai://` argument;
    // `second-instance` picks it out of argv via findDeepLinkInArgv and
    // routes the already-running window instead of starting a second copy.
    app.setUserTasks([
      {
        program: process.execPath,
        arguments: 'generatorai://chats',
        iconPath: process.execPath,
        iconIndex: 0,
        title: 'Chats',
        description: 'Open GeneratorAI chats',
      },
      {
        program: process.execPath,
        arguments: 'generatorai://workflows/new',
        iconPath: process.execPath,
        iconIndex: 0,
        title: 'New Workflow',
        description: 'Create a new GeneratorAI workflow',
      },
    ]);
  }
}

function showAbout(): void {
  const sm = getServerManager();
  const status = sm.getStatus();
  void dialog.showMessageBox({
    type: 'info',
    title: 'About GeneratorAI',
    message: 'GeneratorAI Desktop',
    detail: [
      `Version: ${app.getVersion()}`,
      `Mode: ${mode}`,
      `Electron: ${process.versions.electron}`,
      `Chrome: ${process.versions.chrome}`,
      `Node: ${process.versions.node}`,
      `Server: ${status.state}${status.url ? ` — ${status.url}` : ''}`,
      status.harness ? `Harness: ${status.harness.type} (${status.harness.healthy ? 'healthy' : 'degraded'})` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  });
}

// Referenced to keep the linter aware these are intentionally part of lifecycle.
void isQuitting;
