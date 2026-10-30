// ────────────────────────────────────────────────────────────────
// Window chrome handed from main to the preload as a launch argument
// (06-desktop-and-shell.md §3.6).
//
// The chrome is static per process (platform + env), so main passes it once in
// `webPreferences.additionalArguments` and the preload exposes it as a plain
// value. The renderer lays out its title strip / traffic-light row from the
// first frame instead of waiting on an IPC round trip.
//
// Dependency-free: the sandboxed preload bundles this file.
// ────────────────────────────────────────────────────────────────

import type { WindowChrome } from './ipc';

/** The `additionalArguments` prefix; the rest of the argument is JSON. */
export const WINDOW_CHROME_ARG = '--gai-chrome=';

/** The launch argument main adds to the main window's renderer. */
export function windowChromeArg(chrome: WindowChrome): string {
  return WINDOW_CHROME_ARG + JSON.stringify(chrome);
}

const PLATFORMS: readonly string[] = ['darwin', 'win32', 'linux'] satisfies WindowChrome['platform'][];
const TITLE_BAR_STYLES: readonly string[] = ['native', 'hidden-inset', 'overlay'] satisfies WindowChrome['titleBarStyle'][];

function isLength(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * The {@link WindowChrome} carried in `argv`, or `undefined` when it is
 * missing or malformed. The web app then falls back to its native layout,
 * which always works, rather than laying out around wrong geometry.
 */
export function parseWindowChromeArg(argv: readonly string[]): WindowChrome | undefined {
  const arg = argv.find((a) => a.startsWith(WINDOW_CHROME_ARG));
  if (arg === undefined) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(arg.slice(WINDOW_CHROME_ARG.length));
  } catch {
    return undefined;
  }
  if (!raw || typeof raw !== 'object') return undefined;
  const c = raw as Record<string, unknown>;
  if (typeof c['platform'] !== 'string' || !PLATFORMS.includes(c['platform'])) return undefined;
  if (typeof c['titleBarStyle'] !== 'string' || !TITLE_BAR_STYLES.includes(c['titleBarStyle'])) return undefined;
  if (!isLength(c['titleBarHeight']) || !isLength(c['insetLeft']) || !isLength(c['insetRight'])) return undefined;
  if (typeof c['isWayland'] !== 'boolean') return undefined;
  // Rebuilt field by field, so nothing else in the argument reaches the page.
  return {
    platform: c['platform'] as WindowChrome['platform'],
    titleBarStyle: c['titleBarStyle'] as WindowChrome['titleBarStyle'],
    titleBarHeight: c['titleBarHeight'],
    insetLeft: c['insetLeft'],
    insetRight: c['insetRight'],
    isWayland: c['isWayland'],
  };
}
