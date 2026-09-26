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
