// ────────────────────────────────────────────────────────────────
// WindowManager — owns the splash window, the main window (which hosts the
// GeneratorAI web UI served by the embedded server), the error screen, window
// state persistence, and safe navigation helpers.
// ────────────────────────────────────────────────────────────────

import { BrowserWindow, shell, nativeTheme, screen } from 'electron';
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

const RESOURCES = path.join(__dirname, '..', '..', 'resources');
const PRELOAD = path.join(__dirname, '..', 'preload', 'index.js');

export class WindowManager {
  private mainWindow: BrowserWindow | null = null;
  private splashWindow: BrowserWindow | null = null;
  private appUrl: string | null = null;

  getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
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

  createMainWindow(appUrl: string): BrowserWindow {
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
    // everything else. Both the request handler (permission prompt path)
    // and the check handler (pre-check path) are required. This is scoped
    // to the main window's session; the native browser views use separate
    // per-workspace partitions and are unaffected.
    const ses = win.webContents.session;
    const isAppOrigin = (url: string | null | undefined): boolean => {
      if (!url) return true; // Electron internal / null origin from the app frame.
      if (!this.appUrl) return false;
      try {
        return new URL(url).origin === new URL(this.appUrl).origin;
      } catch {
        return false;
      }
    };
    ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
      if (permission === 'media') {
        const d = details as { securityOrigin?: string; requestingUrl?: string };
        callback(isAppOrigin(d.securityOrigin ?? d.requestingUrl));
        return;
      }
      callback(false);
    });
    ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
      if (permission === 'media') return isAppOrigin(requestingOrigin);
      return false;
    });

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

    win.on('closed', () => {
      this.mainWindow = null;
    });

    // Security: open external links in the OS browser, never new Electron windows.
    win.webContents.setWindowOpenHandler(({ url }) => {
      this.openExternalSafely(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, url) => {
      if (this.appUrl && !url.startsWith(this.appUrl)) {
        event.preventDefault();
        this.openExternalSafely(url);
      }
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

  showError(message: string): void {
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

  openExternalSafely(url: string): void {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:') {
        void shell.openExternal(url);
      }
    } catch {
      /* ignore malformed URLs */
    }
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
