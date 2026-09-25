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
import { getServerManager, VAULT_UNREADABLE_MESSAGE } from './server-manager';
import { resolveTarget } from './serverConnections';
import { getWindowManager } from './window-manager';
import { nativeBrowserEnabled } from './browser-host';
import { initComputerHost } from './computer-host-registry';
import { setIpcToken } from './cdp/ipc-token';
import { registerIpc } from './ipc';
import { NAV_DESTINATIONS } from '@generatorai/shared/ui-contract';
import { buildMenu, syncMenuThemeFromSettings } from './menu';
import { createTray, refreshTrayMenu } from './tray';
import { registerDownloadHandler } from './downloads';
import {
  registerDeepLinks,
  registerProtocolClient,
  handleDeepLink,
  findDeepLinkInArgv,
} from './deep-link';
import { initAutoUpdates, checkForUpdatesInteractive } from './updater';
import { repointTarget } from './repoint';
import { isQuitHandled, isQuitting, markQuitting, runQuitShutdown } from './quit-coordinator';

const DEV_SERVER_URL = process.env['DESKTOP_DEV_SERVER_URL'] || null;
const mode: 'dev' | 'standalone' = DEV_SERVER_URL ? 'dev' : 'standalone';

let appUrl: string | null = null;
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
    const wm = getWindowManager();
    // The WindowManager's URL, not the boot-time local: a restart or a
    // backend switch may have moved the app since launch.
    const url = wm.getAppUrl() ?? appUrl;
    if (BrowserWindow.getAllWindows().length === 0 && url) {
      wm.createMainWindow(url, { cspFloor: mode !== 'dev' });
    }
  });

  app.on('window-all-closed', () => {
    const settings = loadSettings();
    if (process.platform !== 'darwin' && !settings.minimizeToTray) {
      app.quit();
    }
  });

  app.on('before-quit', async (event) => {
    // Already run — either this handler ran it, or `installUpdate` did on the
    // update-install path (quit-coordinator.ts). Returning without
    // `preventDefault()` lets Electron's own quit sequence finish normally,
    // which matters for `quitAndInstall()`: it needs `will-quit`/`quit` to
    // actually fire, and `app.exit(0)` below never emits them.
    if (isQuitHandled()) return;
    event.preventDefault();
    // Ask before discarding unsaved edits — Cmd+Q and the Dock's Quit reach
    // here without the window's close handler ever running.
    const proceeded = await runQuitShutdown(mode);
    if (!proceeded) return;
    // Bounded shutdown already ran inside `runQuitShutdown`; `app.exit(0)` is
    // the only thing that actually ends the process once `preventDefault()`
    // has been called. Anything that could still hang belongs in that
    // routine's own deadline, not here.
    log.info('Exiting');
    app.exit(0);
  });
}

async function onReady(): Promise<void> {
  const settings = loadSettings();
  // Mirror the renderer's last mode (D-25) before any window exists, so
  // prefers-color-scheme and the native chrome agree from the first frame.
  nativeTheme.themeSource = settings.appearance.mode;

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

  // "Restart Server" (menu, tray, renderer) stops and starts the child, which
  // may come back on a different port. The window used to keep the old URL
  // and every request died until the user quit; now a ready status on a new
  // origin repoints it. Only while the shell is showing the embedded server —
  // a remote backend is unaffected by the local one restarting.
  // A vault that stops opening mid-session leaves the server dead and every
  // request failing; the same recovery is offered as at startup.
  sm.on('vault-unreadable', () => {
    if (isQuitting()) return;
    void offerVaultReset(sm);
  });

  sm.on('status', (status) => {
    refreshTrayMenu();
    if (mode === 'dev') return;
    const next = repointTarget(status, wm.getAppUrl(), loadSettings().servers.serverMode);
    if (next && wm.getMainWindow()) {
      log.info('Embedded server moved — repointing the window', { from: wm.getAppUrl(), to: next });
      wm.repointMainWindow(next);
    }
  });

  if (mode === 'dev') {
    appUrl = DEV_SERVER_URL;
    log.info('Dev mode — attaching to external dev server', { appUrl });
  } else if (target?.mode === 'remote') {
    appUrl = target.url;
    log.info('Remote mode — attaching to a server on another machine', { appUrl });
    // The embedded server still starts, so switching back is instant and any
    // work already running locally keeps going. A failure here is not fatal:
    // the window is pointed somewhere else entirely.
    void sm.start().catch((err: unknown) => {
      log.warn('Embedded server did not start while in remote mode', err);
    });
  } else {
    try {
      await sm.start();
      appUrl = sm.url;
    } catch (err) {
      // Quitting during startup is not a failure. Closing the app while the
      // server is still coming up stops the child, which makes this `start()`
      // reject — reporting that to the user would be blaming them for their own
      // decision, and the window it opens is what used to stop the app exiting
      // at all (see `showError`, which now refuses regardless).
      if (isQuitting()) {
        log.info('Server start abandoned because the app is quitting');
        return;
      }
      log.error('Embedded server failed to start', err);
      if (sm.isVaultUnreadable()) {
        // Recoverable, but only by discarding the vault — so it is the user's
        // call, not ours. Without this the app restart-looped and then sat on
        // an error screen quoting a decryption stack trace, with no way out.
        if (await offerVaultReset(sm)) {
          appUrl = sm.url;
        } else {
          return;
        }
      } else {
        wm.showError(
          `The GeneratorAI server failed to start.\n\n${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
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

  // The CSP floor mirrors the server's policy onto any document this session
  // renders without one. Off in dev: Vite's responses carry no CSP and rely on
  // inline HMR scripts plus a cross-origin API.
  wm.createMainWindow(appUrl, { cspFloor: mode !== 'dev' });

  // Handle a deep link passed on first launch (Windows/Linux).
  const initialLink = findDeepLinkInArgv(process.argv);
  if (initialLink) handleDeepLink(initialLink);

  void initAutoUpdates(mode);
}

/**
 * Native OS integrations that are not menus: the macOS About panel (so
 * `⌘ + About GeneratorAI` shows the standard sheet rather than a generic
 * dialog), the Dock menu, and the Windows JumpList. Each is a no-op on the
 * platforms that do not have that affordance.
 */
/**
 * The credential vault cannot be opened with the key this machine still has.
 * That is unrecoverable for the stored credentials, but perfectly recoverable
 * for the app — so ask, rather than leaving the user on an error screen.
 *
 * Returns true when the server is running again.
 */
let vaultPromptOpen = false;

async function offerVaultReset(sm: ReturnType<typeof getServerManager>): Promise<boolean> {
  // Both the startup failure and the runtime 'vault-unreadable' event lead
  // here, and a single failure can raise both. One prompt, not two.
  if (vaultPromptOpen) return false;
  vaultPromptOpen = true;
  try {
    return await promptVaultReset(sm);
  } finally {
    vaultPromptOpen = false;
  }
}

async function promptVaultReset(sm: ReturnType<typeof getServerManager>): Promise<boolean> {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Reset saved credentials', 'Quit'],
    defaultId: 0,
    cancelId: 1,
    title: 'Saved credentials could not be unlocked',
    message: 'Saved credentials could not be unlocked',
    detail:
      `${VAULT_UNREADABLE_MESSAGE}\n\n` +
      'Resetting keeps your chats, projects and settings. It clears stored ' +
      'credentials only — provider API keys and connected accounts have to be ' +
      'entered again, and paired devices have to be paired again. The old ' +
      'vault file is kept next to it in case the keystore entry can be restored.',
  });
  if (response !== 0) {
    markQuitting(true);
    app.quit();
    return false;
  }
  sm.resetVault();
  try {
    await sm.restart();
    return true;
  } catch (err) {
    log.error('Server still failed to start after a vault reset', err);
    getWindowManager().showError(
      `The GeneratorAI server failed to start.\n\n${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

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
        { label: NAV_DESTINATIONS[0].label, click: () => go(NAV_DESTINATIONS[0].path) },
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
