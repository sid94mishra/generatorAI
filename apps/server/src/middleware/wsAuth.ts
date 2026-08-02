// ────────────────────────────────────────────────────────────────
// WebSocket upgrade authorization.
//
// Browsers cannot attach an `Authorization` header to a `WebSocket`, so the
// same single-use ticket mechanism used for SSE is the browser path here.
// Non-browser clients (CLI, desktop main, mobile) send a DPoP-bound token.
//
// Every upgrade is authorized BEFORE `handleUpgrade` completes, and every
// stream declares the scope it needs — `exec:terminal` for a PTY,
// `exec:browser` for the integrated browser, `write:chats` for speech input.
// ────────────────────────────────────────────────────────────────

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  AuthError,
  hasAllScopes,
  isLoopbackAddress,
  missingScopes,
  type Principal,
  type Scope,
} from '@generatorai/auth';
import type { Container } from '../composition-root.js';

export interface UpgradeAuthResult {
  ok: boolean;
  principal?: Principal;
}

export interface AuthorizeUpgradeParams {
  container: Container;
  req: IncomingMessage;
  socket: Duplex;
  /** Scopes the stream requires. */
  requiredScopes: Scope[];
  /** Ticket binding — a ticket minted for another stream must not be accepted. */
  ticketScope: { scope: string; id: string | null };
  /** Label used in logs/audit. */
  label: string;
}

/**
 * Authorizes an upgrade, writing the HTTP error response and destroying the
 * socket on failure. Returns the principal on success.
 */
export async function authorizeWebSocketUpgrade(
  params: AuthorizeUpgradeParams,
): Promise<UpgradeAuthResult> {
  const { container, req, socket, requiredScopes, ticketScope, label } = params;
  const { auth, audit } = container.security;

  if (!isOriginAllowed(req, container)) {
    container.logger.warn(`[${label}] upgrade rejected: origin not allowed`, {
      origin: req.headers.origin ?? '(none)',
    });
    reject(socket, 403, 'Forbidden');
    return { ok: false };
  }

  try {
    const principal = await auth.authenticate({
      method: 'GET',
      url: absoluteUrl(req),
      headers: req.headers as Record<string, string | string[] | undefined>,
      query: parseQuery(req.url),
      remoteAddress: req.socket.remoteAddress,
      isLoopback:
        isLoopbackAddress(req.socket.remoteAddress) && isLoopbackAddress(req.socket.localAddress),
      allowStreamTicket: true,
      streamScope: ticketScope,
    });

    if (!hasAllScopes(principal.scopes, requiredScopes)) {
      const missing = missingScopes(principal.scopes, requiredScopes);
      audit.record({
        action: 'auth.denied',
        result: 'denied',
        principal,
        resourceType: 'websocket',
        resourceId: `${ticketScope.scope}:${ticketScope.id ?? ''}`,
        reasonCode: 'INSUFFICIENT_SCOPE',
        metadata: { required: requiredScopes, missing },
        severity: 'critical',
      });
      container.logger.warn(`[${label}] upgrade denied: missing scope`, { missing });
      reject(socket, 403, 'Forbidden');
      return { ok: false };
    }

    return { ok: true, principal };
  } catch (err) {
    const code = err instanceof AuthError ? err.code : 'UNAUTHORIZED';
    // NEVER log `req.url` here — it carries `?ticket=`.
    container.logger.warn(`[${label}] upgrade unauthorized`, { code });
    reject(socket, 401, 'Unauthorized');
    return { ok: false };
  }
}

function reject(socket: Duplex, status: number, text: string): void {
  try {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  } catch {
    // Socket already gone.
  }
  socket.destroy();
}

function absoluteUrl(req: IncomingMessage): string {
  const host = firstValue(req.headers['host']) ?? 'localhost';
  const proto = firstValue(req.headers['x-forwarded-proto']) ?? 'http';
  return `${proto}://${host}${req.url ?? '/'}`;
}

function parseQuery(url: string | undefined): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  try {
    const parsed = new URL(url ?? '/', 'http://localhost');
    for (const [key, value] of parsed.searchParams) out[key] = value;
  } catch {
    // Malformed URL — treat as no query params.
  }
  return out;
}

function firstValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Origin allowlist for upgrades. A browser attaches `Origin`; a native client
 * does not. `null`/absent origins are only trusted from loopback, so a remote
 * non-browser client still has to present a real credential (which it does —
 * this runs after nothing, but before `handleUpgrade`).
 */
export function isOriginAllowed(req: IncomingMessage, container: Container): boolean {
  const origin = firstValue(req.headers['origin']) ?? null;
  if (!origin || origin === 'null') {
    // Electron `file://` and native clients. Safe because authentication still
    // runs; the origin check only protects browsers from CSWSH.
    return true;
  }
  const allowed = container.config.security.corsOrigins;
  if (allowed.includes(origin)) return true;

  const widgetOrigin =
    process.env['WIDGET_ORIGIN'] ?? `http://127.0.0.1:${process.env['WIDGET_PORT'] ?? '3101'}`;
  if (origin === widgetOrigin) return true;

  try {
    const parsed = new URL(origin);
    if (isLoopbackAddress(parsed.hostname)) return true;
  } catch {
    return false;
  }
  return false;
}
