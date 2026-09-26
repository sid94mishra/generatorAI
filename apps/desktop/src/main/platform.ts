// ────────────────────────────────────────────────────────────────
// Platform capabilities.
//
// Every OS-conditional decision in the desktop shell resolves HERE, so that
// "what does this platform do" is answerable by reading one file instead of
// grepping for `process.platform` across the codebase.
//
// The three targets differ in ways that matter to the UI:
//
//   macOS    Traffic lights are top-LEFT and can float over our content
//            (`hiddenInset`). There is one global menu bar, owned by the OS.
//   Windows  Window controls are top-RIGHT. Window Controls Overlay lets the
//            OS paint them into our header. Menus live per-window.
//   Linux    Depends entirely on the desktop environment. WCO support is
//            inconsistent, and Wayland forbids programmatic window geometry
//            outright — so we degrade rather than appear broken.
// ────────────────────────────────────────────────────────────────

import type { WindowChrome } from '../shared/ipc';
import { appearanceMirror } from './appearance';

export const isMac = process.platform === 'darwin';
export const isWindows = process.platform === 'win32';
export const isLinux = process.platform === 'linux';

/**
 * Wayland forbids apps from moving, resizing, positioning or focusing their
 * own windows. Restoring saved geometry there silently does nothing, so we
 * skip it instead of leaving the user wondering why the window "forgot".
 */
export const isWayland =
  isLinux &&
  (process.env['XDG_SESSION_TYPE'] === 'wayland' ||
    Boolean(process.env['WAYLAND_DISPLAY']));

/**
 * Height of the unified title bar / header strip, in px.
 *
 * Must stay in lockstep with the web header's `h-10` (40px). If they drift,
 * the OS-drawn window controls float above or below our toolbar row.
 */
export const TITLE_BAR_HEIGHT = 40;

/**
 * Width to keep clear for macOS traffic lights.
 *
 * Three 12px buttons with 8px gaps, starting 16px from the edge, plus
 * breathing room before our first control.
 */
export const MAC_TRAFFIC_LIGHT_INSET = 78;

/** Approximate width of the Windows/Linux min-max-close cluster. */
export const WINDOW_CONTROLS_WIDTH = 138;

/**
 * Whether we draw our own title bar on this platform.
 *
 * Linux is deliberately conservative: Window Controls Overlay depends on the
 * window manager, and a broken overlay leaves a window the user cannot close.
 * A native frame is uglier but always works, so Linux opts IN via an env var
 * rather than out.
 */
export function useCustomTitleBar(): boolean {
  if (isMac || isWindows) return true;
  return process.env['GENERATORAI_LINUX_CUSTOM_TITLEBAR'] === '1';
}

/**
 * Caption glyph colour for the Window Controls Overlay: the active theme's
 * `fg` for the current appearance, as last pushed by the renderer (D-25).
 */
export function titleBarSymbolColor(): string {
  return appearanceMirror().fg;
}

/**
 * BrowserWindow options for the frame, resolved per platform.
 *
 * Spread into the constructor. Returns `{}` when we keep the native frame,
 * so the caller does not need to branch.
 */
export function titleBarOptions(): Record<string, unknown> {
  if (!useCustomTitleBar()) return {};

  if (isMac) {
    return {
      // Keeps the native traffic lights but removes the bar, so our header
      // extends to the top of the window and the buttons float over it.
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: (TITLE_BAR_HEIGHT - 12) / 2 },
    };
  }

  return {
    titleBarStyle: 'hidden',
    // Window Controls Overlay: the OS paints minimise/maximise/close directly
    // into our header. `color` is transparent so OUR header paints the strip
    // and the buttons sit on it seamlessly.
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: titleBarSymbolColor(),
      height: TITLE_BAR_HEIGHT,
    },
  };
}

/** `process.platform` as one of the three desktop OSes; any other Unix is laid out like Linux. */
export function desktopPlatform(platform: NodeJS.Platform = process.platform): WindowChrome['platform'] {
  return platform === 'darwin' || platform === 'win32' ? platform : 'linux';
}

/** Chrome geometry handed to the renderer so its header can match. */
export function windowChrome(): WindowChrome {
  const custom = useCustomTitleBar();
  return {
    platform: desktopPlatform(),
    titleBarStyle: !custom ? 'native' : isMac ? 'hidden-inset' : 'overlay',
    titleBarHeight: custom ? TITLE_BAR_HEIGHT : 0,
    insetLeft: custom && isMac ? MAC_TRAFFIC_LIGHT_INSET : 0,
    insetRight: custom && !isMac ? WINDOW_CONTROLS_WIDTH : 0,
    isWayland,
  };
}

/**
 * Whether a downloaded update must also pass through Electron's native
 * `autoUpdater` before it can be installed.
 *
 * True on macOS only, and not as a workaround: it is which updater backend
 * `electron-updater` uses there. Its `MacUpdater` downloads the zip, emits its
 * own `update-downloaded`, and only THEN serves the file to Squirrel.Mac,
 * which downloads and verifies it again (code signature included) and signals
 * Electron's native `autoUpdater` `update-downloaded` when it is installable.
 * `quitAndInstall` before that point waits for Squirrel indefinitely.
 * The Windows (NSIS) and Linux (AppImage/deb/rpm) updaters install straight
 * from the downloaded file, so their `update-downloaded` already means ready
 * (`electron-updater` 6.8.9, `MacUpdater.js` / `BaseUpdater.js`).
 */
export const updaterHasNativeInstallStage = isMac;

/**
 * Adds an `&` mnemonic to a Windows/Linux menu label.
 *
 * The `&` makes the following letter underlined and generates the `Alt+<key>`
 * accelerator users expect from a native menu bar. macOS has no mnemonics and
 * would render the `&` literally, so it is stripped there.
 */
export function mnemonic(label: string, letter: string): string {
  if (isMac) return label;
  const index = label.toLowerCase().indexOf(letter.toLowerCase());
  if (index < 0) return label;
  return `${label.slice(0, index)}&${label.slice(index)}`;
}
