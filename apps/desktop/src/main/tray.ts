// ────────────────────────────────────────────────────────────────
// System tray — quick access to navigation, server status and quit.
//
// Items follow the DesktopMac board on every OS (06 §8), in the registry's
// sentence-case wording: status line(s) · Open GeneratorAI · New chat ·
// Go to (NAV_DESTINATIONS with `tray`, sidebar order, D-24) · Restart server ·
// Quit GeneratorAI. Commands and shortcut hints come from the registry; the
// counts come from `attention-state.ts`, the same source as the dock/taskbar
// badge (G-05).
// ────────────────────────────────────────────────────────────────

import { app, Tray, Menu, nativeImage, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import type { AttentionCounts } from '@generatorai/shared';
import { COMMANDS, NAV_DESTINATIONS, SYSTEM_SHORTCUTS, toElectronAccelerator } from '@generatorai/shared/ui-contract';
import * as path from 'node:path';
import { getWindowManager } from './window-manager';
import { getServerManager } from './server-manager';
import { log } from './logger';
import { accel } from './menu';
import { getAttention } from './attention-state';
import { connectionState } from './backend-switcher';
import { activeConnection } from './serverConnections';
import { isMac } from './platform';

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

/**
 * "· 3 agents" is running CHATS specifically (DesktopMac board: "Server
 * running · 3 agents"); workflow runs and automations do not count here.
 * Empty while there are no live counts (`attention-state.ts`).
 */
function agentsSuffix(attention: AttentionCounts | null): string {
  if (!attention) return '';
  const running = attention.byEntity.chat.running;
  return ` · ${running} agent${running === 1 ? '' : 's'}`;
}

/**
 * The disabled status line(s) at the top of the tray menu.
 *
 * The attention counts belong to whichever server the window shows. In
 * remote mode that is not the embedded server, so the counts go next to the
 * remote server's name, and the embedded server (still running, and what
 * "Restart Server" restarts) gets its own line with its own state and port.
 * One line used to mix them: "Server: ready · 3 agents (:3100)", where the 3
 * came from another machine (P1-review P2-R23).
 */
export function trayStatusLines(input: {
  embedded: { state: string; port: number | null };
  remoteLabel: string | null;
  attention: AttentionCounts | null;
}): string[] {
  const port = input.embedded.port ? ` (:${input.embedded.port})` : '';
  if (input.remoteLabel === null) {
    return [`Server: ${input.embedded.state}${agentsSuffix(input.attention)}${port}`];
  }
  return [`${input.remoteLabel}${agentsSuffix(input.attention)}`, `This computer: ${input.embedded.state}${port}`];
}

export function refreshTrayMenu(): void {
  if (!tray) return;
  const sm = getServerManager();
  const wm = getWindowManager();
  const status = sm.getStatus();
  const attention = getAttention();
  const remote = activeConnection(connectionState());
  const statusLines = trayStatusLines({
    embedded: { state: status.state, port: status.port },
    remoteLabel: remote ? remote.label : null,
    attention,
  });
  const menu = Menu.buildFromTemplate([
    ...statusLines.map<MenuItemConstructorOptions>((label) => ({ label, enabled: false })),
    { type: 'separator' },
    { label: 'Open GeneratorAI', click: () => wm.restoreFromTray() },
    {
      label: COMMANDS['chat.new'].label,
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
    // Same destinations and order as the sidebar (D-22), minus Scripts. The
    // board's per-entity badges (e.g. "Workflows 1") cannot be derived from
    // aggregate counts, so the needs-you total goes on Home only (06 §8).
    ...NAV_DESTINATIONS.filter((d) => d.tray).map<MenuItemConstructorOptions>((d) => ({
      label:
        d.id === 'home' && attention && attention.needsYou > 0
          ? `${d.label} (${attention.needsYou})`
          : d.label,
      click: () => wm.navigateTo(d.path),
    })),
    { type: 'separator' },
    { label: COMMANDS['server.restart'].label, click: () => void sm.restart().catch(() => undefined) },
    { type: 'separator' },
    // `app.quit()` fires `before-quit`, where `quitApp` asks about unsaved
    // work and only then marks the WindowManager as quitting. Nothing is
    // pre-set here: a prevented `before-quit` closes no window, and a flag set
    // before a declined prompt would stay set (P1-review P2-R38).
    {
      label: 'Quit GeneratorAI',
      ...quitHint(),
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(
    attention && attention.needsYou > 0
      ? `GeneratorAI — ${attention.needsYou} need${attention.needsYou === 1 ? 's' : ''} you`
      : 'GeneratorAI',
  );
}

/** The platform's Quit chord (⌘Q on macOS; none elsewhere), displayed only. */
function quitHint(): Pick<MenuItemConstructorOptions, 'accelerator' | 'registerAccelerator'> {
  const quit = SYSTEM_SHORTCUTS.find((s) => s.label === 'Quit');
  const binding = quit?.[isMac ? 'desktopMac' : 'desktopWinLinux'];
  return binding ? { accelerator: toElectronAccelerator(binding), registerAccelerator: false } : {};
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
