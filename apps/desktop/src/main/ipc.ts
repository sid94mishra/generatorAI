// ────────────────────────────────────────────────────────────────
// IPC handlers — the trusted boundary between the renderer (web app) and the
// main process. Every channel is explicitly registered and validated.
// ────────────────────────────────────────────────────────────────

import { findInPageOptions } from './find-options';
import { app, dialog, shell, nativeTheme, BrowserWindow } from 'electron';
import * as fs from 'node:fs';
import {
  IPC,
  IPC_EVENT,
  type AppInfo,
  type DesktopPairingCode,
  type DesktopServerEntry,
  type MenuState,
  type DesktopShellStatePush,
  type SaveFileOptions,
  type DesktopUpdateState,
} from '../shared/ipc';
import { BROWSER_IPC, BROWSER_IPC_EVENT, type BrowserBounds, type NativeBrowserEvent } from '../shared/browser-ipc';
import { getWindowManager } from './window-manager';
import { getServerManager } from './server-manager';
import { getNativeBrowserHost } from './browser-host';
import { sanitizeAnnotationPalette } from './annotation-palette';
import {
  connectionState,
  listServers,
  onServersChanged,
  promptForRemoteServer,
  switchServerById,
} from './backend-switcher';
import { resolvePaths } from './paths';
import { loadSettings, saveSettings } from './config';
import { applyMenuPush, updateMenuState } from './menu';
import { refreshTrayMenu } from './tray';
import { clearAttention, setAttention } from './attention-state';
import { probeKnownServers } from './server-probe';
import {
  clearUpdateWatchers,
  getUpdateState,
  installUpdateInteractive,
  onUpdateStateChange,
  setUpdateWatch,
} from './updater';
import { setUnsavedWork } from './unsaved-work';
import { log } from './logger';
import { createIpcGuard, defaultFromWebContents } from './ipc-guard';
import { admitPairingRequest, PairingGate } from './pairing-gate';
import { isRendererSettingKey, validateSettingValue } from './settings-schema';
import { commitAppearance } from './appearance';
import type { AttentionCounts, AttentionEntity } from '@generatorai/shared';

/** One gate per process: the limits are about THIS shell's lifetime. */
const pairingGate = new PairingGate();

const ATTENTION_ENTITIES: readonly AttentionEntity[] = ['chat', 'workflow_run', 'automation_execution'];

/** Non-negative integer, capped at 999 (06 §5.4) — this feeds native menu/tray text. */
function clampCount(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
  return Math.max(0, Math.min(999, n));
}

/**
 * Validates a renderer-pushed `attention` patch. `null` (no snapshot yet) and
 * a well-formed `AttentionCounts` both pass through; anything else is
 * dropped, same as the rest of `setMenuState`'s validation — the value ends
 * up in a native menu and the tray, both of which are attacker-adjacent if a
 * compromised page could inject arbitrary text into them.
 */
function sanitizeAttention(value: unknown): AttentionCounts | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== 'object') return undefined;
  const a = value as Partial<AttentionCounts>;
  if (!a.byEntity || typeof a.byEntity !== 'object') return undefined;
  const byEntity = {} as AttentionCounts['byEntity'];
  for (const entity of ATTENTION_ENTITIES) {
    const raw = (a.byEntity as Record<string, { needsYou?: unknown; running?: unknown } | undefined>)[entity];
    byEntity[entity] = { needsYou: clampCount(raw?.needsYou), running: clampCount(raw?.running) };
  }
  return { needsYou: clampCount(a.needsYou), running: clampCount(a.running), byEntity };
}

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

/** True when `frameUrl` is a page of the embedded server at `embeddedUrl`. */
export function isEmbeddedServerOrigin(frameUrl: string | undefined, embeddedUrl: string | null): boolean {
  if (!frameUrl || !embeddedUrl) return false;
  try {
    return new URL(frameUrl).origin === new URL(embeddedUrl).origin;
  } catch {
    return false;
  }
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
    // The renderer's `findNext` means "step"; Electron's means "new session" (find-options.ts).
    e.sender.findInPage(a.text, findInPageOptions(a));
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
    async (e, deviceName?: unknown): Promise<DesktopPairingCode | null> => {
      if (mode === 'dev') return null;
      // Only a page served by THIS shell's own server may pair itself with it.
      // Another machine's server shown in the window (remote mode, D-126) is
      // the main window's document too, and must never be able to mint an
      // all-scope grant for this computer.
      if (!isEmbeddedServerOrigin(e.senderFrame?.url, sm.url)) return null;
      const name = typeof deviceName === 'string' && deviceName.length > 0 ? deviceName.slice(0, 64) : undefined;
      await admitPairingRequest(name, { gate: pairingGate, confirm: confirmPairingNatively, log });
      return sm.requestPairingCode(name);
    },
  );

  guardedHandle(IPC.openExternal, (_e, url: string) => {
    wm.openExternalSafely(url);
  });

  // Window chrome is not a channel: it is static per process, so the main
  // window hands it to the preload as a launch argument (06 §3.6).

  guardedHandle(IPC.windowMaximizeToggle, () => wm.toggleMaximize());
  guardedHandle(IPC.windowIsMaximized, (): boolean => wm.isMaximized());

  // ── Menu state ─────────────────────────────────────────────────
  //
  // A native menu that never reflects the app is decoration. The renderer
  // pushes its UI state here so `View ▸ Toggle Sidebar` shows a real
  // checkmark, `Back` greys out, and `Open Recent` lists real routes.
  guardedHandle(IPC.setMenuState, (_e, patch: unknown) => {
    // The guard admits only the main window's current top-level document, and
    // a push proves its bridge listeners are up: routes can now go to it over
    // IPC_EVENT.navigate instead of a History-API injection (06 §3.4).
    wm.markRendererReady();
    if (!patch || typeof patch !== 'object') return;
    const p = patch as Partial<DesktopShellStatePush>;
    const safe: Partial<MenuState> = {};
    if (typeof p.sidebarOpen === 'boolean') safe.sidebarOpen = p.sidebarOpen;
    if (typeof p.rightPaneOpen === 'boolean') safe.rightPaneOpen = p.rightPaneOpen;
    // Not menu state — the shell's close/quit guard reads it (unsaved-work.ts).
    if (typeof p.hasUnsavedWork === 'boolean') setUnsavedWork(p.hasUnsavedWork);
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
    // Rebuilding the whole application menu can close a menu the user has
    // open (macOS), so only for pushes that change something it shows. The
    // renderer re-sends every field whenever the attention counts move, and
    // the counts are not in the menu (P1-review P2-R16).
    applyMenuPush(safe);
    // Only when this push actually carried attention data: G-05's badge and
    // tray text follow the D-36 feed, which is optional right up until the
    // renderer has a first snapshot.
    const attention = sanitizeAttention(p.attention);
    if (attention !== undefined) setAttention(attention);
  });

  // The page that pushed the counts and subscribed to updates is gone
  // (closed, crashed, reloaded, or moved to another server): its counts are
  // stale and its update listeners are dead (P1-review P2-R8, P2-R3).
  wm.onRendererReset(() => {
    clearAttention();
    clearUpdateWatchers();
  });

  // ── Appearance (D-25) ──────────────────────────────────────────
  //
  // The renderer is the only appearance writer; main mirrors each push
  // (persist, themeSource, window background, caption glyphs, menu radio).
  guardedHandle(IPC.setAppearance, (_e, payload: unknown) => {
    const result = commitAppearance(payload, {
      save: (appearance) => saveSettings({ appearance }),
      setThemeSource: (mode) => {
        nativeTheme.themeSource = mode;
      },
      repaint: () => wm.applyAppearance(),
      updateMenu: (mode) => updateMenuState({ mode }),
    });
    if (!result.ok) {
      log.warn('[ipc] rejected appearance push', { error: result.error });
      throw new Error(`Invalid appearance: ${result.error}`);
    }
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

  // ── Servers (G-03) ────────────────────────────────────────────
  //
  // The desktop is the source of truth for "which servers does this shell
  // know about" — `localStorage` is per-origin, so the renderer cannot hold
  // this list itself once it has navigated to a server's own origin. Main
  // also probes reachability: the renderer's CSP and CORS allow it to reach
  // only its own origin (P1-review P2-R6). Bounded by the probe timeout.
  guardedHandle(IPC.getServers, (): Promise<DesktopServerEntry[]> => probeKnownServers(listServers()));

  guardedHandle(IPC.switchServer, async (_e, id: unknown) => {
    if (typeof id !== 'string' || !id) return;
    await switchServerById(id);
  });

  guardedHandle(IPC.addServer, async () => {
    await promptForRemoteServer();
  });

  // Every switch, add or forget, wherever it came from (this IPC, the menu,
  // the tray): the renderer refetches, the Server submenu's radio and list are
  // rebuilt, and the tray's status lines follow the active server
  // (P1-review P2-R23).
  onServersChanged(() => {
    const win = wm.getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(IPC_EVENT.serversChanged);
    updateMenuState({});
    refreshTrayMenu();
  });

  // ── Updates (G-04) ─────────────────────────────────────────────
  guardedHandle(IPC.getUpdateState, (): DesktopUpdateState => getUpdateState());

  guardedHandle(IPC.installUpdate, async () => {
    // The "Restart to update" pill: a user request, so a failure gets the
    // error dialog; the pill also sees it in the state (`ready` + `error`).
    await installUpdateInteractive();
  });

  guardedHandle(IPC.watchUpdates, (e, watching: unknown) => {
    if (typeof watching !== 'boolean') return;
    setUpdateWatch(e.sender.id, watching);
  });

  onUpdateStateChange((state) => {
    const win = wm.getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(IPC_EVENT.updateStateChanged, state);
  });

  // Push server status changes to the renderer (so a UI badge can react live).
  sm.on('status', (status) => {
    const win = wm.getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(IPC_EVENT.serverStatus, status);
  });

  // An OS light/dark flip while the mode is `system`: the renderer re-resolves
  // through its own matchMedia listener; main repaints what the OS draws or
  // what shows before the renderer paints — the window background and the
  // Window Controls Overlay glyphs, which do not inherit our CSS (without this
  // the close button stays dark-on-dark after the system flips to dark).
  nativeTheme.on('updated', () => wm.applyAppearance());

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
    // Overlay palettes are interpolated into scripts run in third-party pages:
    // validate every value here, before anything reaches executeJavaScript;
    // an invalid or missing palette becomes the default one (06 §4.4).
    guardedHandle(BROWSER_IPC.pickElement, async (_e, tabId: string, palette?: unknown) => {
      if (typeof tabId !== 'string' || !tabId) return null;
      return host.pickElement(tabId, sanitizeAnnotationPalette(palette));
    });
    guardedHandle(BROWSER_IPC.captureRegion, async (_e, tabId: string, palette?: unknown) => {
      if (typeof tabId !== 'string' || !tabId) return null;
      return host.captureRegion(tabId, sanitizeAnnotationPalette(palette));
    });
    guardedHandle(BROWSER_IPC.annotateStart, async (_e, tabId: string, palette?: unknown) => {
      if (typeof tabId === 'string' && tabId) await host.annotateStart(tabId, sanitizeAnnotationPalette(palette));
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
