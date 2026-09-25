// ────────────────────────────────────────────────────────────────
// Auto-update scaffold (electron-updater). No-op when unpackaged or when no
// update feed is configured, so it is safe to call unconditionally.
//
// State (G-04, 05-gap-matrix.md §G-04, 06-desktop-and-shell.md §8): every
// updater event is folded into one `UpdateState` and pushed to the renderer
// (`ipc.ts` relays `onUpdateStateChange` as `IPC_EVENT.updateStateChanged`),
// so the "Restart to update" pill can be built once P3 lands, instead of the
// native dialog this file used to show unconditionally.
//
// Install path (06 §11 risk R5): see `installUpdate` below for what was
// verified and fixed.
// ────────────────────────────────────────────────────────────────

import { app, dialog } from 'electron';
import type { AppUpdater } from 'electron-updater';
import { log } from './logger';
import { getWindowManager } from './window-manager';
import { runQuitShutdown } from './quit-coordinator';
import type { UpdateState } from '../shared/ipc';

let initialized = false;
let mode: 'dev' | 'standalone' = 'standalone';
let updaterRef: AppUpdater | null = null;

/** Everything but `currentVersion`, which is read live from `app.getVersion()`. */
let state: Omit<UpdateState, 'currentVersion'> = { status: 'idle' };

const listeners = new Set<(state: UpdateState) => void>();

function currentVersion(): string {
  try {
    return app.getVersion();
  } catch {
    // `app` is not ready yet — should not happen in practice (this module is
    // only driven from `onReady`), but a blank version beats a crash.
    return '';
  }
}

/** Current updater state, for `IPC.getUpdateState`. */
export function getUpdateState(): UpdateState {
  return { ...state, currentVersion: currentVersion() };
}

/** Subscribe to state changes, for `IPC_EVENT.updateStateChanged`. Returns an unsubscribe function. */
export function onUpdateStateChange(listener: (state: UpdateState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(patch: Partial<Omit<UpdateState, 'currentVersion'>>): void {
  state = { ...state, ...patch };
  const snapshot = getUpdateState();
  for (const listener of listeners) listener(snapshot);
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

export async function initAutoUpdates(appMode: 'dev' | 'standalone'): Promise<void> {
  mode = appMode;
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

  updater.on('checking-for-update', () => setState({ status: 'checking' }));
  updater.on('update-not-available', () => setState({ status: 'idle', nextVersion: undefined, percent: undefined }));
  updater.on('update-available', (info: { version?: string }) =>
    setState({ status: 'downloading', nextVersion: info?.version, percent: 0 }),
  );
  updater.on('download-progress', (p: { percent?: number }) =>
    setState({ status: 'downloading', percent: p?.percent }),
  );
  updater.on('error', (err: unknown) =>
    setState({ status: 'error', error: err instanceof Error ? err.message : String(err) }),
  );

  updater.on('update-downloaded', async (info: { version?: string }) => {
    setState({ status: 'ready', nextVersion: info?.version, percent: 100 });
    // The renderer shows a pill once one exists (P3); until it does — and
    // whenever there is genuinely no window to show it in, e.g. the shell was
    // minimised to the tray on every OS — a native dialog is the only way the
    // user ever learns an update is ready at all.
    const win = getWindowManager().getMainWindow();
    const hasVisibleWindow = Boolean(win && !win.isDestroyed() && win.isVisible());
    if (hasVisibleWindow) return;
    const res = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      message: 'A new version of GeneratorAI has been downloaded.',
      detail: 'Restart the app to apply the update.',
    });
    if (res.response === 0) await installUpdate();
  });

  try {
    await updater.checkForUpdates();
  } catch (e) {
    // A missing/invalid feed is expected in unconfigured builds.
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
  const updater = await getUpdater();
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

/**
 * Installs a downloaded update (`IPC.installUpdate`, the future "Restart to
 * update" pill's action).
 *
 * **06-desktop-and-shell.md §11 risk R5, verified**: `before-quit` (index.ts)
 * always finishes in `app.exit(0)` once its own bounded shutdown is done —
 * Electron's docs state plainly that `app.exit()` "will not emit the
 * `before-quit` and `will-quit` events". `electron-updater`'s `BaseUpdater`
 * (`node_modules/electron-updater/out/BaseUpdater.js`) has two install paths:
 *
 *   1. `quitAndInstall()` itself: it calls `this.install()` — which spawns
 *      the platform installer as a **detached, unref'd** child process —
 *      SYNCHRONOUSLY, and only after that (`setImmediate`) calls
 *      `this.app.quit()`. So calling `quitAndInstall()` and then letting our
 *      own `app.exit(0)` run is not actually broken: the installer is
 *      already launched, and a detached child survives its parent exiting.
 *   2. `autoInstallOnAppQuit` (the "user just quit normally with an update
 *      already downloaded" case): it installs from an `app.once('quit', …)`
 *      listener registered via `ElectronAppAdapter.onQuit`. `app.exit()`
 *      never emits `'quit'` either (it bypasses the whole quit sequence), so
 *      **this path is silently skipped** by our shutdown — an update
 *      downloaded in the background and never explicitly installed would
 *      never install itself on quit.
 *
 * The fix applies to both paths at once: run the SAME bounded shutdown
 * (`runQuitShutdown`, shared with `before-quit`) here, then call
 * `quitAndInstall()` instead of `app.exit(0)`. `runQuitShutdown` marks the
 * quit handled, so when `quitAndInstall()`'s own `app.quit()` fires
 * `before-quit`, index.ts's handler no-ops instead of intercepting it again —
 * Electron's default quit then completes normally, `will-quit`/`quit` fire,
 * and `autoInstallOnAppQuit`'s listener sees `quitAndInstallCalled` already
 * true and no-ops harmlessly (the installer was already spawned by our own
 * `quitAndInstall()` call). Neither path depends on `app.exit(0)` any more.
 *
 * Not yet run against a real installer on each OS — 06 §8 calls for that with
 * `mock-update-server`, which is a manual/CI verification step, not one this
 * change can exercise from a unit test.
 */
export async function installUpdate(): Promise<void> {
  if (state.status !== 'ready') return;
  const updater = updaterRef ?? (await getUpdater());
  if (!updater) return;
  const proceeded = await runQuitShutdown(mode);
  if (!proceeded) return;
  log.info('Installing update — quitAndInstall');
  updater.quitAndInstall();
}
