// ────────────────────────────────────────────────────────────────
// WindowManager — owns the splash window, the main window (which hosts the
// GeneratorAI web UI served by the embedded server), the error screen, window
// state persistence, and safe navigation helpers.
// ────────────────────────────────────────────────────────────────

import { BrowserWindow, dialog, shell, nativeTheme, screen, type MessageBoxOptions } from 'electron';
import * as path from 'node:path';
import { log } from './logger';
import { loadSettings, saveSettings } from './config';
import {
  isMac,
  isWayland,
  titleBarOptions,
  titleBarSymbolColor,
  TITLE_BAR_HEIGHT,
  useCustomTitleBar,
} from './platform';
import type { DesktopCommand } from '../shared/ipc';
import { IPC_EVENT } from '../shared/ipc';
import { appRouteOf, isAppOrigin, isExternalUrlAllowed } from './navigation-guard';
import { hasUnsavedWork } from './unsaved-work';
import { appWindowPermissionPolicy, installCspFloor, installPermissionPolicy } from './session-hardening';

const RESOURCES = path.join(__dirname, '..', '..', 'resources');
const PRELOAD = path.join(__dirname, '..', 'preload', 'index.js');

export interface CreateMainWindowOptions {
  /**
   * Add the server-mirroring CSP to documents that arrive without one. On by
   * default; `index.ts` turns it off in dev mode, where the Vite server's
   * responses have no CSP and need inline HMR scripts.
   */
  cspFloor?: boolean;
}

/** Whether a native close click should hide to the tray instead. */
export function shouldHideOnClose(state: { minimizeToTray: boolean; quitting: boolean }): boolean {
  return state.minimizeToTray && !state.quitting;
}

export class WindowManager {
  private mainWindow: BrowserWindow | null = null;
  private splashWindow: BrowserWindow | null = null;
  private appUrl: string | null = null;
  private quitting = false;
  /** Set once the user has agreed to lose unsaved work, so the retried close
   *  does not ask again. */
  private discardConfirmed = false;

  getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  /** The URL the main window is meant to be showing. */
  getAppUrl(): string | null {
    return this.appUrl;
  }

  /**
   * Once the app is quitting, `close` must actually close: the tray "hide
   * instead of close" interception would otherwise keep the window alive and
   * the quit would never finish.
   */
  setQuitting(value: boolean): void {
    this.quitting = value;
  }

  private backgroundColor(): string {
    const theme = loadSettings().theme;
    const dark = theme === 'system' ? nativeTheme.shouldUseDarkColors : theme === 'dark';
    return dark ? '#0d1117' : '#ffffff';
  }

  showSplash(): void {
    if (this.splashWindow) return;
    this.splashWindow = new BrowserWindow({
      width: 460,
      height: 320,
      frame: false,
      resizable: false,
      movable: true,
      show: true,
      center: true,
      backgroundColor: this.backgroundColor(),
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    this.splashWindow.loadFile(path.join(RESOURCES, 'splash.html')).catch((e) => {
      log.warn('Failed to load splash', e);
    });
    this.splashWindow.on('closed', () => {
      this.splashWindow = null;
    });
  }

  private closeSplash(): void {
    if (this.splashWindow && !this.splashWindow.isDestroyed()) {
      this.splashWindow.close();
    }
    this.splashWindow = null;
  }

  createMainWindow(appUrl: string, options: CreateMainWindowOptions = {}): BrowserWindow {
    this.appUrl = appUrl;
    const settings = loadSettings();
    const bounds = this.sanitizeBounds(settings.window);

    const win = new BrowserWindow({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      // 860 keeps the app usable side-by-side on a 13" laptop. The web layout
      // collapses the sidebar below this, so a smaller floor would only
      // produce a broken-looking window rather than a useful one.
      minWidth: 860,
      minHeight: 560,
      show: false,
      backgroundColor: this.backgroundColor(),
      title: 'GeneratorAI',
      icon: this.iconPath(),
      // The menu bar is a second stacked strip on Windows/Linux. Once we draw
      // our own title bar it is redundant chrome, so it auto-hides behind Alt
      // exactly as users of VS Code and other modern apps expect.
      autoHideMenuBar: useCustomTitleBar() && !isMac,
      // Per-platform frame: `hiddenInset` on macOS, Window Controls Overlay on
      // Windows, native frame on Linux unless opted in. See platform.ts.
      ...titleBarOptions(),
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: true,
      },
    });
    this.mainWindow = win;

    // Microphone permission for voice input (getUserMedia). The app is
    // loopback-only, so grant `media` (audio) to our own origin and deny
    // everything else — see `session-hardening.ts`. Scoped to the main
    // window's session; the native browser tabs get their own (deny-all)
    // policy in `browser-host.ts`. The CSP floor covers any document this
    // session renders that did not bring its own policy.
    const ses = win.webContents.session;
    installPermissionPolicy(ses, appWindowPermissionPolicy(() => this.appUrl));
    if (options.cspFloor !== false) installCspFloor(ses);

    if (settings.window.maximized) win.maximize();

    win.once('ready-to-show', () => {
      this.closeSplash();
      win.show();
      win.focus();
    });

    // Persist window geometry. Skipped on Wayland, which forbids apps from
    // reading or setting their own position — storing zeros would make the
    // window jump to a corner on the next launch under X11.
    if (!isWayland) {
      const persist = () => this.persistBounds(win);
      win.on('resize', debounce(persist, 400));
      win.on('move', debounce(persist, 400));
    }
    win.on('maximize', () => {
      saveSettings({ window: { ...loadSettings().window, maximized: true } });
      this.emitWindowState(win);
    });
    win.on('unmaximize', () => {
      saveSettings({ window: { ...loadSettings().window, maximized: false } });
      this.emitWindowState(win);
    });
    win.on('enter-full-screen', () => this.emitWindowState(win));
    win.on('leave-full-screen', () => this.emitWindowState(win));
    win.on('focus', () => this.emitWindowState(win));
    win.on('blur', () => this.emitWindowState(win));

    // Minimise-to-tray: a native close click hides the window instead of
    // destroying it, so the tray's "Open GeneratorAI" has something to show.
    // Quitting (menu, tray, Cmd+Q) sets `quitting` first and closes for real.
    win.on('close', (event) => {
      if (shouldHideOnClose({ minimizeToTray: loadSettings().minimizeToTray, quitting: this.quitting })) {
        event.preventDefault();
        win.hide();
        return;
      }
      // Closing for real. The renderer's in-app navigation guard cannot see
      // this, so unsaved edits used to disappear without a word.
      if (this.discardConfirmed || !hasUnsavedWork()) return;
      event.preventDefault();
      void this.confirmDiscard(win).then((discard) => {
        if (!discard) return;
        this.discardConfirmed = true;
        win.close();
      });
    });

    win.on('closed', () => {
      this.mainWindow = null;
    });

    // Security: open external links in the OS browser, never new Electron windows.
    win.webContents.setWindowOpenHandler(({ url }) => {
      // An app-origin popup is a link the user asked to open in a "new tab" —
      // a Cmd/middle click, or `window.open` on an in-app route. Handing it to
      // `shell.openExternal` launched the user's *browser* on the loopback
      // server: the same app, outside the shell, without the desktop bridge.
      // There is one window, so open it here instead.
      if (isAppOrigin(url, this.appUrl)) {
        // An app ROUTE is opened the way every other in-app navigation is: as
        // a route change inside the running page. `loadURL` reached the same
        // screen by throwing the whole app away — open streams, unsent text,
        // and every React cleanup, which is what left a native browser view
        // stranded on screen (see `NativeBrowserHost.attachOwnerWindow`).
        // Server resources (`/api/…`) are not routes, so they still load.
        const route = appRouteOf(url);
        if (route) this.navigateTo(route);
        else win.webContents.loadURL(url).catch((e) => log.warn('In-app popup navigation failed', e));
        return { action: 'deny' };
      }
      this.openExternalSafely(url);
      return { action: 'deny' };
    });
    // Same-window navigation stays on the app origin. Parsed-origin
    // comparison, strict on empty/unparseable — `url.startsWith(appUrl)` let
    // `http://127.0.0.1:3100@evil.com` through. Anything else is handed to
    // the OS browser (which itself only opens http/https/mailto).
    win.webContents.on('will-navigate', (event, url) => {
      if (!isAppOrigin(url, this.appUrl)) {
        event.preventDefault();
        this.openExternalSafely(url);
      }
    });

    // Chromium reports match counts asynchronously; the find bar needs them to
    // show "3 of 12" and to grey out its arrows.
    win.webContents.on('found-in-page', (_e, result) => {
      win.webContents.send(IPC_EVENT.foundInPage, {
        activeMatchOrdinal: result.activeMatchOrdinal,
        matches: result.matches,
      });
    });

    win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      // -3 == ERR_ABORTED (benign, e.g. SPA in-place nav)
      if (errorCode === -3) return;
      log.error('Main frame failed to load', { errorCode, errorDescription, validatedURL });
      this.showError(`${errorDescription} (${errorCode})`);
    });

    // Install the native directory-picker shim into the page (main world).
    win.webContents.on('did-finish-load', () => {
      win.webContents
        .executeJavaScript(
          `(() => { try {
             const np = window.__generatoraiNativePickers;
             if (np && typeof np.showDirectoryPicker === 'function') {
               window.showDirectoryPicker = np.showDirectoryPicker;
             }
           } catch (e) { /* ignore */ } })();`,
        )
        .catch(() => undefined);
    });

    log.info('Loading app URL', { appUrl });
    win.loadURL(appUrl).catch((e) => {
      log.error('loadURL failed', e);
      this.showError(String(e));
    });

    return win;
  }

  /**
   * Points the main window at a different server URL.
   *
   * Used after "Restart Server" (the embedded server may come back on a new
   * port) and when switching between the embedded and a remote backend. Both
   * used to leave the renderer on the old, now-dead origin — every request and
   * the SSE stream failed until the user quit. `loadURL` rather than a state
   * swap is deliberate: changing origin makes the browser discard every store,
   * cache and open stream from the previous server.
   */
  repointMainWindow(url: string): void {
    this.appUrl = url;
    const win = this.mainWindow;
    if (!win || win.isDestroyed()) {
      this.createMainWindow(url);
      return;
    }
    log.info('Repointing main window', { url });
    win.loadURL(url).catch((err: unknown) => {
      log.error('Failed to load backend', err);
      this.showError(`Could not load ${url}.\n\n${err instanceof Error ? err.message : String(err)}`);
    });
    if (!win.isVisible()) win.show();
    win.focus();
  }

  /** Brings the window back from the tray / minimised state. */
  restoreFromTray(): void {
    const win = this.mainWindow;
    if (!win || win.isDestroyed()) {
      if (this.appUrl) this.createMainWindow(this.appUrl);
      return;
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  showError(message: string): void {
    // Never during shutdown. Creating and showing a window while the app is
    // quitting prevents it from ever exiting: `app.exit(0)` is reached and
    // logged, and the process stays alive anyway, holding the database and the
    // listening port until it is killed from the task manager.
    //
    // It is easy to reach. Close the app while the embedded server is still
    // starting — a perfectly ordinary thing to do, since startup takes several
    // seconds — and stopping the server makes the in-flight `start()` reject,
    // whose handler reports the failure by opening a window. The server did not
    // really fail; we shut it down. Every caller of this is some flavour of
    // "something went wrong", and once the app is on its way out, none of them
    // has anything useful to say to a user who is already leaving.
    if (this.quitting) {
      log.info('Suppressed error window during shutdown', { message });
      return;
    }
    this.closeSplash();
    const target = this.mainWindow ?? this.createBareWindow();
    const url = `file://${path.join(RESOURCES, 'error.html')}?message=${encodeURIComponent(message)}`;
    target.loadURL(url).catch((e) => log.error('Failed to load error page', e));
    if (!target.isVisible()) target.show();
  }

  private createBareWindow(): BrowserWindow {
    const win = new BrowserWindow({
      width: 720,
      height: 480,
      backgroundColor: this.backgroundColor(),
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    this.mainWindow = win;
    win.on('closed', () => {
      this.mainWindow = null;
    });
    return win;
  }

  /** Navigate the SPA via the History API without a full reload. */
  navigateTo(routePath: string): void {
    const win = this.mainWindow;
    if (!win || win.isDestroyed()) return;
    const safe = JSON.stringify(routePath);
    win.webContents
      .executeJavaScript(
        `(() => { try {
           window.history.pushState({}, '', ${safe});
           window.dispatchEvent(new PopStateEvent('popstate'));
         } catch (e) { window.location.assign(${safe}); } })();`,
      )
      .catch(() => undefined);
    win.show();
    win.focus();
  }

  sendCommand(command: DesktopCommand): void {
    this.mainWindow?.webContents.send(IPC_EVENT.command, command);
  }

  /**
   * Tells the renderer about maximize/fullscreen/focus changes.
   *
   * A custom title bar has to restyle itself for these — a maximised window
   * loses its rounded corners and drop shadow, and an unfocused one dims its
   * controls. Without this the bar would look identical in every state.
   */
  private emitWindowState(win: BrowserWindow): void {
    if (win.isDestroyed()) return;
    win.webContents.send(IPC_EVENT.windowStateChanged, {
      maximized: win.isMaximized(),
      fullScreen: win.isFullScreen(),
      focused: win.isFocused(),
    });
  }

  /** Re-emits current window state. Used when the renderer (re)connects. */
  publishWindowState(): void {
    const win = this.mainWindow;
    if (win && !win.isDestroyed()) this.emitWindowState(win);
  }

  toggleMaximize(): void {
    const win = this.mainWindow;
    if (!win || win.isDestroyed()) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  }

  isMaximized(): boolean {
    const win = this.mainWindow;
    return Boolean(win && !win.isDestroyed() && win.isMaximized());
  }

  /**
   * Repaints the Window Controls Overlay for the current theme.
   *
   * The OS draws those glyphs, so they do not inherit our CSS. Without this
   * the close button stays dark-on-dark after switching to dark mode.
   */
  refreshTitleBarTheme(): void {
    const win = this.mainWindow;
    if (!win || win.isDestroyed() || isMac || !useCustomTitleBar()) return;
    try {
      win.setTitleBarOverlay({
        color: '#00000000',
        symbolColor: titleBarSymbolColor(),
        height: TITLE_BAR_HEIGHT,
      });
    } catch {
      // Not supported by this window manager — the native frame still works.
    }
  }

  reload(): void {
    this.mainWindow?.webContents.reload();
  }

  toggleDevtools(): void {
    const wc = this.mainWindow?.webContents;
    if (!wc) return;
    if (wc.isDevToolsOpened()) wc.closeDevTools();
    else wc.openDevTools({ mode: 'detach' });
  }

  /**
   * Asks before throwing away unsaved work. Shared by the window's close
   * button and the quit path, and answered once — a second close after the
   * user said "Discard" must not re-ask.
   */
  async confirmDiscard(win?: BrowserWindow): Promise<boolean> {
    if (this.discardConfirmed || !hasUnsavedWork()) return true;
    const target = win ?? this.mainWindow ?? undefined;
    const opts: MessageBoxOptions = {
      type: 'warning',
      buttons: ['Discard changes', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Unsaved changes',
      message: 'You have unsaved changes',
      detail: 'Closing now discards them. Save first to keep your work.',
    };
    const { response } = target
      ? await dialog.showMessageBox(target, opts)
      : await dialog.showMessageBox(opts);
    if (response === 0) this.discardConfirmed = true;
    return response === 0;
  }

  /** Tells the renderer which appearance the user picked natively. */
  sendThemePreference(theme: 'light' | 'dark' | 'system'): void {
    const win = this.mainWindow;
    if (win && !win.isDestroyed()) win.webContents.send(IPC_EVENT.themePreferenceChanged, theme);
  }

  openExternalSafely(url: string): void {
    if (isExternalUrlAllowed(url)) void shell.openExternal(url);
  }

  private iconPath(): string | undefined {
    const file =
      process.platform === 'win32'
        ? 'icon.ico'
        : process.platform === 'darwin'
          ? 'icon.icns'
          : 'icon.png';
    const p = path.join(RESOURCES, file);
    return p;
  }

  private persistBounds(win: BrowserWindow): void {
    if (win.isDestroyed() || win.isMinimized() || win.isMaximized()) return;
    const b = win.getBounds();
    saveSettings({ window: { ...loadSettings().window, width: b.width, height: b.height, x: b.x, y: b.y } });
  }

  /** Keep restored windows on a currently-attached display. */
  private sanitizeBounds(state: { width: number; height: number; x?: number; y?: number }) {
    const { width, height } = state;
    let { x, y } = state;
    if (x !== undefined && y !== undefined) {
      const displays = screen.getAllDisplays();
      const visible = displays.some((d) => {
        const wa = d.workArea;
        return x! >= wa.x - 50 && y! >= wa.y - 50 && x! < wa.x + wa.width && y! < wa.y + wa.height;
      });
      if (!visible) {
        x = undefined;
        y = undefined;
      }
    }
    return { width: Math.max(940, width), height: Math.max(600, height), x, y };
  }
}

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let t: NodeJS.Timeout | null = null;
  return ((...args: never[]) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T;
}

let instance: WindowManager | null = null;
export function getWindowManager(): WindowManager {
  if (!instance) instance = new WindowManager();
  return instance;
}
