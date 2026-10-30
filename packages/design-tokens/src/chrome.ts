// ────────────────────────────────────────────────────────────────
// Window chrome and shell geometry (D-15, D-23; 06-desktop-and-shell.md §3.1,
// 02-design-system-spec.md §8).
//
// DEPENDENCY-FREE on purpose: the Electron main bundle imports this file through
// the lean `@generatorai/design-tokens/chrome` subpath, so it must not pull in
// the theme tables. Keep every import out of this file.
//
//   CHROME  what the desktop main process and the web shell both need
//           (window minimum, per-OS title geometry, shell widths main uses).
//   SHELL   renderer-only layout widths; fields CHROME already has are
//           re-exported from it, never redefined.
//   CHROME_FALLBACK_COLORS  Instrument ground/fg, used by main before the
//           renderer has pushed the real theme colours (P1-S4).
// ────────────────────────────────────────────────────────────────

export const CHROME = {
  sidebarWidth: 232,
  railWidth: 48,
  /** Window width below which the sidebar becomes the rail and the dock a sheet. */
  railBreakpoint: 1200,
  drawerBreakpoint: 768,
  /** Main card inset; the left margin is 0 (the sidebar's padding supplies the gap). */
  cardMargin: 8,
  /** == `--gai-h-bar`; stays 44 in Compact density (D-15). */
  pageHeaderHeight: 44,
  dockWidth: 480,
  dockWidthRun: 440,
  dockMinWidth: 360,
  dockSheetWidth: 380,
  /** 860 keeps the app usable side by side on a 13" laptop. */
  minWindow: { width: 860, height: 560 },
  mac: { trafficRowHeight: 44, trafficLightX: 16, trafficLightSize: 12, trafficLightInset: 78 },
  /** Windows (and Linux with the custom title bar): the full-width title strip. */
  strip: { height: 36, captionButtonWidth: 46, captionClusterWidth: 138, searchMaxWidth: 420, searchMinWidth: 200 },
  /** Linux native frame: back/forward + update pill row at the top of the sidebar. */
  nativeNavRowHeight: 36,
  /** Linux opts IN to the custom title bar (then it uses the Windows layout). */
  linuxCustomTitleBarEnv: 'GENERATORAI_LINUX_CUSTOM_TITLEBAR',
} as const;

/** macOS traffic lights centred in the sidebar's 44px top row → `{ x: 16, y: 16 }`. */
export function trafficLightPosition(): { x: number; y: number } {
  return {
    x: CHROME.mac.trafficLightX,
    y: (CHROME.mac.trafficRowHeight - CHROME.mac.trafficLightSize) / 2,
  };
}

/** Renderer layout widths (D-15). Emitted as `--gai-w-*` / `--container-*` by the token CSS. */
export const SHELL = {
  sidebarWidth: CHROME.sidebarWidth,
  railWidth: CHROME.railWidth,
  railBreakpoint: CHROME.railBreakpoint,
  mainCardInset: CHROME.cardMargin,
  pageHeaderHeight: CHROME.pageHeaderHeight,
  dockWidth: CHROME.dockWidth,
  dockWidthRun: CHROME.dockWidthRun,
  dockSheetWidth: CHROME.dockSheetWidth,
  summaryAsideWidth: 320,
  detailRailWidth: 360,
  inspectorWidth: 400,
  serversPopoverWidth: 280,
  /** = the P-31 Dialog sizes. */
  dialogWidth: { sm: 420, md: 640, lg: 960, xl: 1040 },
  pickerWidth: { model: 620, agent: 760 },
  menuWidth: { min: 176, default: 240 },
  /**
   * The Activity column (D-92, board EnhActivityColumn): 288 wide, resizable
   * 248–400. It docks beside the sidebar/rail only while the main card keeps
   * `minMain` px; otherwise it opens as an overlay over the card (the 1100px
   * window: the rail's quick access, board EnhRailQuickAccess).
   */
  activityColumn: { width: 288, min: 248, max: 400, minMain: 720, popoverWidth: 320 },
} as const;

/**
 * Instrument ground (window background) and fg (caption symbol colour) per
 * appearance. Literal on purpose — this file stays import-free; a test pins the
 * values to `chromeColors('instrument', …)` so they cannot drift.
 */
export const CHROME_FALLBACK_COLORS = {
  dark: { background: '#0b0b0c', symbol: '#ededef' },
  light: { background: '#f1f1ef', symbol: '#18181b' },
} as const;
