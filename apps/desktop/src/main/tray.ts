// ────────────────────────────────────────────────────────────────
// System tray — quick access to navigation, server status and quit.
// ────────────────────────────────────────────────────────────────

import { app, Tray, Menu, nativeImage, type NativeImage } from 'electron';
import * as path from 'node:path';
import { getWindowManager } from './window-manager';
import { getServerManager } from './server-manager';
import { log } from './logger';

const RESOURCES = path.join(__dirname, '..', '..', 'resources');

let tray: Tray | null = null;

function trayImage(): NativeImage {
  const file = process.platform === 'win32' ? 'icon.ico' : 'tray.png';
  let img = nativeImage.createFromPath(path.join(RESOURCES, file));
  if (img.isEmpty()) {
    // Fall back to the main icon if a dedicated tray asset is missing.
    img = nativeImage.createFromPath(path.join(RESOURCES, 'icon.png'));
  }
  if (process.platform === 'darwin' && !img.isEmpty()) {
    img = img.resize({ width: 18, height: 18 });
    img.setTemplateImage(true);
  }
  return img;
}

export function createTray(): void {
  if (tray) return;
  try {
    tray = new Tray(trayImage());
  } catch (e) {
    log.warn('Failed to create tray', e);
    return;
  }
  tray.setToolTip('GeneratorAI');
  refreshTrayMenu();

  // Restores a window hidden by the minimise-to-tray close interception (see
  // WindowManager's `close` handler) or recreates one if it was destroyed.
  tray.on('click', () => getWindowManager().restoreFromTray());

  // On Windows a left click activates and a right click opens the menu; the
  // context menu set via `setContextMenu` already handles right-click there,
  // but on Linux several tray implementations only deliver `right-click`, so
  // pop it explicitly.
  if (process.platform === 'linux') {
    tray.on('right-click', () => tray?.popUpContextMenu());
  }

  getServerManager().on('status', () => refreshTrayMenu());
}

export function refreshTrayMenu(): void {
  if (!tray) return;
  const sm = getServerManager();
  const wm = getWindowManager();
  const status = sm.getStatus();
  const menu = Menu.buildFromTemplate([
    { label: `Server: ${status.state}${status.port ? ` (:${status.port})` : ''}`, enabled: false },
    { type: 'separator' },
    { label: 'Open GeneratorAI', click: () => wm.restoreFromTray() },
    { label: 'Dashboard', click: () => wm.navigateTo('/') },
    { label: 'Chats', click: () => wm.navigateTo('/chats') },
    { label: 'Workflows', click: () => wm.navigateTo('/workflows') },
    { label: 'Automations', click: () => wm.navigateTo('/automations') },
    { type: 'separator' },
    { label: 'Restart Server', click: () => void sm.restart().catch(() => undefined) },
    { type: 'separator' },
    // `app.quit()` fires `before-quit`, where index.ts marks the WindowManager
    // as quitting so the minimise-to-tray `close` interception stands aside.
    { label: 'Quit', click: () => { wm.setQuitting(true); app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
