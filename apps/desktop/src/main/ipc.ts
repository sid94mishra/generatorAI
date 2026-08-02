// ────────────────────────────────────────────────────────────────
// IPC handlers — the trusted boundary between the renderer (web app) and the
// main process. Every channel is explicitly registered and validated.
// ────────────────────────────────────────────────────────────────

import { app, ipcMain, dialog, shell, nativeTheme, BrowserWindow } from 'electron';
import * as fs from 'node:fs';
import {
  IPC,
  IPC_EVENT,
  type AppInfo,
  type DesktopPairingCode,
  type MenuState,
  type SaveFileOptions,
  type ThemePreference,
  type WindowChrome,
} from '../shared/ipc';
import { BROWSER_IPC, BROWSER_IPC_EVENT, type BrowserBounds, type NativeBrowserEvent } from '../shared/browser-ipc';
import { getWindowManager } from './window-manager';
import { getServerManager } from './server-manager';
import { getNativeBrowserHost } from './browser-host';
import { resolvePaths } from './paths';
import { loadSettings, saveSettings } from './config';
import { windowChrome } from './platform';
import { updateMenuState } from './menu';
import { log } from './logger';

const SETTING_WHITELIST = new Set([
  'theme',
  'serverPort',
  'harnessType',
  'minimizeToTray',
  'lastRoute',
]);

export function registerIpc(mode: 'dev' | 'standalone'): void {
  const wm = getWindowManager();
  const sm = getServerManager();
  const paths = resolvePaths();

  ipcMain.handle(IPC.getAppInfo, (): AppInfo => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      versions: {
        electron: process.versions.electron ?? '',
        node: process.versions.node ?? '',
        chrome: process.versions.chrome ?? '',
        v8: process.versions.v8 ?? '',
      },
      platform: process.platform,
      arch: process.arch,
      isPackaged: app.isPackaged,
      mode,
      dataDir: paths.dataDir,
      logFile: log.getLogFilePath() ?? '',
      serverUrl: sm.url,
    };
  });

  ipcMain.handle(IPC.getServerStatus, () => sm.getStatus());

  ipcMain.handle(IPC.restartServer, async () => {
    if (mode === 'dev') return; // external dev server is not managed here
    await sm.restart();
  });

  ipcMain.handle(IPC.selectDirectory, async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow() ?? wm.getMainWindow() ?? undefined;
    const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0] ?? null;
  });

  ipcMain.handle(
    IPC.selectFile,
    async (_e, filters?: { name: string; extensions: string[] }[]): Promise<string | null> => {
      const win = BrowserWindow.getFocusedWindow() ?? wm.getMainWindow() ?? undefined;
      const res = await dialog.showOpenDialog(win!, {
        properties: ['openFile'],
        filters: filters ?? [],
      });
      if (res.canceled || res.filePaths.length === 0) return null;
      return res.filePaths[0] ?? null;
    },
  );

  ipcMain.handle(IPC.saveFile, async (_e, opts: SaveFileOptions): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow() ?? wm.getMainWindow() ?? undefined;
    const res = await dialog.showSaveDialog(win!, {
      defaultPath: opts.defaultPath,
      filters: opts.filters ?? [],
    });
    if (res.canceled || !res.filePath) return null;
    if (typeof opts.content === 'string') {
      try {
        const buf =
          opts.encoding === 'base64'
            ? Buffer.from(opts.content, 'base64')
            : Buffer.from(opts.content, 'utf8');
        fs.writeFileSync(res.filePath, buf);
      } catch (err) {
        log.error('saveFile write failed', err);
        throw err;
      }
    }
    return res.filePath;
  });

  ipcMain.handle(IPC.showItemInFolder, (_e, fullPath: string) => {
    if (typeof fullPath === 'string' && fullPath) shell.showItemInFolder(fullPath);
  });

  // The renderer pairs itself as a normal device. In dev mode the server is
  // started outside the shell, so there is no handshake token and the user
  // pairs manually with the bootstrap code from the server log.
  ipcMain.handle(
    IPC.requestPairingCode,
    async (_e, deviceName?: unknown): Promise<DesktopPairingCode | null> => {
      if (mode === 'dev') return null;
      return sm.requestPairingCode(
        typeof deviceName === 'string' && deviceName.length > 0 ? deviceName : undefined,
      );
    },
  );

  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    wm.openExternalSafely(url);
  });

  // ── Window chrome ──────────────────────────────────────────────
  //
  // The renderer needs to know how much room the OS window controls occupy
  // so its header can reserve exactly that much — the inset differs by
  // platform (traffic lights left on macOS, min/max/close right elsewhere).
  ipcMain.handle(IPC.getWindowChrome, (): WindowChrome => windowChrome());

  ipcMain.handle(IPC.windowMaximizeToggle, () => wm.toggleMaximize());
  ipcMain.handle(IPC.windowIsMaximized, (): boolean => wm.isMaximized());

  // ── Menu state ─────────────────────────────────────────────────
  //
  // A native menu that never reflects the app is decoration. The renderer
  // pushes its UI state here so `View ▸ Toggle Sidebar` shows a real
  // checkmark, `Back` greys out, and `Open Recent` lists real routes.
  ipcMain.handle(IPC.setMenuState, (_e, patch: unknown) => {
    if (!patch || typeof patch !== 'object') return;
    const p = patch as Partial<MenuState>;
    const safe: Partial<MenuState> = {};
    if (typeof p.sidebarOpen === 'boolean') safe.sidebarOpen = p.sidebarOpen;
    if (typeof p.rightPaneOpen === 'boolean') safe.rightPaneOpen = p.rightPaneOpen;
    if (typeof p.canGoBack === 'boolean') safe.canGoBack = p.canGoBack;
    if (typeof p.canGoForward === 'boolean') safe.canGoForward = p.canGoForward;
    if (p.theme === 'light' || p.theme === 'dark' || p.theme === 'system') safe.theme = p.theme;
    if (Array.isArray(p.recent)) {
      // Bound and sanitise: this list is rendered into a native menu, and an
      // unbounded or malformed entry would corrupt it.
      safe.recent = p.recent
        .filter(
          (r): r is { label: string; route: string } =>
            Boolean(r) &&
            typeof (r as { label?: unknown }).label === 'string' &&
            typeof (r as { route?: unknown }).route === 'string',
        )
        .slice(0, 10)
        .map((r) => ({ label: r.label.slice(0, 80), route: r.route.slice(0, 300) }));
    }
    updateMenuState(safe);
  });

  ipcMain.handle(IPC.getTheme, (): ThemePreference => loadSettings().theme);

  ipcMain.handle(IPC.setTheme, (_e, theme: ThemePreference) => {
    if (theme !== 'light' && theme !== 'dark' && theme !== 'system') return;
    saveSettings({ theme });
    nativeTheme.themeSource = theme;
  });

  ipcMain.handle(IPC.getSetting, (_e, key: string) => {
    if (!SETTING_WHITELIST.has(key)) return undefined;
    return (loadSettings() as unknown as Record<string, unknown>)[key];
  });

  ipcMain.handle(IPC.setSetting, (_e, key: string, value: unknown) => {
    if (!SETTING_WHITELIST.has(key)) return;
    saveSettings({ [key]: value } as never);
  });

  ipcMain.handle(IPC.reload, () => wm.reload());
  ipcMain.handle(IPC.toggleDevtools, () => wm.toggleDevtools());

  // Push server status changes to the renderer (so a UI badge can react live).
  sm.on('status', (status) => {
    const win = wm.getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(IPC_EVENT.serverStatus, status);
  });

  // Propagate OS theme changes for any renderer that wants to follow them.
  nativeTheme.on('updated', () => {
    const win = wm.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_EVENT.themeChanged, nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
    }
    // The OS paints the Window Controls Overlay glyphs, so they do not inherit
    // our CSS. Without this repaint the close button stays dark-on-dark after
    // the system flips to dark mode.
    wm.refreshTitleBarTheme();
  });

  // ── Native Browser (feature-flagged; Phase 2) ──
  // Only wire the channels if the flag is on so a mis-typed invoke from an
  // older renderer receives a fast "unavailable" error rather than a dangling
  // handler. When off, `available` still resolves so the renderer can
  // detect the absence.
  const host = getNativeBrowserHost();
  ipcMain.handle(BROWSER_IPC.available, () => host.isEnabled());
  if (host.isEnabled()) {
    log.info('[ipc] Native desktop browser enabled (GENERATORAI_DESKTOP_NATIVE_BROWSER=1)');
    const mainWin = wm.getMainWindow();
    if (mainWin) host.attachOwnerWindow(mainWin);

    ipcMain.handle(BROWSER_IPC.create, (_e, tabId: string, workspaceId: string, active?: boolean) => {
      if (typeof tabId !== 'string' || !tabId) throw new Error('tabId required');
      if (typeof workspaceId !== 'string' || !workspaceId) throw new Error('workspaceId required');
      // Late attach — the window may not have existed when registerIpc ran.
      const win = wm.getMainWindow();
      if (win) host.attachOwnerWindow(win);
      return host.create(tabId, workspaceId, active === true);
    });
    ipcMain.handle(BROWSER_IPC.destroy, (_e, tabId: string) => {
      host.destroy(tabId);
    });
    ipcMain.handle(BROWSER_IPC.setActiveTab, (_e, workspaceId: string, tabId: string) => {
      if (typeof workspaceId !== 'string' || !workspaceId) return;
      if (typeof tabId !== 'string' || !tabId) return;
      host.setActiveTab(workspaceId, tabId);
    });
    ipcMain.handle(BROWSER_IPC.setBounds, (_e, tabId: string, bounds: BrowserBounds) => {
      if (!bounds || typeof bounds !== 'object') return;
      host.setBounds(tabId, bounds);
    });
    ipcMain.handle(BROWSER_IPC.setVisible, (_e, tabId: string, visible: boolean) => {
      host.setVisible(tabId, Boolean(visible));
    });
    ipcMain.handle(BROWSER_IPC.navigate, async (_e, tabId: string, url: string) => {
      if (typeof url !== 'string' || !url) throw new Error('url required');
      return host.navigate(tabId, url);
    });
    ipcMain.handle(BROWSER_IPC.back, (_e, tabId: string) => host.back(tabId));
    ipcMain.handle(BROWSER_IPC.forward, (_e, tabId: string) => host.forward(tabId));
    ipcMain.handle(BROWSER_IPC.reload, (_e, tabId: string) => host.reload(tabId));
    ipcMain.handle(BROWSER_IPC.screenshot, async (_e, tabId: string) => host.screenshot(tabId));
    ipcMain.handle(BROWSER_IPC.describe, (_e, tabId: string) => host.describe(tabId));
    ipcMain.handle(BROWSER_IPC.openDevtools, (_e, tabId: string, panel?: string) => {
      if (typeof tabId !== 'string' || !tabId) return;
      const allowed = new Set(['elements', 'network', 'console', 'sources']);
      host.openDevTools(tabId, typeof panel === 'string' && allowed.has(panel) ? panel : undefined);
    });
    ipcMain.handle(BROWSER_IPC.setEmulation, (_e, tabId: string, params: unknown) => {
      if (typeof tabId !== 'string' || !tabId) return;
      if (params == null) { host.setEmulation(tabId, null); return; }
      const p = params as { width?: unknown; height?: unknown; deviceScaleFactor?: unknown; mobile?: unknown };
      const width = Number(p.width);
      const height = Number(p.height);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
      host.setEmulation(tabId, {
        width,
        height,
        deviceScaleFactor: Number.isFinite(Number(p.deviceScaleFactor)) ? Number(p.deviceScaleFactor) : undefined,
        mobile: p.mobile === true,
      });
    });
    ipcMain.handle(BROWSER_IPC.setZoom, (_e, tabId: string, factor: unknown) => {
      if (typeof tabId !== 'string' || !tabId) return;
      const f = Number(factor);
      if (Number.isFinite(f)) host.setZoom(tabId, f);
    });
    ipcMain.handle(BROWSER_IPC.pickElement, async (_e, tabId: string) => {
      if (typeof tabId !== 'string' || !tabId) return null;
      return host.pickElement(tabId);
    });
    ipcMain.handle(BROWSER_IPC.captureRegion, async (_e, tabId: string) => {
      if (typeof tabId !== 'string' || !tabId) return null;
      return host.captureRegion(tabId);
    });
    ipcMain.handle(BROWSER_IPC.annotateStart, async (_e, tabId: string, theme?: string) => {
      if (typeof tabId === 'string' && tabId) await host.annotateStart(tabId, theme === 'light' ? 'light' : 'dark');
    });
    ipcMain.handle(BROWSER_IPC.annotateStop, async (_e, tabId: string) => {
      if (typeof tabId === 'string' && tabId) await host.annotateStop(tabId);
    });
    ipcMain.handle(BROWSER_IPC.annotatePoll, async (_e, tabId: string) => {
      if (typeof tabId !== 'string' || !tabId) return { total: 0, items: [] };
      return host.annotatePoll(tabId);
    });
    ipcMain.handle(BROWSER_IPC.annotateSend, async (_e, tabId: string, keys?: unknown) => {
      if (typeof tabId !== 'string' || !tabId) return [];
      const arr = Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : undefined;
      return host.annotateSend(tabId, arr);
    });
    ipcMain.handle(BROWSER_IPC.annotateRegion, async (_e, tabId: string) => {
      if (typeof tabId === 'string' && tabId) await host.annotateRegion(tabId);
    });
    ipcMain.handle(BROWSER_IPC.annotateRemove, async (_e, tabId: string, key: string) => {
      if (typeof tabId === 'string' && tabId && typeof key === 'string') await host.annotateRemove(tabId, key);
    });
    ipcMain.handle(BROWSER_IPC.annotateClear, async (_e, tabId: string) => {
      if (typeof tabId === 'string' && tabId) await host.annotateClear(tabId);
    });

    // Fan lifecycle events out to the renderer so the SPA URL bar / status
    // pill react without extra polling.
    const forward = (channel: string) => (evt: NativeBrowserEvent) => {
      const win = wm.getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send(channel, evt);
    };
    host.on('did-navigate', forward(BROWSER_IPC_EVENT.didNavigate));
    host.on('did-finish-load', forward(BROWSER_IPC_EVENT.didFinishLoad));
    host.on('did-fail-load', forward(BROWSER_IPC_EVENT.didFailLoad));
    host.on('title-updated', forward(BROWSER_IPC_EVENT.titleUpdated));
    host.on('favicon-updated', forward(BROWSER_IPC_EVENT.faviconUpdated));
    host.on('loading-changed', forward(BROWSER_IPC_EVENT.loadingChanged));
  }
}
