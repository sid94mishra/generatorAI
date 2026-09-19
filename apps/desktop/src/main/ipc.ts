// ────────────────────────────────────────────────────────────────
// IPC handlers — the trusted boundary between the renderer (web app) and the
// main process. Every channel is explicitly registered and validated.
// ────────────────────────────────────────────────────────────────

import { app, dialog, shell, nativeTheme, BrowserWindow } from 'electron';
import * as fs from 'node:fs';
import {
  IPC,
  IPC_EVENT,
  type AppInfo,
  type DesktopPairingCode,
  type MenuState,
  type ShellState,
  type SaveFileOptions,
  type ThemePreference,
  type WindowChrome,
} from '../shared/ipc';
import { BROWSER_IPC, BROWSER_IPC_EVENT, type BrowserBounds, type NativeBrowserEvent } from '../shared/browser-ipc';
import { getWindowManager } from './window-manager';
import { getServerManager } from './server-manager';
import { getNativeBrowserHost } from './browser-host';
import { connectionState } from './backend-switcher';
import { resolvePaths } from './paths';
import { loadSettings, saveSettings } from './config';
import { windowChrome } from './platform';
import { updateMenuState } from './menu';
import { setUnsavedWork } from './unsaved-work';
import { log } from './logger';
import { createIpcGuard, defaultFromWebContents } from './ipc-guard';
import { admitPairingRequest, PairingGate } from './pairing-gate';
import { isRendererSettingKey, validateSettingValue } from './settings-schema';

/** One gate per process: the limits are about THIS shell's lifetime. */
const pairingGate = new PairingGate();

/**
 * Native confirmation for every pairing mint after the first. Drawn by the OS,
 * modal to the main window, and impossible for page content to dismiss.
 */
async function confirmPairingNatively(deviceName: string | undefined): Promise<boolean> {
  const win = getWindowManager().getMainWindow();
  const opts = {
    type: 'question' as const,
    buttons: ['Pair', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: 'Pair this window?',
    message: 'GeneratorAI is asking to pair the desktop window again.',
    detail:
      `A new pairing code grants "${deviceName ?? 'GeneratorAI Desktop'}" full access to this server. ` +
      'The window normally pairs once at launch — if you did not just sign out or reset pairing, choose Cancel.',
  };
  const { response } = win && !win.isDestroyed()
    ? await dialog.showMessageBox(win, opts)
    : await dialog.showMessageBox(opts);
  return response === 0;
}

export function registerIpc(mode: 'dev' | 'standalone'): void {
  const wm = getWindowManager();
  const sm = getServerManager();
  const paths = resolvePaths();

  // Every channel below goes through the sender guard: only the main window's
  // top frame, on the app origin, may call in. Browser-tab WebContentsViews,
  // popups and iframes are refused and logged. See ipc-guard.ts.
  const { guardedHandle } = createIpcGuard({
    getMainWindow: () => wm.getMainWindow(),
    getAppUrl: () => wm.getAppUrl(),
    fromWebContents: defaultFromWebContents,
    log,
  });

  guardedHandle(IPC.getAppInfo, (): AppInfo => {
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

  guardedHandle(IPC.getServerStatus, () => sm.getStatus());

  guardedHandle(IPC.restartServer, async () => {
    if (mode === 'dev') return; // external dev server is not managed here
    await sm.restart();
  });

  guardedHandle(IPC.selectDirectory, async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow() ?? wm.getMainWindow() ?? undefined;
    const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0] ?? null;
  });

  guardedHandle(
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

  guardedHandle(IPC.saveFile, async (_e, opts: SaveFileOptions): Promise<string | null> => {
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

  // Returns whether anything was revealed. A path that exists only on a remote
  // server means nothing on this machine, and `shell.showItemInFolder` fails
  // silently there — the caller needs to be able to say so.
  // ── Find in page ───────────────────────────────────────────────
  //
  // Chromium does the searching: it is the only thing that can match text the
  // DOM cannot be walked for (virtualised rows, canvas-rendered terminal
  // output, nested frames), and it owns the highlight rendering. The renderer
  // draws the bar and reports the query here.
  guardedHandle(IPC.findInPage, (e, arg: unknown): void => {
    const a = (arg ?? {}) as { text?: unknown; forward?: unknown; findNext?: unknown };
    if (typeof a.text !== 'string' || a.text.length === 0) return;
    // `findNext` is OMITTED rather than set to false for a new search.
    // Electron 42 answers a request carrying an explicit `findNext: false`
    // without ever emitting `found-in-page`, so the bar showed no match count
    // at all; leaving the key out takes the same code path as the documented
    // default and reports normally.
    const options: Electron.FindInPageOptions = { forward: a.forward !== false };
    if (a.findNext === true) options.findNext = true;
    e.sender.findInPage(a.text, options);
  });

  guardedHandle(IPC.stopFindInPage, (e): void => {
    e.sender.stopFindInPage('clearSelection');
  });

  guardedHandle(IPC.showItemInFolder, (_e, fullPath: string): boolean => {
    if (typeof fullPath !== 'string' || !fullPath) return false;
    if (!fs.existsSync(fullPath)) return false;
    shell.showItemInFolder(fullPath);
    return true;
  });

  // The renderer pairs itself as a normal device. In dev mode the server is
  // started outside the shell, so there is no handshake token and the user
  // pairs manually with the bootstrap code from the server log.
  //
  // The grant carries every scope, so beyond the sender guard this channel is
  // rate-limited per process and — after the first, launch-time auto-pair —
  // needs a native confirmation. A refusal rejects the invoke with a message
  // the renderer shows on its manual pairing screen.
  guardedHandle(
    IPC.requestPairingCode,
    async (_e, deviceName?: unknown): Promise<DesktopPairingCode | null> => {
      if (mode === 'dev') return null;
      const name = typeof deviceName === 'string' && deviceName.length > 0 ? deviceName.slice(0, 64) : undefined;
      await admitPairingRequest(name, { gate: pairingGate, confirm: confirmPairingNatively, log });
      return sm.requestPairingCode(name);
    },
  );

  guardedHandle(IPC.openExternal, (_e, url: string) => {
    wm.openExternalSafely(url);
  });

  // ── Window chrome ──────────────────────────────────────────────
  //
  // The renderer needs to know how much room the OS window controls occupy
  // so its header can reserve exactly that much — the inset differs by
  // platform (traffic lights left on macOS, min/max/close right elsewhere).
  guardedHandle(IPC.getWindowChrome, (): WindowChrome => windowChrome());

  guardedHandle(IPC.windowMaximizeToggle, () => wm.toggleMaximize());
  guardedHandle(IPC.windowIsMaximized, (): boolean => wm.isMaximized());

  // ── Menu state ─────────────────────────────────────────────────
  //
  // A native menu that never reflects the app is decoration. The renderer
  // pushes its UI state here so `View ▸ Toggle Sidebar` shows a real
  // checkmark, `Back` greys out, and `Open Recent` lists real routes.
  guardedHandle(IPC.setMenuState, (_e, patch: unknown) => {
    if (!patch || typeof patch !== 'object') return;
    const p = patch as Partial<ShellState>;
    const safe: Partial<MenuState> = {};
    if (typeof p.sidebarOpen === 'boolean') safe.sidebarOpen = p.sidebarOpen;
    if (typeof p.rightPaneOpen === 'boolean') safe.rightPaneOpen = p.rightPaneOpen;
    // Not menu state — the shell's close/quit guard reads it (unsaved-work.ts).
    if (typeof p.hasUnsavedWork === 'boolean') setUnsavedWork(p.hasUnsavedWork);
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

  guardedHandle(IPC.getTheme, (): ThemePreference => loadSettings().theme);

  guardedHandle(IPC.setTheme, (_e, theme: ThemePreference) => {
    if (theme !== 'light' && theme !== 'dark' && theme !== 'system') return;
    saveSettings({ theme });
    nativeTheme.themeSource = theme;
  });

  guardedHandle(IPC.getSetting, (_e, key: unknown) => {
    if (!isRendererSettingKey(key)) return undefined;
    return (loadSettings() as unknown as Record<string, unknown>)[key];
  });

  // Key AND value are validated. A bad value is refused loudly (the renderer's
  // invoke rejects with the reason) instead of being written to disk and fed
  // to the server on the next launch.
  guardedHandle(IPC.setSetting, (_e, key: unknown, value: unknown) => {
    if (!isRendererSettingKey(key)) throw new Error(`Unknown setting '${String(key)}'`);
    const checked = validateSettingValue(key, value);
    if (!checked.ok) {
      log.warn('[ipc] rejected setting write', { key, error: checked.error });
      throw new Error(`Invalid value for ${checked.error}`);
    }
    saveSettings({ [key]: checked.value } as Partial<ReturnType<typeof loadSettings>>);
  });

  guardedHandle(IPC.reload, () => wm.reload());
  guardedHandle(IPC.toggleDevtools, () => wm.toggleDevtools());

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
  // The native browser is a WebContentsView on THIS machine, driven over a
  // loopback CDP endpoint pushed into the embedded server. A remote server
  // cannot reach that endpoint, so while the shell is pointed elsewhere the
  // renderer must be told native is unavailable and fall back to the
  // server-hosted browser — which is the right place for it anyway, since
  // that is where the workspace lives.
  guardedHandle(
    BROWSER_IPC.available,
    () => host.isEnabled() && connectionState().serverMode === 'embedded',
  );
  if (host.isEnabled()) {
    log.info('[ipc] Native desktop browser enabled (GENERATORAI_DESKTOP_NATIVE_BROWSER=1)');
    const mainWin = wm.getMainWindow();
    if (mainWin) host.attachOwnerWindow(mainWin);

    guardedHandle(BROWSER_IPC.create, (_e, tabId: string, workspaceId: string, active?: boolean) => {
      if (typeof tabId !== 'string' || !tabId) throw new Error('tabId required');
      if (typeof workspaceId !== 'string' || !workspaceId) throw new Error('workspaceId required');
      // Late attach — the window may not have existed when registerIpc ran.
      const win = wm.getMainWindow();
      if (win) host.attachOwnerWindow(win);
      return host.create(tabId, workspaceId, active === true);
    });
    guardedHandle(BROWSER_IPC.destroy, (_e, tabId: string) => {
      host.destroy(tabId);
    });
    guardedHandle(BROWSER_IPC.setActiveTab, (_e, workspaceId: string, tabId: string) => {
      if (typeof workspaceId !== 'string' || !workspaceId) return;
      if (typeof tabId !== 'string' || !tabId) return;
      host.setActiveTab(workspaceId, tabId);
    });
    guardedHandle(BROWSER_IPC.setBounds, (_e, tabId: string, bounds: BrowserBounds) => {
      if (!bounds || typeof bounds !== 'object') return;
      host.setBounds(tabId, bounds);
    });
    guardedHandle(BROWSER_IPC.setVisible, (_e, tabId: string, visible: boolean) => {
      host.setVisible(tabId, Boolean(visible));
    });
    guardedHandle(BROWSER_IPC.navigate, async (_e, tabId: string, url: string) => {
      if (typeof url !== 'string' || !url) throw new Error('url required');
      return host.navigate(tabId, url);
    });
    guardedHandle(BROWSER_IPC.back, (_e, tabId: string) => host.back(tabId));
    guardedHandle(BROWSER_IPC.forward, (_e, tabId: string) => host.forward(tabId));
    guardedHandle(BROWSER_IPC.reload, (_e, tabId: string) => host.reload(tabId));
    guardedHandle(BROWSER_IPC.screenshot, async (_e, tabId: string) => host.screenshot(tabId));
    guardedHandle(BROWSER_IPC.describe, (_e, tabId: string) => host.describe(tabId));
    guardedHandle(BROWSER_IPC.openDevtools, (_e, tabId: string, panel?: string) => {
      if (typeof tabId !== 'string' || !tabId) return;
      const allowed = new Set(['elements', 'network', 'console', 'sources']);
      host.openDevTools(tabId, typeof panel === 'string' && allowed.has(panel) ? panel : undefined);
    });
    guardedHandle(BROWSER_IPC.setEmulation, (_e, tabId: string, params: unknown) => {
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
    guardedHandle(BROWSER_IPC.setZoom, (_e, tabId: string, factor: unknown) => {
      if (typeof tabId !== 'string' || !tabId) return;
      const f = Number(factor);
      if (Number.isFinite(f)) host.setZoom(tabId, f);
    });
    guardedHandle(BROWSER_IPC.pickElement, async (_e, tabId: string) => {
      if (typeof tabId !== 'string' || !tabId) return null;
      return host.pickElement(tabId);
    });
    guardedHandle(BROWSER_IPC.captureRegion, async (_e, tabId: string) => {
      if (typeof tabId !== 'string' || !tabId) return null;
      return host.captureRegion(tabId);
    });
    guardedHandle(BROWSER_IPC.annotateStart, async (_e, tabId: string, theme?: string) => {
      if (typeof tabId === 'string' && tabId) await host.annotateStart(tabId, theme === 'light' ? 'light' : 'dark');
    });
    guardedHandle(BROWSER_IPC.annotateStop, async (_e, tabId: string) => {
      if (typeof tabId === 'string' && tabId) await host.annotateStop(tabId);
    });
    guardedHandle(BROWSER_IPC.annotatePoll, async (_e, tabId: string) => {
      if (typeof tabId !== 'string' || !tabId) return { total: 0, items: [] };
      return host.annotatePoll(tabId);
    });
    guardedHandle(BROWSER_IPC.annotateSend, async (_e, tabId: string, keys?: unknown) => {
      if (typeof tabId !== 'string' || !tabId) return [];
      const arr = Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : undefined;
      return host.annotateSend(tabId, arr);
    });
    guardedHandle(BROWSER_IPC.annotateRegion, async (_e, tabId: string) => {
      if (typeof tabId === 'string' && tabId) await host.annotateRegion(tabId);
    });
    guardedHandle(BROWSER_IPC.annotateRemove, async (_e, tabId: string, key: string) => {
      if (typeof tabId === 'string' && tabId && typeof key === 'string') await host.annotateRemove(tabId, key);
    });
    guardedHandle(BROWSER_IPC.annotateClear, async (_e, tabId: string) => {
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
