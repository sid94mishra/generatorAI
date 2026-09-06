// ────────────────────────────────────────────────────────────────
// Electron-session hardening: a CSP floor and a permission policy.
//
// The server sends a Content-Security-Policy with every response it serves
// (`apps/server/src/middleware/csp.ts`), so the SPA's own origin is covered.
// Nothing covered any OTHER origin the Electron session might render — a page
// reached through a navigation bug, or a site the agent drives inside a
// native browser tab. This module gives every session two defaults:
//
//   • `installCspFloor(session)` — adds the same CSP the server uses to any
//     document response that arrives WITHOUT one. Responses that already carry
//     a policy are left alone, so the server's own header (and any page that
//     sets a stricter one) is never weakened or doubled. Main-window session
//     only, and only in standalone mode: the Vite dev server sends no CSP and
//     needs inline HMR scripts plus a cross-origin API, so the floor would
//     break `pnpm dev:desktop`.
//
//   • `installPermissionPolicy(session, policy)` — Electron GRANTS every
//     permission request when no handler is set. Camera, microphone,
//     geolocation, screen capture and notifications are now denied unless the
//     supplied allow-list says otherwise. The main window's policy allows
//     `media` for the app origin (voice input); browser tabs allow nothing.
// ────────────────────────────────────────────────────────────────

import type { Session } from 'electron';
import { isAppOriginForPermission } from './navigation-guard';

/**
 * Mirrors `createCspMiddleware()` in apps/server. Kept literal (not imported)
 * because the desktop bundle must not depend on the server package; the
 * server's test recomputes the script hash, and this string is compared to
 * the server's in `session-hardening.test.ts`.
 */
export const DESKTOP_CSP = [
  "default-src 'self'",
  "script-src 'self' 'sha256-BQvRuMaCC1KXd/oQ2/DaWqL9fxp/Evdu7lSis8R+8hQ='",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
].join('; ');

type HeaderMap = Record<string, string[] | string>;

/** Minimal shape of `OnHeadersReceivedListenerDetails` this module reads. */
export interface HeadersReceivedDetails {
  url: string;
  resourceType: string;
  responseHeaders?: HeaderMap;
}

function hasHeader(headers: HeaderMap | undefined, name: string): boolean {
  if (!headers) return false;
  const wanted = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === wanted);
}

/**
 * Pure decision: the response headers to use, or null when unchanged.
 * Only documents (main frame / sub frame) over http(s) are touched.
 */
export function cspFloorHeaders(details: HeadersReceivedDetails, csp: string = DESKTOP_CSP): HeaderMap | null {
  if (details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame') return null;
  if (!/^https?:/i.test(details.url)) return null;
  if (hasHeader(details.responseHeaders, 'content-security-policy')) return null;
  return { ...(details.responseHeaders ?? {}), 'Content-Security-Policy': [csp] };
}

export function installCspFloor(ses: Pick<Session, 'webRequest'>, csp: string = DESKTOP_CSP): void {
  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = cspFloorHeaders(details, csp);
    callback(headers ? { responseHeaders: headers } : {});
  });
}

// ── Permissions ───────────────────────────────────────────────────

/**
 * Permissions that expose hardware, location, the screen, or the OS
 * notification surface. Denied unless the policy allows them; nothing else
 * is in this list because everything is denied by default anyway — the list
 * exists so a future allow-list cannot accidentally open one of these by
 * matching a broad pattern.
 */
export const SENSITIVE_PERMISSIONS = new Set([
  'media',
  'mediaKeySystem',
  'geolocation',
  'notifications',
  'display-capture',
  'screen',
  'midi',
  'midiSysex',
  'usb',
  'serial',
  'hid',
  'bluetooth',
  'idle-detection',
  'speaker-selection',
]);

export interface PermissionRequest {
  permission: string;
  /** Origin (or URL) of the requesting frame, when Electron supplies it. */
  origin: string | null;
  /** Extra detail for `media`: which device kinds are wanted. */
  mediaTypes?: readonly string[];
}

/** Return true to grant. Called for every request, sensitive or not. */
export type PermissionPolicy = (request: PermissionRequest) => boolean;

/** Deny everything — the browser-tab default. */
export const denyAllPermissions: PermissionPolicy = () => false;

/** The main window: microphone for the app's own origin, nothing else. */
export function appWindowPermissionPolicy(getAppUrl: () => string | null): PermissionPolicy {
  return ({ permission, origin, mediaTypes }) => {
    if (permission !== 'media') return false;
    if (mediaTypes && mediaTypes.length > 0 && mediaTypes.some((t) => t !== 'audio')) return false;
    return isAppOriginForPermission(origin, getAppUrl());
  };
}

/** Pure decision used by both Electron handlers. */
export function decidePermission(request: PermissionRequest, policy: PermissionPolicy): boolean {
  try {
    return policy(request) === true;
  } catch {
    return false;
  }
}

export function installPermissionPolicy(
  ses: Pick<Session, 'setPermissionRequestHandler' | 'setPermissionCheckHandler'>,
  policy: PermissionPolicy,
): void {
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const d = details as { securityOrigin?: string; requestingUrl?: string; mediaTypes?: string[] };
    callback(
      decidePermission(
        {
          permission,
          origin: d.securityOrigin ?? d.requestingUrl ?? null,
          ...(d.mediaTypes ? { mediaTypes: d.mediaTypes } : {}),
        },
        policy,
      ),
    );
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    const d = details as { mediaType?: string };
    return decidePermission(
      {
        permission,
        origin: requestingOrigin || null,
        ...(d?.mediaType ? { mediaTypes: [d.mediaType] } : {}),
      },
      policy,
    );
  });
}

// ── Browser-tab allow-list hook ───────────────────────────────────

let browserTabPolicy: PermissionPolicy = denyAllPermissions;

/**
 * Replaces the policy applied to every browser-tab session created from now
 * on. The default denies everything; a future settings screen can install an
 * allow-list here (e.g. `({ permission, origin }) => permission === 'clipboard-read' && origin === ...`).
 */
export function setBrowserTabPermissionPolicy(policy: PermissionPolicy | null): void {
  browserTabPolicy = policy ?? denyAllPermissions;
}

export function browserTabPermissionPolicy(): PermissionPolicy {
  return browserTabPolicy;
}

/**
 * Everything a freshly created browser-tab session must get.
 *
 * Deliberately NO CSP floor here: a tab renders whatever site the agent is
 * working on, and `default-src 'self'` would break every page that loads a
 * script or font from a CDN. The tab's protection is the permission policy
 * plus the popup gating already in `browser-host.ts`.
 */
export function hardenBrowserTabSession(
  ses: Pick<Session, 'setPermissionRequestHandler' | 'setPermissionCheckHandler'>,
): void {
  installPermissionPolicy(ses, (request) => browserTabPolicy(request));
}
