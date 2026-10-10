// ────────────────────────────────────────────────────────────────
// desktop.ts — the SPA's single view of the Electron shell.
//
// Everything here degrades to a no-op in a plain browser, so components can
// call these unconditionally instead of repeating
// `window.generatoraiDesktop?.…` guards.
// ────────────────────────────────────────────────────────────────

import type {
  DesktopAppearancePush,
  DesktopServerEntry,
  DesktopShellStatePush,
  DesktopUpdateState,
} from '@generatorai/shared';

export type DesktopWindowChrome = GeneratorAIDesktopWindowChrome;
export type DesktopWindowState = GeneratorAIDesktopWindowStateChange;
export type DesktopCommand = GeneratorAIDesktopCommand;

/** True only inside the Electron shell. */
export const isDesktop: boolean =
  typeof window !== 'undefined' && window.generatoraiDesktop?.isDesktop === true;

/** True on macOS (browser tab or desktop shell): `Mod` means Cmd there. */
export const isMacOS: boolean =
  typeof navigator !== 'undefined' &&
  (/mac/i.test(navigator.platform ?? '') || /mac/i.test(navigator.userAgent ?? ''));

/** Which binding column of the command registry applies here (D-24). */
export const commandHost: 'web' | 'desktopMac' | 'desktopWinLinux' = !isDesktop
  ? 'web'
  : isMacOS
    ? 'desktopMac'
    : 'desktopWinLinux';

/**
 * What a plain browser looks like: the OS (or nothing) owns the title bar and
 * the SPA reserves no space. Also the fallback when the shell did not pass its
 * chrome (a malformed launch argument).
 */
export const NATIVE_CHROME: DesktopWindowChrome = {
  platform: 'linux',
  titleBarStyle: 'native',
  titleBarHeight: 0,
  insetLeft: 0,
  insetRight: 0,
  isWayland: false,
};

function bridge() {
  return typeof window === 'undefined' ? undefined : window.generatoraiDesktop;
}

/**
 * The window chrome, synchronously: main hands it to the preload as a launch
 * argument (06 §3.6), so it is known before the first render.
 */
export function windowChrome(): DesktopWindowChrome {
  return bridge()?.chrome ?? NATIVE_CHROME;
}

/**
 * The shell layout a chrome calls for (D-23, 06 §3.5):
 *   mac     macOS traffic lights over the sidebar's 44px top row, no strip;
 *   strip   the 36px title strip (Windows; Linux with the custom title bar);
 *   native  the OS frame (Linux default) and every browser tab.
 */
export type ShellLayout = 'mac' | 'strip' | 'native';

export function shellLayoutFor(chrome: DesktopWindowChrome): ShellLayout {
  if (chrome.titleBarStyle === 'hidden-inset') return 'mac';
  if (chrome.titleBarStyle === 'overlay') return 'strip';
  return 'native';
}

/**
 * Pushes renderer state into the native menu (checkmarks on `Toggle Sidebar`,
 * enablement on `Back`, the Appearance radio group, `Open Recent`).
 * Fire-and-forget: a failure here must never break the UI.
 */
export function pushMenuState(patch: Partial<DesktopShellStatePush>): void {
  const api = bridge()?.setMenuState;
  if (!api) return;
  void api(patch).catch(() => undefined);
}

/** Subscribe to menu/accelerator commands. Returns an unsubscribe function. */
export function onDesktopCommand(cb: (command: DesktopCommand) => void): () => void {
  const api = bridge()?.onCommand;
  if (!api) return () => undefined;
  return api(cb);
}

/** Subscribe to route pushes from the menu, tray, dock and deep links. */
export function onDesktopNavigate(cb: (path: string) => void): () => void {
  const api = bridge()?.onNavigate;
  if (!api) return () => undefined;
  return api(cb);
}

/**
 * Subscribe to the mode the user picks in the native View ▸ Appearance menu.
 * The shell only asks; ThemeProvider applies it (D-25).
 */
export function onDesktopAppearanceRequest(cb: (mode: 'light' | 'dark' | 'system') => void): () => void {
  const api = bridge()?.onAppearanceRequest;
  if (!api) return () => undefined;
  return api((request) => cb(request.mode));
}

/**
 * Mirror the renderer's appearance into the shell: it persists it, sets
 * `nativeTheme.themeSource`, repaints the window background and the caption
 * glyphs, so the next launch opens in the right colour. Fire-and-forget.
 */
export function pushDesktopAppearance(appearance: DesktopAppearancePush): void {
  const api = bridge()?.setAppearance;
  if (!api) return;
  void api(appearance).catch(() => undefined);
}

/**
 * Subscribe to whether Back / Forward can move (Chromium's session history,
 * 06 §3.4). Called at once with the last value main reported, then on every
 * change. A no-op outside the shell (the browser has its own buttons).
 */
export function onNavHistoryChanged(cb: (state: { back: boolean; forward: boolean }) => void): () => void {
  const api = bridge()?.onNavHistoryChanged;
  if (!api) return () => undefined;
  return api(cb);
}

/** Subscribe to maximise/fullscreen/focus changes. */
export function onWindowStateChanged(cb: (state: DesktopWindowState) => void): () => void {
  const api = bridge()?.onWindowStateChanged;
  if (!api) return () => undefined;
  return api(cb);
}

/** The desktop server switcher bridge (G-03). Every member but `list` no-ops in a plain browser tab. */
export const desktopServers = {
  isAvailable: (): boolean => Boolean(bridge()?.servers),
  /**
   * Every server the shell knows, with the reachability main probed. Rejects
   * when there is no shell or the call fails: an empty list would read as "no
   * servers", which is not what happened (D-36; P1-review P2-R23).
   */
  list: async (): Promise<DesktopServerEntry[]> => {
    const api = bridge()?.servers?.list;
    if (!api) throw new Error('The desktop server list is only available in the desktop app.');
    return api();
  },
  switchTo: (id: string): void => {
    const api = bridge()?.servers?.switchTo;
    if (!api) return;
    void api(id).catch(() => undefined);
  },
  /** Opens the shell's native "Connect to a server" prompt. */
  add: (): void => {
    const api = bridge()?.servers?.add;
    if (!api) return;
    void api().catch(() => undefined);
  },
  /** Subscribe to switches/adds/forgets made anywhere (menu, tray, this call). */
  onChanged: (cb: () => void): (() => void) => {
    const api = bridge()?.servers?.onChanged;
    if (!api) return () => undefined;
    return api(cb);
  },
};

/** The desktop updater bridge (G-04). */
export const desktopUpdates = {
  isAvailable: (): boolean => Boolean(bridge()?.updates),
  /**
   * The shell's updater state; `null` in a plain browser tab (there is no
   * updater). A failed call rejects rather than pretending to be `null`
   * (P1-review P2-R23).
   */
  getState: async (): Promise<DesktopUpdateState | null> => {
    const api = bridge()?.updates?.getState;
    if (!api) return null;
    return api();
  },
  /** Subscribing also tells the shell a renderer can show update state, so it skips its native dialog. */
  onChange: (cb: (state: DesktopUpdateState) => void): (() => void) => {
    const api = bridge()?.updates?.onChange;
    if (!api) return () => undefined;
    return api(cb);
  },
  /**
   * Installs the downloaded update: the shell hands over to the installer and
   * quits (06 §11 R5). A failed install leaves the app running and comes back
   * through `onChange` as `status: 'ready'` with `error` set.
   */
  restartToUpdate: async (): Promise<void> => {
    const api = bridge()?.updates?.install;
    if (!api) return;
    await api();
  },
};

/** The embedded server the desktop shell owns (a browser tab cannot restart its server). */
export const desktopServer = {
  canRestart: (): boolean => isDesktop && typeof bridge()?.restartServer === 'function',
  restart: async (): Promise<void> => {
    const api = bridge()?.restartServer;
    if (!api) throw new Error('Only the desktop app can restart its server.');
    await api();
  },
};

let nativeFolderPicker: Promise<boolean> | undefined;

/**
 * The OS folder picker (D-136). Usable only in the desktop app while it shows
 * this computer's own server: the dialog browses THIS machine, so its path
 * means nothing to a remote server — and main refuses the channel to a remote
 * page anyway (ipc-scope.ts). A plain browser has no absolute paths at all.
 * Callers fall back to the server-side DirectoryBrowser when it is unavailable.
 */
export const desktopFolders = {
  /** Resolved once per page load: switching servers reloads the window. */
  canPickNatively: (): Promise<boolean> => {
    nativeFolderPicker ??= (async () => {
      const api = bridge();
      if (!api?.selectDirectory || !api.getAppInfo) return false;
      try {
        return (await api.getAppInfo()).localServer === true;
      } catch {
        return false;
      }
    })();
    return nativeFolderPicker;
  },
  /** The chosen absolute path, or null when the user cancels. Rejects when there is no picker. */
  pick: async (defaultPath?: string): Promise<string | null> => {
    const api = bridge()?.selectDirectory;
    if (!api) throw new Error('The native folder picker is only available in the desktop app.');
    return api(defaultPath ? { defaultPath } : undefined);
  },
};

export const desktopWindow = {
  /** Zoom/restore, for the native double-click-the-title-bar gesture. */
  toggleMaximize: () => void bridge()?.window?.toggleMaximize().catch(() => undefined),
  isMaximized: async (): Promise<boolean> => {
    try {
      return (await bridge()?.window?.isMaximized()) ?? false;
    } catch {
      return false;
    }
  },
};

/**
 * Applies platform + chrome facts to `<html>` as classes, `data-layout` and
 * the `--gai-titlebar-*` variables. The generated pre-paint script in
 * index.html does the same before first paint; this keeps it idempotent.
 *
 * Styling keys off these rather than reading the bridge in every component,
 * which keeps the drag-region and inset rules in plain CSS where the browser
 * can apply them before React hydrates.
 */
export function applyChromeToDocument(chrome: DesktopWindowChrome): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  root.classList.remove('platform-darwin', 'platform-win32', 'platform-linux');
  root.classList.add(`platform-${chrome.platform}`);
  root.classList.toggle('desktop-shell', isDesktop);
  root.classList.toggle('custom-titlebar', chrome.titleBarStyle !== 'native');
  root.classList.toggle('titlebar-overlay', chrome.titleBarStyle === 'overlay');
  root.classList.toggle('titlebar-inset', chrome.titleBarStyle === 'hidden-inset');
  root.setAttribute('data-layout', shellLayoutFor(chrome));

  root.style.setProperty('--gai-titlebar-height', `${chrome.titleBarHeight}px`);
  root.style.setProperty('--gai-titlebar-inset-left', `${chrome.insetLeft}px`);
  root.style.setProperty('--gai-titlebar-inset-right', `${chrome.insetRight}px`);
}

/**
 * `navigator.windowControlsOverlay`, which lib.dom.d.ts does not yet declare.
 * Only the three members we use are modelled.
 */
interface WindowControlsOverlayApi {
  readonly visible: boolean;
  getTitlebarAreaRect(): DOMRect;
  addEventListener(type: 'geometrychange', listener: () => void): void;
  removeEventListener(type: 'geometrychange', listener: () => void): void;
}

/**
 * Keeps the reserved insets in sync with the Window Controls Overlay.
 *
 * On Windows and Linux the OS paints minimise/maximise/close into our title strip
 * (which is what gives Windows 11 its Snap Layouts flyout on maximise hover).
 * The strip it occupies is not a constant: it disappears in fullscreen and
 * differs between Windows versions and Linux desktop environments. Chromium
 * reports the exact free area, so prefer that over the main process estimate.
 *
 * Two subtleties, both learned the hard way:
 *
 *   • `geometrychange` fires BEFORE the viewport width settles, so reading
 *     the overlay rect and the viewport width in the same tick mixes a new
 *     value with a stale one and produces a wildly wrong inset. The read is
 *     therefore deferred to the next frame, and `resize` is also observed so
 *     whichever lands last wins.
 *   • A transient frame can still yield an absurd inset, so anything that
 *     would eat more than half the strip is rejected rather than applied.
 *
 * Only an `overlay` window has its controls drawn through the overlay. A
 * `hidden-inset` window (macOS traffic lights) still exposes
 * `navigator.windowControlsOverlay`, permanently `visible: false` — treating
 * that as "fullscreen" zeroed the inset the main process reserved and put the
 * title-bar content underneath the window buttons. Every other style keeps the
 * main process's insets; see `trackFullscreenInsets` for their fullscreen case.
 *
 * Returns a cleanup function; a no-op where the overlay is not present.
 */
export function trackWindowControlsOverlay(chrome: DesktopWindowChrome): () => void {
  if (chrome.titleBarStyle !== 'overlay') return () => undefined;
  if (typeof navigator === 'undefined') return () => undefined;
  const wco = (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlayApi })
    .windowControlsOverlay;
  if (!wco) return () => undefined;

  const root = document.documentElement;
  let frame = 0;

  const read = () => {
    if (!wco.visible) {
      // Fullscreen (or overlay off) — the controls are gone, so nothing to
      // reserve. Leaving the old inset would strand empty space in the strip.
      root.style.setProperty('--gai-titlebar-inset-left', '0px');
      root.style.setProperty('--gai-titlebar-inset-right', '0px');
      return;
    }
    const rect = wco.getTitlebarAreaRect();
    const viewport = root.clientWidth;
    const right = viewport - rect.x - rect.width;
    if (viewport <= 0 || right < 0 || right > viewport / 2) return; // mid-resize garbage
    root.style.setProperty('--gai-titlebar-inset-left', `${Math.max(0, rect.x)}px`);
    root.style.setProperty('--gai-titlebar-inset-right', `${right}px`);
  };

  const sync = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(read);
  };

  read();
  wco.addEventListener('geometrychange', sync);
  window.addEventListener('resize', sync);
  return () => {
    cancelAnimationFrame(frame);
    wco.removeEventListener('geometrychange', sync);
    window.removeEventListener('resize', sync);
  };
}

/**
 * Releases the reserved insets while the window is fullscreen, for chrome
 * whose controls are not tracked through the Window Controls Overlay (the OS
 * hides them in fullscreen, so the reservation would strand empty space), and
 * restores the main process's values on exit. `overlay` chrome is left to
 * `trackWindowControlsOverlay`, which reads the live geometry instead, and
 * `native` chrome reserves nothing.
 */
export function applyFullscreenInsets(chrome: DesktopWindowChrome, fullScreen: boolean): void {
  // `native` also covers the placeholder chrome in effect before the real value
  // arrives from the main process — applying it would wipe the real insets.
  if (typeof document === 'undefined' || chrome.titleBarStyle !== 'hidden-inset') return;
  const root = document.documentElement;
  root.style.setProperty('--gai-titlebar-inset-left', `${fullScreen ? 0 : chrome.insetLeft}px`);
  root.style.setProperty('--gai-titlebar-inset-right', `${fullScreen ? 0 : chrome.insetRight}px`);
}
