// ────────────────────────────────────────────────────────────────
// Desktop shell IPC payloads (G-03, G-04, G-05, D-25; 06-desktop-and-shell.md).
//
// The Electron main process (`apps/desktop/src/shared/ipc.ts`, the preload
// bridge) and the web renderer (`apps/web/src/types/desktop-bridge.d.ts`)
// both import these, so the two sides of the bridge cannot drift. Types only:
// the desktop main bundle must never pull the `@generatorai/shared` root in
// at runtime (06 §3.2), and `import type` is erased.
// ────────────────────────────────────────────────────────────────

import type { AttentionCounts } from './Attention.js';

/** The appearance mode a user picks (D-25). */
export type DesktopThemePreference = 'light' | 'dark' | 'system';

/**
 * What the renderer pushes on every appearance change (D-25; 06 §6.1–§6.4).
 * The renderer owns appearance; main only mirrors it. The chrome colours are
 * `#rrggbb` literals for BOTH appearances, so the next launch paints the
 * right window background even if the OS flipped light/dark while closed.
 */
export interface DesktopAppearancePush {
  mode: DesktopThemePreference;
  themeId: string;
  groundLight: string;
  groundDark: string;
  fgLight: string;
  fgDark: string;
}

/** A mode picked in the native View ▸ Appearance menu; the renderer applies it. */
export interface DesktopAppearanceRequest {
  mode: DesktopThemePreference;
}

/**
 * Renderer UI state mirrored into the native shell (`setMenuState`, 06 §5.4).
 * The renderer sends partial patches.
 */
export interface DesktopShellStatePush {
  sidebarOpen: boolean;
  rightPaneOpen: boolean;
  /** Most recently visited routes, newest first. */
  recent: { label: string; route: string }[];
  /** True while the renderer holds edits that closing would discard. */
  hasUnsavedWork: boolean;
  /**
   * Needs-you / running totals from the D-36 attention feed (G-01), from the
   * renderer's own subscription. `null` until it has a first snapshot. Main
   * uses them for the tray text and the OS badge (G-05); the application
   * menu does not show them.
   */
  attention: AttentionCounts | null;
}

/**
 * Reachability of one server, from `GET /api/auth/server-info` (G-03):
 * - `connected`: it answered with a GeneratorAI identity (and, when the
 *   client knows which server to expect, the same one).
 * - `unpaired`: something answered, but not as the expected GeneratorAI
 *   server (a 4xx other than 429, no `serverId`, or a different `serverId`).
 * - `error`: a GeneratorAI-shaped endpoint answered but is failing or
 *   throttling (5xx, 429). Reachable, but identity was not confirmed.
 * - `offline`: no answer at all (timeout, DNS, refused connection).
 */
export type ServerReachability = 'connected' | 'unpaired' | 'error' | 'offline';

/** One entry in the desktop server switcher (G-03), with its probe result. */
export interface DesktopServerEntry {
  /** `'embedded'` for this machine's own server; a connection id otherwise. */
  id: string;
  label: string;
  url: string;
  kind: 'embedded' | 'remote';
  active: boolean;
  /** Probed by the main process with Node `fetch` (the renderer's CSP allows only its own origin). */
  status: ServerReachability;
  serverName?: string;
  latencyMs?: number;
}

/**
 * Auto-updater state (G-04, 06 §8).
 *
 * - `idle`: nothing to install. `error` may still carry the last failed
 *   check or download.
 * - `checking` / `downloading`: work in progress; `percent` is 0–100 while
 *   downloading.
 * - `ready`: `downloadedVersion` is fully downloaded and installable. It
 *   stays `ready` through later checks and failures, which only set `error`.
 * - `installing`: the user asked to install and the updater is handing over
 *   to the installer. If that fails, the state goes back to `ready` with
 *   `error` set, and the app keeps running.
 *
 * `error` is cleared by the next transition that is not itself a failure.
 */
export interface DesktopUpdateState {
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'installing';
  /** The running build's version. */
  currentVersion: string;
  /** The version a check found (being downloaded, or downloaded). */
  nextVersion?: string;
  /** The version that is downloaded and installable. Set exactly while `ready`/`installing`. */
  downloadedVersion?: string;
  /** 0–100 while `downloading`. */
  percent?: number;
  /** Message of the most recent failure (check, download or install). */
  error?: string;
}

// ────────────────────────────────────────────────────────────────
// P2-R41 — window chrome / find-in-page / browser-IPC payloads.
//
// Previously declared twice: once in `apps/desktop/src/shared/ipc.ts` (and
// `browser-ipc.ts`) for main/preload, and again — by hand, kept in sync only
// by discipline — in `apps/web/src/types/desktop-bridge.d.ts` for the
// renderer. `WindowChrome.platform` had already drifted (`NodeJS.Platform`
// on the desktop side vs. a hand-picked `'darwin' | 'win32' | 'linux'` union
// on the web side). Single-sourced here; both sides now import these.
// ────────────────────────────────────────────────────────────────

/**
 * Where the OS paints its window controls, so the SPA can leave room. The web
 * app is served in a browser too, where this is simply absent.
 *
 * `platform` is one of the three desktop OSes: main maps `process.platform`
 * onto them (`apps/desktop/src/main/platform.ts` `desktopPlatform()`; any
 * other Unix is laid out like Linux), and the web app builds its
 * `platform-*` class from it.
 */
export type DesktopPlatform = 'darwin' | 'win32' | 'linux';

export interface WindowChrome {
  platform: DesktopPlatform;
  /**
   * `native` — the OS draws a full title bar above our content (fallback).
   * `hidden-inset` — macOS: traffic lights float over our header.
   * `overlay` — Windows/Linux: the OS paints min/max/close INTO our header.
   */
  titleBarStyle: 'native' | 'hidden-inset' | 'overlay';
  /** Height in px the app must reserve for the draggable strip. */
  titleBarHeight: number;
  /** Space to keep clear on the LEFT (macOS traffic lights). */
  insetLeft: number;
  /** Space to keep clear on the RIGHT (Windows/Linux window controls). */
  insetRight: number;
  /** Wayland forbids programmatic move/resize — the UI should not offer it. */
  isWayland: boolean;
}

/**
 * Payload of the main→renderer nav-history-changed event (06 §3.4): whether
 * the window's session history can go back / forward. Chromium is the
 * authority; the Windows title strip and the Linux native-frame sidebar row
 * enable their Back / Forward buttons from it.
 */
export interface NavHistoryState {
  back: boolean;
  forward: boolean;
}

/** Payload of the main→renderer window-state-changed event (maximize/unmaximize/fullscreen/focus). */
export interface WindowStateChange {
  maximized: boolean;
  fullScreen: boolean;
  focused: boolean;
}

/** Result of one find-in-page pass, as Chromium reports it. */
export interface FindInPageResult {
  activeMatchOrdinal: number;
  matches: number;
}

/** Rect in CSS pixels relative to the main BrowserWindow's client area. */
export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** DevTools panels the SPA may request when opening the inspector. */
export type BrowserDevtoolsPanel = 'elements' | 'network' | 'console' | 'sources';

/**
 * Device-emulation parameters for the native browser view. Mirrors the
 * subset of Chromium's device metrics that a responsive-design toolbar
 * needs. `null` (passed to `setEmulation`) disables emulation and restores
 * the real WebContentsView metrics.
 */
export interface BrowserEmulationParams {
  /** Emulated viewport width in CSS px. */
  width: number;
  /** Emulated viewport height in CSS px. */
  height: number;
  /** Device pixel ratio (deviceScaleFactor). Default 1. */
  deviceScaleFactor?: number;
  /** Emulate a touch/mobile device (screenPosition='mobile'). Default false. */
  mobile?: boolean;
}

/** One tab of the native desktop browser host (Phase 2 of the browser integration). */
export interface NativeBrowserDescriptor {
  /** Globally-unique browser tab id. */
  tabId: string;
  /** Owning workspace. */
  workspaceId: string;
  currentUrl: string | null;
  title: string | null;
  /** Page favicon as a data URL, when one has loaded. */
  favicon: string | null;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** 'active' when a scoped CDP proxy is running for this tab, else null.
   *  Diagnostic only — never the real endpoint URL. */
  cdpEndpoint: string | null;
}

/** Main→renderer native-browser lifecycle notification. */
export interface NativeBrowserEvent {
  /** The browser tab this event belongs to. */
  tabId: string;
  workspaceId: string;
  url?: string;
  title?: string;
  isMainFrame?: boolean;
  errorCode?: number;
  errorDescription?: string;
  favicon?: string;
  /** True while the page is loading (did-start-loading .. did-stop-loading). */
  loading?: boolean;
}

/** One browser comment (D-140), serialised by the in-page Annotate overlay
 * when it is sent: the element's identity, HTML and curated CSS (or an area's
 * box), the user's comment, and a screenshot of it in context — scrolled into
 * view, padded, its numbered pin and outline visible. */
export interface BrowserPickResult {
  /** Stable key assigned by the overlay. */
  key?: string;
  /** The pin number the user saw. */
  n?: number;
  url: string;
  /** The page title when it was sent. */
  title?: string;
  /** Lowercase tag name ('div', 'button'), or 'area' for a dragged area. */
  tag: string;
  id: string | null;
  classes: string[];
  /** Short label like `button#buy.cta` (DevTools-style), or `area 320×120`. */
  label: string;
  /** Trimmed visible text (truncated). */
  text: string;
  cssSelector: string;
  xpath: string;
  outerHtml: string;
  /** Viewport-relative box at capture time. */
  boundingBox: { x: number; y: number; width: number; height: number };
  viewport?: { width: number; height: number };
  computedStyle?: Record<string, string>;
  /** PNG data URL of the element/area in context, or null. */
  screenshot?: string | null;
  comment?: string;
}

/** A comment as the tray lists it. */
export interface BrowserAnnotationSummary {
  key: string;
  n: number;
  label: string;
  tag: string;
  comment: string;
  /** A dragged area rather than an element. */
  region: boolean;
  /** The element's visible text (empty for an area). */
  text: string;
}

/** What the overlay reports on each poll. */
export interface BrowserAnnotatePollResult {
  /** Saved comments, in pin order (drafts excluded). */
  items: BrowserAnnotationSummary[];
  /** The user pressed Esc with no card open: leave Annotate mode. */
  exit: boolean;
  /** The user pressed ⌘/Ctrl↵ in a card: send every comment now. */
  sendAll: boolean;
}

/** A user screenshot of the page (`capture`). */
export interface BrowserCaptureResult {
  /** PNG data URL. */
  dataUrl: string;
  /** What was actually captured — 'full' can degrade to 'visible'. */
  mode: 'visible' | 'full';
}
