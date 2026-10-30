// ────────────────────────────────────────────────────────────────
// Platform capabilities.
//
// Every OS-conditional decision in the desktop shell resolves HERE, so that
// "what does this platform do" is answerable by reading one file instead of
// grepping for `process.platform` across the codebase.
//
// The three targets differ in ways that matter to the UI (D-23):
//
//   macOS    Traffic lights are top-LEFT and float over our content
//            (`hiddenInset`), centred in the sidebar's 44px top row; there is
//            no title strip. There is one global menu bar, owned by the OS.
//   Windows  Window controls are top-RIGHT. Window Controls Overlay lets the
//            OS paint them into our 36px title strip. Menus live per-window.
//   Linux    Depends entirely on the desktop environment. WCO support is
//            inconsistent, and Wayland forbids programmatic window geometry
//            outright — so we degrade rather than appear broken.
//
// The geometry comes from `CHROME` in `@generatorai/design-tokens/chrome`,
// which the web shell reads too, so the two sides cannot drift.
//
// The chrome functions come in two forms: `…For(platform, env)` is pure (and
// what the tests exercise per OS), and the no-argument wrapper applies it to
// this process.
// ────────────────────────────────────────────────────────────────

import { CHROME, trafficLightPosition } from '@generatorai/design-tokens/chrome';
import type { WindowChrome } from '../shared/ipc';
import { appearanceMirror } from './appearance';

/** The environment variables this module reads; `process.env` in production. */
export type PlatformEnv = Readonly<Record<string, string | undefined>>;

export const isMac = process.platform === 'darwin';
export const isWindows = process.platform === 'win32';
export const isLinux = process.platform === 'linux';

/**
 * Wayland forbids apps from moving, resizing, positioning or focusing their
 * own windows. Restoring saved geometry there silently does nothing, so we
 * skip it instead of leaving the user wondering why the window "forgot".
 */
export function isWaylandFor(platform: NodeJS.Platform, env: PlatformEnv): boolean {
  return platform === 'linux' && (env['XDG_SESSION_TYPE'] === 'wayland' || Boolean(env['WAYLAND_DISPLAY']));
}

export const isWayland = isWaylandFor(process.platform, process.env);

/**
 * Whether we draw our own title bar on `platform`.
 *
 * Linux is deliberately conservative: Window Controls Overlay depends on the
 * window manager, and a broken overlay leaves a window the user cannot close.
 * A native frame is uglier but always works, so Linux opts IN via
 * `GENERATORAI_LINUX_CUSTOM_TITLEBAR=1` rather than out. Any other Unix is
 * treated like Linux.
 */
export function useCustomTitleBarFor(platform: NodeJS.Platform, env: PlatformEnv): boolean {
  if (platform === 'darwin' || platform === 'win32') return true;
  return env[CHROME.linuxCustomTitleBarEnv] === '1';
}

/** {@link useCustomTitleBarFor} for this process. */
export function useCustomTitleBar(): boolean {
  return useCustomTitleBarFor(process.platform, process.env);
}

/**
 * Caption glyph colour for the Window Controls Overlay: the active theme's
 * `fg` for the current appearance, as last pushed by the renderer (D-25).
 */
export function titleBarSymbolColor(): string {
  return appearanceMirror().fg;
}

/**
 * BrowserWindow frame options for `platform` (06 §3.3).
 *
 * Spread into the constructor. Returns `{}` when we keep the native frame,
 * so the caller does not need to branch.
 */
export function titleBarOptionsFor(platform: NodeJS.Platform, env: PlatformEnv): Record<string, unknown> {
  if (!useCustomTitleBarFor(platform, env)) return {};

  if (platform === 'darwin') {
    return {
      // Keeps the native traffic lights but removes the bar, so our content
      // extends to the top of the window and the buttons float over it,
      // centred in the sidebar's 44px top row ({ x: 16, y: 16 }).
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: trafficLightPosition(),
    };
  }

  return {
    titleBarStyle: 'hidden',
    // Window Controls Overlay: the OS paints minimise/maximise/close directly
    // into our title strip. `color` is transparent so OUR strip paints the
    // background and the buttons sit on it seamlessly.
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: titleBarSymbolColor(),
      height: CHROME.strip.height,
    },
  };
}

/** {@link titleBarOptionsFor} for this process. */
export function titleBarOptions(): Record<string, unknown> {
  return titleBarOptionsFor(process.platform, process.env);
}

/** `process.platform` as one of the three desktop OSes; any other Unix is laid out like Linux. */
export function desktopPlatform(platform: NodeJS.Platform = process.platform): WindowChrome['platform'] {
  return platform === 'darwin' || platform === 'win32' ? platform : 'linux';
}

/**
 * Chrome geometry handed to the renderer so its layout can match. The field
 * names feed the `<html>` classes D-23 keeps. macOS has no strip, so its
 * `titleBarHeight` is 0 and it reports only the traffic-light inset.
 */
export function windowChromeFor(platform: NodeJS.Platform, env: PlatformEnv): WindowChrome {
  const custom = useCustomTitleBarFor(platform, env);
  const mac = platform === 'darwin';
  return {
    platform: desktopPlatform(platform),
    titleBarStyle: !custom ? 'native' : mac ? 'hidden-inset' : 'overlay',
    titleBarHeight: custom && !mac ? CHROME.strip.height : 0,
    insetLeft: custom && mac ? CHROME.mac.trafficLightInset : 0,
    insetRight: custom && !mac ? CHROME.strip.captionClusterWidth : 0,
    isWayland: isWaylandFor(platform, env),
  };
}

/**
 * {@link windowChromeFor} for this process. Static for the process lifetime
 * (platform + env), so the main window hands it to the preload as a launch
 * argument (06 §3.6) and the renderer has it before first paint.
 */
export function windowChrome(): WindowChrome {
  return windowChromeFor(process.platform, process.env);
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
