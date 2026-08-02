// ────────────────────────────────────────────────────────────────
// Auto-update scaffold (electron-updater). No-op when unpackaged or when no
// update feed is configured, so it is safe to call unconditionally.
// ────────────────────────────────────────────────────────────────

import { app, dialog } from 'electron';
import type { AppUpdater } from 'electron-updater';
import { log } from './logger';

let initialized = false;

async function getUpdater(): Promise<AppUpdater | null> {
  try {
    const mod = await import('electron-updater');
    return mod.autoUpdater;
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
  updater.autoDownload = true;
  updater.logger = {
    info: (m: unknown) => log.info(String(m)),
    warn: (m: unknown) => log.warn(String(m)),
    error: (m: unknown) => log.error(String(m)),
    debug: (m: unknown) => log.debug(String(m)),
  } as never;

  updater.on('update-downloaded', async () => {
    const res = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      message: 'A new version of GeneratorAI has been downloaded.',
      detail: 'Restart the app to apply the update.',
    });
    if (res.response === 0) updater.quitAndInstall();
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
