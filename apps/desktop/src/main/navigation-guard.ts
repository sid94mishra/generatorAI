// ────────────────────────────────────────────────────────────────
// Origin checks for the main window.
//
// Two callers, two different fail-open policies, so two functions:
//
//   isAppOrigin            — navigation / window-open. STRICT: an empty,
//                            unparseable or non-http(s) URL is NOT the app,
//                            so it is refused. `url.startsWith(appUrl)` was the
//                            previous check; `http://127.0.0.1:3100@evil.com`
//                            passes that (the URL parser treats everything
//                            before `@` as userinfo) and lands on evil.com.
//
//   isAppOriginForPermission — media-permission handlers. Electron reports an
//                            empty securityOrigin for its own internal frames,
//                            so an EMPTY origin is treated as the app frame
//                            there. Anything non-empty is compared strictly.
//
// Kept free of Electron imports so the rules are unit-testable.
// ────────────────────────────────────────────────────────────────

function parseOrigin(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  // `URL.origin` already excludes userinfo, so `user@host` cannot masquerade.
  return parsed.origin;
}

/** True only when `url` parses and its origin equals the app URL's origin. */
export function isAppOrigin(url: string | null | undefined, appUrl: string | null | undefined): boolean {
  if (!url || !appUrl) return false;
  const target = parseOrigin(url);
  const app = parseOrigin(appUrl);
  return target !== null && app !== null && target === app;
}

/**
 * Schemes the shell may hand to the OS.
 *
 * http/https/mailto are the web's own. The editor schemes are the documented
 * fallback the server returns when it cannot spawn the editor binary itself
 * (`/api/editor/open` → `fallbackUrl`); without them "Open in VS Code" did
 * nothing at all in the desktop app, because the web path — letting the
 * browser hand the URL to the OS — has no equivalent here.
 *
 * Everything else stays refused: `file:` would open arbitrary local paths,
 * `javascript:` would execute, and any other registered handler is an
 * application on the user's machine we have no reason to start.
 */
const EXTERNAL_PROTOCOLS = new Set([
  'https:',
  'http:',
  'mailto:',
  'vscode:',
  'vscode-insiders:',
  'cursor:',
  'windsurf:',
]);

/** True when `url` is safe to hand to `shell.openExternal`. */
export function isExternalUrlAllowed(url: string): boolean {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * Permission-handler variant: an empty origin is the app's own frame (Electron
 * gives no securityOrigin for internal frames); everything else is strict.
 */
export function isAppOriginForPermission(
  url: string | null | undefined,
  appUrl: string | null | undefined,
): boolean {
  if (!url) return Boolean(appUrl);
  return isAppOrigin(url, appUrl);
}
