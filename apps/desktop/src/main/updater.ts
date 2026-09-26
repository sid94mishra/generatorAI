// ────────────────────────────────────────────────────────────────
// Auto-update (electron-updater). A no-op when unpackaged or when no update
// feed is configured, so it is safe to call unconditionally.
//
// State (G-04, 05-gap-matrix.md §G-04, 06-desktop-and-shell.md §8): every
// updater event is folded into one `DesktopUpdateState` and pushed to the
// renderer (`ipc.ts` relays `onUpdateStateChange` as
// `IPC_EVENT.updateStateChanged`). The downloaded version is kept apart from
// the check/download phase, so a later check or a failed one cannot hide an
// update that is ready to install (P1-review P2-R7).
//
// The native "update ready" dialog stays until the renderer can tell the
// user itself: it is skipped only while a renderer has subscribed to
// `updateStateChanged` AND the window is visible (P2-R3). Nothing in the web
// app subscribes before the P3-06 pill, so until then the dialog always shows.
//
// Install: see `installUpdate`.
// ────────────────────────────────────────────────────────────────

import { app, autoUpdater as nativeAutoUpdater, dialog } from 'electron';
import type { AppUpdater } from 'electron-updater';
import { log } from './logger';
import { getWindowManager } from './window-manager';
import { updaterHasNativeInstallStage } from './platform';
import type { DesktopUpdateState } from '../shared/ipc';

let initialized = false;
let updaterRef: AppUpdater | null = null;

interface Machine {
  /** What the updater is doing right now; independent of whether something is downloaded. */
  phase: 'idle' | 'checking' | 'downloading';
  /** The version the current check/download is about. */
  nextVersion?: string;
  percent?: number;
  /** Installable. Survives later checks and failures (R7). */
  downloadedVersion?: string;
  /** macOS: downloaded by electron-updater, not yet by Squirrel.Mac. */
  awaitingNativeVersion?: string;
  /** macOS: Squirrel.Mac has reported an installable update. */
  nativeDownloaded: boolean;
  installing: boolean;
  error?: string;
}

const INITIAL: Machine = { phase: 'idle', nativeDownloaded: false, installing: false };
let machine: Machine = { ...INITIAL };

const listeners = new Set<(state: DesktopUpdateState) => void>();

function currentVersion(): string {
  try {
    return app.getVersion();
  } catch {
    // `app` is not ready yet. Should not happen (this module is only driven
    // from `onReady`), but a blank version beats a crash.
    return '';
  }
}

/** Current updater state, for `IPC.getUpdateState`. */
export function getUpdateState(): DesktopUpdateState {
  const m = machine;
  const status: DesktopUpdateState['status'] = m.installing ? 'installing' : m.downloadedVersion ? 'ready' : m.phase;
  const nextVersion = m.downloadedVersion ?? (m.phase === 'idle' ? undefined : m.nextVersion);
  return {
    status,
    currentVersion: currentVersion(),
    ...(nextVersion ? { nextVersion } : {}),
    ...(m.downloadedVersion ? { downloadedVersion: m.downloadedVersion } : {}),
    ...(status === 'downloading' && m.percent !== undefined ? { percent: m.percent } : {}),
    ...(m.error ? { error: m.error } : {}),
  };
}

/** Subscribe to state changes, for `IPC_EVENT.updateStateChanged`. Returns an unsubscribe function. */
export function onUpdateStateChange(listener: (state: DesktopUpdateState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function update(patch: Partial<Machine>): void {
  const wasReady = Boolean(machine.downloadedVersion);
  machine = { ...machine, ...patch };
  const snapshot = getUpdateState();
  for (const listener of listeners) listener(snapshot);
  if (!wasReady && machine.downloadedVersion) void offerInstall();
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Renderer subscriptions (R3) ────────────────────────────────

/** Live `updates.onChange` subscriptions, per renderer (webContents id). */
const watchers = new Map<number, number>();

/** Records one subscribe (`true`) or unsubscribe (`false`) from renderer `ownerId`. */
export function setUpdateWatch(ownerId: number, watching: boolean): void {
  const next = (watchers.get(ownerId) ?? 0) + (watching ? 1 : -1);
  if (next > 0) watchers.set(ownerId, next);
  else watchers.delete(ownerId);
}

/**
 * Forgets every subscription: the page that made them navigated away,
 * reloaded, died or closed (`WindowManager.onRendererReset`), and its
 * listeners went with it without unsubscribing.
 */
export function clearUpdateWatchers(): void {
  watchers.clear();
}

/** True while some renderer is listening for update state and can tell the user itself. */
export function rendererWatchesUpdates(): boolean {
  return watchers.size > 0;
}

/**
 * Tells the user an update is ready. The native dialog is skipped only when a
 * subscribed renderer is on screen to show it instead; with no window, a
 * hidden one (minimised to the tray) or no subscriber, the dialog is the only
 * way the user learns about it.
 */
async function offerInstall(): Promise<void> {
  const win = getWindowManager().getMainWindow();
  const hasVisibleWindow = Boolean(win && !win.isDestroyed() && win.isVisible());
  if (hasVisibleWindow && rendererWatchesUpdates()) return;
  const version = machine.downloadedVersion;
  const res = await dialog.showMessageBox({
    type: 'info',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    message: version ? `GeneratorAI ${version} has been downloaded.` : 'A new version of GeneratorAI has been downloaded.',
    detail: 'Restart the app to apply the update.',
  });
  if (res.response === 0) await installUpdate();
}

async function getUpdater(): Promise<AppUpdater | null> {
  try {
    const mod = await import('electron-updater');
    // `autoUpdater` is a lazy getter on module.exports, and cjs-module-lexer
    // cannot see those — so it is absent from the ESM namespace and only
    // reachable through `default`. Reading the namespace alone yields
    // undefined, which silently disabled auto-update in every packaged build.
    const resolved =
      mod.autoUpdater ??
      (mod as unknown as { default?: { autoUpdater?: AppUpdater } }).default?.autoUpdater ??
      null;
    if (!resolved) {
      log.error('electron-updater loaded but exposes no autoUpdater', Object.keys(mod).join(', '));
    }
    return resolved;
  } catch (e) {
    log.warn('electron-updater not available', e);
    return null;
  }
}

export async function initAutoUpdates(): Promise<void> {
  if (initialized || !app.isPackaged) return;
  initialized = true;
  const updater = await getUpdater();
  if (!updater) return;
  updaterRef = updater;
  updater.autoDownload = true;
  updater.logger = {
    info: (m: unknown) => log.info(String(m)),
    warn: (m: unknown) => log.warn(String(m)),
    error: (m: unknown) => log.error(String(m)),
    debug: (m: unknown) => log.debug(String(m)),
  } as never;

  updater.on('checking-for-update', () => update({ phase: 'checking', error: undefined }));
  updater.on('update-not-available', () =>
    update({ phase: 'idle', nextVersion: undefined, percent: undefined, error: undefined }),
  );
  updater.on('update-available', (info: { version?: string }) => {
    // A newer build than the one already downloaded replaces it: electron-updater
    // downloads it over the cached one.
    const replaces = Boolean(machine.downloadedVersion && info?.version !== machine.downloadedVersion);
    update({
      phase: 'downloading',
      nextVersion: info?.version,
      percent: 0,
      error: undefined,
      ...(replaces ? { downloadedVersion: undefined, nativeDownloaded: false } : {}),
    });
  });
  updater.on('download-progress', (p: { percent?: number }) =>
    update({ phase: 'downloading', percent: p?.percent, error: undefined }),
  );
  updater.on('update-cancelled', () =>
    update({ phase: 'idle', percent: undefined, awaitingNativeVersion: undefined, error: undefined }),
  );
  // A failed check, download or Squirrel.Mac hand-over: back to idle with the
  // reason. A version that was already downloaded stays installable.
  updater.on('error', (err: unknown) =>
    update({ phase: 'idle', percent: undefined, awaitingNativeVersion: undefined, error: message(err) }),
  );
  updater.on('update-downloaded', (info: { version?: string }) => {
    const version = info?.version;
    if (updaterHasNativeInstallStage && !machine.nativeDownloaded) {
      // Squirrel.Mac still has to fetch and verify it; `quitAndInstall` before
      // then waits forever. Stay "downloading" until it reports.
      update({ phase: 'downloading', nextVersion: version, percent: 100, awaitingNativeVersion: version, error: undefined });
      return;
    }
    update({ phase: 'idle', nextVersion: version, percent: undefined, downloadedVersion: version, error: undefined });
  });
  if (updaterHasNativeInstallStage) {
    nativeAutoUpdater.on('update-downloaded', () => {
      const version = machine.awaitingNativeVersion;
      update({
        nativeDownloaded: true,
        ...(version
          ? { phase: 'idle', percent: undefined, awaitingNativeVersion: undefined, downloadedVersion: version, error: undefined }
          : {}),
      });
    });
  }

  try {
    await updater.checkForUpdates();
  } catch (e) {
    // A missing/invalid feed is expected in unconfigured builds; the `error`
    // event has already recorded it as idle + error.
    log.debug('checkForUpdates skipped', e);
  }
}

export async function checkForUpdatesInteractive(): Promise<void> {
  if (!app.isPackaged) {
    await dialog.showMessageBox({
      type: 'info',
      message: 'Updates are only available in packaged builds.',
    });
    return;
  }
  const updater = updaterRef ?? (await getUpdater());
  if (!updater) return;
  try {
    const result = await updater.checkForUpdates();
    if (!result?.updateInfo || result.updateInfo.version === app.getVersion()) {
      await dialog.showMessageBox({ type: 'info', message: 'You are up to date.' });
    }
  } catch (e) {
    await dialog.showMessageBox({ type: 'error', message: 'Update check failed', detail: String(e) });
  }
}

// ── Install (R4, R5) ───────────────────────────────────────────

/** How long the installer hand-over may take before the attempt counts as failed. */
export const INSTALL_HANDOFF_DEADLINE_MS = 60_000;

export type InstallOutcome = 'not-ready' | 'declined' | 'quitting' | 'failed';

let installInFlight: Promise<InstallOutcome> | null = null;

/**
 * Installs the downloaded update (`IPC.installUpdate`, the native dialog's
 * "Restart Now", and the P3-06 pill).
 *
 * Nothing is stopped until the install is committed (P1-review P2-R4). The
 * order is:
 *   1. Ask about unsaved work (`confirmDiscard`). Declining changes nothing.
 *   2. Mark the window manager as quitting, so the windows `quitAndInstall`
 *      closes are closed rather than hidden to the tray.
 *   3. `quitAndInstall()`. On Windows/Linux (`BaseUpdater`) it runs the
 *      installer synchronously (`install()`): NSIS/AppImage spawn it
 *      detached, deb/rpm run the package manager through pkexec. Only if that
 *      returns true does it call `app.quit()`. On macOS (`MacUpdater`) Squirrel
 *      closes every window and then terminates the app, and ShipIt installs
 *      once the process has exited.
 *   4. The resulting `before-quit` is the commit point. index.ts's normal
 *      handler then runs the one bounded shutdown (`quit-coordinator.ts`:
 *      computer host, embedded server, tray) and `app.exit(0)`, exactly like
 *      any other quit. The installer is already running or queued by then.
 *   5. If electron-updater reports `error` instead (no installer file, pkexec
 *      cancelled, AppImage without `APPIMAGE`, Squirrel rejecting the
 *      signature), or nothing happens within the deadline, the attempt
 *      failed: the state goes back to `ready` with the error, the quitting
 *      flag is cleared and the window is restored. Nothing was stopped, so the
 *      app simply keeps running.
 *
 * On the R5 question (does `app.exit(0)` in `before-quit` break
 * `autoInstallOnAppQuit`?): no. `app.exit` skips only `before-quit` and
 * `will-quit`; Electron's `Browser::ExitWithCode` → `Shutdown()` still
 * notifies `OnQuit`, and `App::OnQuit` emits `quit` with the exit code (0),
 * which is what electron-updater's `addQuitHandler` listens for. So a
 * downloaded update also installs on an ordinary quit. That reading of
 * Electron's source still has to be confirmed per OS with
 * `mock-update-server` (06 §8, 07 R-10).
 */
export function installUpdate(): Promise<InstallOutcome> {
  if (!machine.downloadedVersion || !updaterRef) return Promise.resolve('not-ready');
  if (!installInFlight) {
    const updater = updaterRef;
    installInFlight = runInstall(updater).finally(() => {
      installInFlight = null;
    });
  }
  return installInFlight;
}

async function runInstall(updater: AppUpdater): Promise<InstallOutcome> {
  const wm = getWindowManager();
  if (!(await wm.confirmDiscard())) return 'declined';
  update({ installing: true, error: undefined });
  wm.setQuitting(true);
  log.info('Installing update: quitAndInstall', { version: machine.downloadedVersion });
  const handoff = await waitForInstallHandoff(updater, () => updater.quitAndInstall());
  if (handoff.ok) return 'quitting';

  log.error('Update install did not start; the app keeps running', { error: handoff.error });
  wm.setQuitting(false);
  update({ installing: false, error: handoff.error });
  // Squirrel.Mac closes every window before it installs; bring one back.
  wm.restoreFromTray();
  return 'failed';
}

/**
 * Starts the install and resolves once the app starts quitting (committed)
 * or electron-updater reports an error / the deadline passes (failed).
 */
function waitForInstallHandoff(
  updater: AppUpdater,
  start: () => void,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { ok: true } | { ok: false; error: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      app.removeListener('before-quit', onQuit);
      updater.removeListener('error', onError);
      resolve(result);
    };
    const onQuit = () => finish({ ok: true });
    const onError = (err: unknown) => finish({ ok: false, error: message(err) });
    const timer = setTimeout(
      () => finish({ ok: false, error: `The installer did not start within ${INSTALL_HANDOFF_DEADLINE_MS / 1000}s.` }),
      INSTALL_HANDOFF_DEADLINE_MS,
    );
    timer.unref?.();
    app.on('before-quit', onQuit);
    updater.on('error', onError);
    try {
      start();
    } catch (err) {
      onError(err);
    }
  });
}
