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

import { nativeTheme } from 'electron';
import type { WindowChrome } from '../shared/ipc';

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

/** Title-bar symbol colour that stays legible in either theme. */
export function titleBarSymbolColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#e6edf3' : '#1f2328';
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

/** Chrome geometry handed to the renderer so its header can match. */
export function windowChrome(): WindowChrome {
  const custom = useCustomTitleBar();
  return {
    platform: process.platform,
    titleBarStyle: !custom ? 'native' : isMac ? 'hidden-inset' : 'overlay',
    titleBarHeight: custom ? TITLE_BAR_HEIGHT : 0,
    insetLeft: custom && isMac ? MAC_TRAFFIC_LIGHT_INSET : 0,
    insetRight: custom && !isMac ? WINDOW_CONTROLS_WIDTH : 0,
    isWayland,
  };
}

/**
 * Accelerator for switching to the Nth main section.
 *
 * macOS reserves `Cmd+1..9` for tab switching almost universally, so binding
 * navigation there fights muscle memory — a user pressing `Cmd+2` expecting a
 * tab would be teleported to another page. Windows and Linux have no such
 * convention, so `Ctrl+N` is both free and expected there.
 */
export function sectionAccelerator(index: number, macKey: string): string {
  return isMac ? `Cmd+Shift+${macKey}` : `Ctrl+${index}`;
}

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
