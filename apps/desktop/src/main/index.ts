// ────────────────────────────────────────────────────────────────
// GeneratorAI Desktop — Electron main process entry.
//
// Boots the embedded GeneratorAI server (production mode: serves the built web
// SPA same-origin + the /api surface), then opens a window onto that single
// loopback URL. The web UI runs unmodified → full feature + look-and-feel
// parity with the web app, and full CLI parity at the API layer.
// ────────────────────────────────────────────────────────────────

import { app, dialog, nativeTheme, BrowserWindow, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { log } from './logger';
import { loadSettings } from './config';
import { getServerManager, KeystoreUnavailableError, VAULT_UNREADABLE_MESSAGE } from './server-manager';
import { resolveTarget } from './serverConnections';
import { VERIFY_USE_CHROMIUM, verifyWithPins } from './pinnedTrust';
import { getWindowManager } from './window-manager';
import { getNativeBrowserHost, nativeBrowserEnabled } from './browser-host';
import { initComputerHost } from './computer-host-registry';
import { setIpcToken } from './cdp/ipc-token';
import { registerIpc } from './ipc';
import { buildMenu, setMenuUpdateReady, syncMenuThemeFromSettings } from './menu';
import { registerLauncherActions } from './launcher-actions';
import { createTray, refreshTrayMenu } from './tray';
import { registerDownloadHandler } from './downloads';
import {
  registerDeepLinks,
  registerProtocolClient,
  handleDeepLink,
  findDeepLinkInArgv,
} from './deep-link';
import {
  checkForUpdatesInteractive,
  initAutoUpdates,
  installUpdateInteractive,
  onUpdateStateChange,
} from './updater';
import { repointTarget } from './repoint';
import { isQuitting, quitApp } from './quit-coordinator';
import { handleLocalPages, registerLocalPagesScheme } from './local-pages';

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
// Before ready: the shell's splash/error/prompt pages come from a custom scheme (local-pages.ts).
registerLocalPagesScheme();

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
  // Before `whenReady`: on macOS a link that launches the app arrives as
  // `open-url` during `will-finish-launching`.
  registerDeepLinks();

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

  app.on('before-quit', (event) => {
    // Every quit, an update install's included, is cancelled here and
    // finished by `quitApp`: it asks before discarding unsaved edits (Cmd+Q
    // and the Dock's Quit reach here without the window's close handler ever
    // running), runs the bounded shutdown and ends in `app.exit(0)`, which
    // still emits `quit` for electron-updater (quit-coordinator.ts).
    event.preventDefault();
    void quitApp(mode);
  });
}

async function onReady(): Promise<void> {
  // One line per launch with the running version: the update-install run
  // (agent-tests/mock-update-server.mjs verify-log) reads it to confirm the
  // app came back on the new version.
  log.info('GeneratorAI starting', { version: app.getVersion(), platform: process.platform, packaged: app.isPackaged });
  handleLocalPages();
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
  // D-105: an agent's browser call with no Browser dock tab open gets a hidden agent tab.
  sm.on('browser-ensure-tab', (workspaceId: string) => {
    const host = getNativeBrowserHost();
    // The window is otherwise attached on the first renderer-created tab, which is exactly what is missing here.
    const win = wm.getMainWindow();
    if (win) host.attachOwnerWindow(win);
    host.ensureAgentTab(workspaceId);
  });

  registerIpc(mode);
  registerDownloadHandler(session.defaultSession);

  // G-4 (D-126): another machine's GeneratorAI server is trusted through the
  // CA pinned for it when it was added — for that server's host only. Chromium's
  // own OK (a ts.net or other public certificate) is kept; everything else
  // gets Chromium's verdict, so an unpinned self-signed server still fails.
  // The app's session only: native browser tabs have their own partitions.
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    try {
      callback(
        verifyWithPins(
          { hostname: request.hostname, verificationResult: request.verificationResult, certificatePem: request.certificate.data },
          loadSettings().servers.connections,
        ),
      );
    } catch (err) {
      log.warn('Certificate check failed; using Chromium’s verdict', err);
      callback(VERIFY_USE_CHROMIUM);
    }
  });

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
  buildMenu({
    showAbout,
    checkForUpdates: () => void checkForUpdatesInteractive(),
    installUpdate: () => void installUpdateInteractive(),
  });
  syncMenuThemeFromSettings();
  // Help ▸ "Check for Updates…" becomes "Restart to Update (v…)" while an
  // update is ready (06 §8); the same state feeds the renderer's pill.
  onUpdateStateChange((s) => setMenuUpdateReady(s.status === 'ready' ? (s.downloadedVersion ?? null) : null));
  registerAboutPanel();
  // macOS Dock menu / Windows JumpList from the registry's LAUNCHER_ACTIONS.
  registerLauncherActions();
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
      if (err instanceof KeystoreUnavailableError) {
        await offerKeystoreRetry(err);
        return;
      } else if (sm.isVaultUnreadable()) {
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

  void initAutoUpdates();
}

/**
 * The OS keystore would not hand over the vault key — most often a macOS
 * keychain prompt that was dismissed or denied. Nothing is lost, so offer the
 * fix instead of an error screen. A fresh process is the reliable retry: the
 * keystore answer can stick for the life of this one, and a relaunch asks the
 * OS again.
 */
async function offerKeystoreRetry(err: KeystoreUnavailableError): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Try again', 'Quit'],
    defaultId: 0,
    cancelId: 1,
    title: 'GeneratorAI is locked',
    message: 'GeneratorAI is locked',
    detail: err.message,
  });
  if (response === 0) app.relaunch();
  // Nothing was started, so there is no graceful shutdown to wait for.
  app.exit(0);
}

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
    // `before-quit` → `quitApp` sets the quitting flag once the quit is
    // accepted; setting it here first leaked when the unsaved-work prompt was
    // declined (P1-review P2-R38).
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

function registerAboutPanel(): void {
  app.setAboutPanelOptions({
    applicationName: 'GeneratorAI',
    applicationVersion: app.getVersion(),
    version: `Electron ${process.versions.electron}`,
    copyright: `© ${new Date().getFullYear()} GeneratorAI`,
  });
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
