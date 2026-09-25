// ────────────────────────────────────────────────────────────────
// System tray — quick access to navigation, server status and quit.
// ────────────────────────────────────────────────────────────────

import { app, Tray, Menu, nativeImage, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import { NAV_DESTINATIONS } from '@generatorai/shared/ui-contract';
import * as path from 'node:path';
import { getWindowManager } from './window-manager';
import { getServerManager } from './server-manager';
import { log } from './logger';
import { accel } from './menu';

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
    {
      label: 'New Chat',
      // Shown for discoverability; tray menus do not register accelerators.
      accelerator: accel('chat.new'),
      registerAccelerator: false,
      click: () => {
        wm.restoreFromTray();
        wm.sendCommand('chat.new');
      },
    },
    { type: 'separator' },
    { label: 'Go to', enabled: false },
    // Same destinations and order as the sidebar (D-22), minus Scripts.
    ...NAV_DESTINATIONS.filter((d) => d.tray).map<MenuItemConstructorOptions>((d) => ({
      label: d.label,
      click: () => wm.navigateTo(d.path),
    })),
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
