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
// `updateStateChanged` AND the window is visible (P2-R3). The web shell's
// "Restart to update" pill (P3-06) is that subscriber: whenever the window is
// on screen the pill tells the user, and the dialog is for a hidden window.
//
// Install: see `installUpdate`.
// ────────────────────────────────────────────────────────────────

import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { app, autoUpdater as nativeAutoUpdater, dialog } from 'electron';
import type { AppUpdater } from 'electron-updater';
import { log } from './logger';
import { getWindowManager } from './window-manager';
import { isQuitting, setExitHandoff } from './quit-coordinator';
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
async function offerInstall(options: { force?: boolean } = {}): Promise<void> {
  const win = getWindowManager().getMainWindow();
  // A minimised window still reports `isVisible()`; the user cannot see a pill in it (P2-R37).
  const hasVisibleWindow = Boolean(win && !win.isDestroyed() && win.isVisible() && !win.isMinimized());
  if (!options.force && hasVisibleWindow && rendererWatchesUpdates()) return;
  const version = machine.downloadedVersion;
  const res = await dialog.showMessageBox({
    type: 'info',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    message: version ? `GeneratorAI ${version} has been downloaded.` : 'A new version of GeneratorAI has been downloaded.',
    detail: 'Restart the app to apply the update.',
  });
  if (res.response !== 0) return;
  await installUpdateInteractive();
}

/**
 * An install the user asked for — the "Restart to update" pill (IPC), the
 * menu's "Restart to Update (v…)", the dialog's "Restart Now". Same as
 * `installUpdate`, but a failure is never silent (P2-R37): the app keeps
 * running on this version and says so.
 */
export async function installUpdateInteractive(): Promise<InstallOutcome> {
  const outcome = await installUpdate();
  if (outcome === 'failed') {
    await dialog.showMessageBox({
      type: 'error',
      message: 'The update could not be installed.',
      detail: `${machine.error ?? 'The installer did not start.'}\n\nGeneratorAI keeps running on version ${currentVersion()}.`,
    });
  }
  return outcome;
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
  // reason. A version that was already downloaded stays installable. The
  // version Squirrel.Mac is still fetching is kept: an unrelated error must
  // not make its later `update-downloaded` unattributable (P2-R37).
  updater.on('error', (err: unknown) => update({ phase: 'idle', percent: undefined, error: message(err) }));
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
  // Already downloaded: offer it again rather than checking. After "Later" this
  // is the only way back to the install (the dialog fires only on the
  // transition to ready), and on macOS a new check would re-feed Squirrel.Mac
  // an update it already has (P2-R37). A newer release is picked up by the
  // next launch's check.
  if (machine.downloadedVersion) {
    await offerInstall({ force: true });
    return;
  }
  try {
    const result = await updater.checkForUpdates();
    if (!result?.updateInfo || result.updateInfo.version === app.getVersion()) {
      await dialog.showMessageBox({ type: 'info', message: 'You are up to date.' });
    }
  } catch (e) {
    await dialog.showMessageBox({ type: 'error', message: 'Update check failed', detail: String(e) });
  }
}

// ── Install (P1-review P2-R4, R5, R27, R28) ────────────────────

/** How long the app may take to start quitting before the attempt counts as failed. */
export const INSTALL_HANDOFF_DEADLINE_MS = 60_000;

export type InstallOutcome = 'not-ready' | 'declined' | 'quitting' | 'failed';

let installInFlight: Promise<InstallOutcome> | null = null;
/**
 * Set once an install is committed and never cleared: the process is on its
 * way out. A second `installUpdate` then must not reach electron-updater
 * again. `BaseUpdater.quitAndInstall` resets its own `quitAndInstallCalled`
 * guard when `install()` refuses the second call, and its `quit` handler then
 * installs a second time (P2-R27).
 */
let installCommitted = false;

/**
 * The parts of electron-updater's `BaseUpdater` (NSIS, AppImage, deb, rpm,
 * pacman) the install uses. `downloadedUpdateHelper` is protected in its
 * typings; its `file` is the raw path (`LinuxUpdater.installerPath` returns a
 * shell-escaped copy, which is not a file name).
 */
interface BaseUpdaterLike {
  install(isSilent?: boolean, isForceRunAfter?: boolean): boolean;
  autoRunAppAfterInstall: boolean;
  readonly downloadedUpdateHelper?: { readonly file: string | null } | null;
}

function asBaseUpdater(updater: AppUpdater): (AppUpdater & BaseUpdaterLike) | null {
  return typeof (updater as unknown as Partial<BaseUpdaterLike>).install === 'function'
    ? (updater as unknown as AppUpdater & BaseUpdaterLike)
    : null;
}

/**
 * Installs the downloaded update (`IPC.installUpdate`, the native dialog's
 * "Restart Now", and the P3-06 pill). The sequence per OS is D-54's.
 *
 * Windows and Linux (`BaseUpdater`: NSIS, AppImage, deb, rpm, pacman):
 * shutdown first, installer last (`installAfterShutdown`).
 *   1. Check the install can go ahead: the downloaded file is present, and an
 *      AppImage build was started from its AppImage file. If not: `failed`,
 *      nothing touched, the app keeps running.
 *   2. Ask about unsaved work. Declining changes nothing.
 *   3. Register an exit hand-off with quit-coordinator and `app.quit()`. The
 *      normal `before-quit` → `quitApp` runs; its acceptance is the commit
 *      point (`quitting`). It stops the computer host and the embedded server
 *      and destroys the tray.
 *   4. The hand-off runs right before `exit(0)`: `install()` with the
 *      arguments `quitAndInstall()` would pass. NSIS and AppImage spawn the
 *      installer / the new AppImage detached; deb, rpm and pacman run the
 *      package manager through pkexec and `app.relaunch()`. Nothing of ours
 *      is left for the NSIS installer to kill, and the new AppImage finds the
 *      single-instance lock free.
 *   5. If `install()` refuses, throws, or reports `error` within two
 *      event-loop turns (NSIS reports a failed spawn asynchronously), the app
 *      is relaunched on the current version instead: the shutdown already
 *      ran, so "keeps running" means "comes back".
 *
 * macOS (`MacUpdater`): installer first (`installNativeFirst`). Squirrel.Mac
 * has already verified the update before `ready` (`updaterHasNativeInstallStage`)
 * and ShipIt installs only after the process exits, so there is nothing to
 * race. Ask about unsaved work, mark the window manager quitting (Squirrel
 * closes every window before `before-quit`), `quitAndInstall()`. Its
 * `before-quit` is the commit point, and the normal quit runs the shutdown. An
 * `error`, or no quit within `INSTALL_HANDOFF_DEADLINE_MS`, is a failure: back
 * to `ready` with the error, window restored, app still running.
 *
 * Idempotent once committed (P2-R27). A request while an ordinary quit is
 * already shutting down is `quitting` too: electron-updater's
 * `autoInstallOnAppQuit` installs the update when that quit exits with 0.
 */
export function installUpdate(): Promise<InstallOutcome> {
  if (installCommitted) return Promise.resolve('quitting');
  if (!machine.downloadedVersion || !updaterRef) return Promise.resolve('not-ready');
  if (!installInFlight) {
    if (isQuitting()) return Promise.resolve('quitting');
    const updater = updaterRef;
    installInFlight = runInstall(updater)
      .then((outcome) => {
        if (outcome === 'quitting') installCommitted = true;
        return outcome;
      })
      .finally(() => {
        installInFlight = null;
      });
  }
  return installInFlight;
}

function runInstall(updater: AppUpdater): Promise<InstallOutcome> {
  if (updaterHasNativeInstallStage) return installNativeFirst(updater);
  const base = asBaseUpdater(updater);
  if (!base) return Promise.resolve(failBeforeStart('This build cannot install updates.'));
  return installAfterShutdown(base);
}

/** A failure found before anything was touched. */
function failBeforeStart(error: string): InstallOutcome {
  log.error('Update install cannot start; the app keeps running', { error });
  update({ error });
  return 'failed';
}

/** Why the downloaded update cannot be installed right now, or null. Side-effect free. */
function installBlocker(updater: BaseUpdaterLike): string | null {
  const file = updater.downloadedUpdateHelper?.file ?? null;
  if (!file || !existsSync(file)) return 'The downloaded update is missing. Check for updates to download it again.';
  if (/\.appimage$/i.test(file)) {
    // AppImageUpdater replaces the file the app was started from.
    const current = process.env.APPIMAGE;
    if (!current || !path.isAbsolute(current) || !existsSync(current)) {
      return 'This copy of GeneratorAI was not started from its AppImage file, so it cannot replace itself.';
    }
  }
  return null;
}

async function installAfterShutdown(updater: AppUpdater & BaseUpdaterLike): Promise<InstallOutcome> {
  const blocker = installBlocker(updater);
  if (blocker) return failBeforeStart(blocker);
  const wm = getWindowManager();
  if (!(await wm.confirmDiscard())) return 'declined';
  update({ installing: true, error: undefined });
  log.info('Installing update after the shutdown', { version: machine.downloadedVersion });
  const result = await quitIntoInstaller(updater);
  if (result === 'committed') return 'quitting';

  // Not committed: nothing was stopped. This also forgets the unsaved-work answer.
  wm.setQuitting(false);
  if (result === 'declined') {
    update({ installing: false });
    return 'declined';
  }
  log.error('Update install did not start; the app keeps running', { error: result.error });
  update({ installing: false, error: result.error });
  return 'failed';
}

/** Quits through quit-coordinator with the installer as its exit hand-off. */
function quitIntoInstaller(
  updater: AppUpdater & BaseUpdaterLike,
): Promise<'committed' | 'declined' | { error: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: 'committed' | 'declined' | { error: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      setExitHandoff(null);
      finish({ error: `The app did not start quitting within ${INSTALL_HANDOFF_DEADLINE_MS / 1000}s.` });
    }, INSTALL_HANDOFF_DEADLINE_MS);
    timer.unref?.();
    setExitHandoff({
      onCommitted: () => finish('committed'),
      onDeclined: () => finish('declined'),
      run: () => startInstallerBeforeExit(updater),
    });
    app.quit();
  });
}

/** `count` turns of the event loop: enough for a spawn failure Node reports on the next tick. */
async function nextTurns(count: number): Promise<void> {
  for (let i = 0; i < count; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

/** quit-coordinator's exit hand-off: the shutdown is complete and `exit(0)` follows. */
async function startInstallerBeforeExit(updater: AppUpdater & BaseUpdaterLike): Promise<void> {
  let failure: string | undefined;
  const onError = (err: unknown) => {
    failure ??= message(err);
  };
  updater.on('error', onError);
  try {
    // `quitAndInstall()`'s arguments (not silent; run the app afterwards per
    // `autoRunAppAfterInstall`) without its `app.quit()`: this is the quit.
    if (updater.install(false, updater.autoRunAppAfterInstall)) await nextTurns(2);
    else failure ??= 'The installer did not start.';
  } catch (err) {
    onError(err);
  } finally {
    updater.removeListener('error', onError);
  }
  if (failure === undefined) {
    log.info('Installer started; exiting');
    return;
  }
  log.error('The installer did not start after the shutdown; relaunching the current version', { error: failure });
  relaunchCurrentVersion();
}

function relaunchCurrentVersion(): void {
  // An AppImage runs from a mount that goes away with this process; relaunch the file itself.
  const appImage = process.env.APPIMAGE;
  if (appImage && existsSync(appImage)) app.relaunch({ execPath: appImage });
  else app.relaunch();
}

async function installNativeFirst(updater: AppUpdater): Promise<InstallOutcome> {
  const wm = getWindowManager();
  if (!(await wm.confirmDiscard())) return 'declined';
  update({ installing: true, error: undefined });
  wm.setQuitting(true);
  log.info('Installing update: quitAndInstall', { version: machine.downloadedVersion });
  const handoff = await waitForQuit(updater, () => updater.quitAndInstall());
  if (handoff.ok) return 'quitting';

  log.error('Update install did not start; the app keeps running', { error: handoff.error });
  wm.setQuitting(false);
  update({ installing: false, error: handoff.error });
  // Squirrel.Mac closes every window before it quits; bring one back.
  wm.restoreFromTray();
  return 'failed';
}

/**
 * Starts the install and resolves once the app starts quitting (committed)
 * or electron-updater reports an error / the deadline passes (failed).
 */
function waitForQuit(updater: AppUpdater, start: () => void): Promise<{ ok: true } | { ok: false; error: string }> {
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
