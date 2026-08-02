// ────────────────────────────────────────────────────────────────
// desktop.ts — the SPA's single view of the Electron shell.
//
// Everything here degrades to a no-op in a plain browser, so components can
// call these unconditionally instead of repeating
// `window.generatoraiDesktop?.…` guards.
// ────────────────────────────────────────────────────────────────

export type DesktopWindowChrome = GeneratorAIDesktopWindowChrome;
export type DesktopMenuState = GeneratorAIDesktopMenuState;
export type DesktopWindowState = GeneratorAIDesktopWindowStateChange;
export type DesktopCommand = GeneratorAIDesktopCommand;

/** True only inside the Electron shell. */
export const isDesktop: boolean =
  typeof window !== 'undefined' && window.generatoraiDesktop?.isDesktop === true;

/**
 * What a plain browser looks like: the OS (or nothing) owns the title bar and
 * the SPA reserves no space. Also the fallback when the shell is too old to
 * expose `getWindowChrome`.
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

export async function readWindowChrome(): Promise<DesktopWindowChrome> {
  const api = bridge()?.getWindowChrome;
  if (!api) return NATIVE_CHROME;
  try {
    return await api();
  } catch {
    // A shell that fails this call is one we cannot lay out against — better
    // to render the normal header than a header with a hole in it.
    return NATIVE_CHROME;
  }
}

/**
 * Pushes renderer state into the native menu (checkmarks on `Toggle Sidebar`,
 * enablement on `Back`, the Appearance radio group, `Open Recent`).
 * Fire-and-forget: a failure here must never break the UI.
 */
export function pushMenuState(patch: Partial<DesktopMenuState>): void {
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

/** Subscribe to maximise/fullscreen/focus changes. */
export function onWindowStateChanged(cb: (state: DesktopWindowState) => void): () => void {
  const api = bridge()?.onWindowStateChanged;
  if (!api) return () => undefined;
  return api(cb);
}

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
 * Applies platform + chrome facts to `<html>` as classes and CSS variables.
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

  root.style.setProperty('--titlebar-height', `${chrome.titleBarHeight}px`);
  root.style.setProperty('--titlebar-inset-left', `${chrome.insetLeft}px`);
  root.style.setProperty('--titlebar-inset-right', `${chrome.insetRight}px`);
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
 * On Windows and Linux the OS paints minimise/maximise/close into our header
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
 *     would eat more than half the header is rejected rather than applied.
 *
 * Returns a cleanup function; a no-op where the overlay is not present.
 */
export function trackWindowControlsOverlay(): () => void {
  if (typeof navigator === 'undefined') return () => undefined;
  const wco = (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlayApi })
    .windowControlsOverlay;
  if (!wco) return () => undefined;

  const root = document.documentElement;
  let frame = 0;

  const read = () => {
    if (!wco.visible) {
      // Fullscreen (or overlay off) — the controls are gone, so nothing to
      // reserve. Leaving the old inset would strand empty space in the header.
      root.style.setProperty('--titlebar-inset-left', '0px');
      root.style.setProperty('--titlebar-inset-right', '0px');
      return;
    }
    const rect = wco.getTitlebarAreaRect();
    const viewport = root.clientWidth;
    const right = viewport - rect.x - rect.width;
    if (viewport <= 0 || right < 0 || right > viewport / 2) return; // mid-resize garbage
    root.style.setProperty('--titlebar-inset-left', `${Math.max(0, rect.x)}px`);
    root.style.setProperty('--titlebar-inset-right', `${right}px`);
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
