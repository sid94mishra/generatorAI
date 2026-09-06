// ────────────────────────────────────────────────────────────────
// Security response headers — APPLICATION-REVIEW-2026-09 plan item 14.
//
// Before this middleware the Express app set exactly one hardening header
// itself (`Content-Security-Policy`, see csp.ts). `X-Content-Type-Options`
// was set ad hoc on two routes, and `Referrer-Policy` only existed in the
// shipped nginx config — so anyone running the server directly, in plain
// Docker, or behind any other proxy got nothing. These headers are cheap and
// belong to the application, not to whichever edge happens to sit in front
// of it.
//
// • X-Content-Type-Options: nosniff — model-authored markdown and uploaded
//   artifacts are served from this origin; MIME sniffing would let a text
//   response be executed as script.
// • Referrer-Policy: strict-origin-when-cross-origin — chat/run/session ids
//   live in URL paths; a cross-origin link click must not leak them in the
//   Referer header.
// • Permissions-Policy — camera and geolocation are denied outright (nothing
//   in the product uses them). Microphone is `self` rather than empty: the
//   web SPA is served from this same origin in production and its voice
//   input (`apps/web/src/hooks/useSpeechToText.ts`) calls `getUserMedia`;
//   `microphone=()` would silently break dictation. `self` still denies the
//   capability to any embedded third-party frame.
// • Strict-Transport-Security — only meaningful, and only safe, on an HTTPS
//   response. Emitting it on a loopback `http://` listener is harmless to a
//   browser (it is ignored on plain HTTP) but confusing, and a proxy that
//   terminates TLS forwards `X-Forwarded-Proto: https`, which is the signal
//   we key on. `req.secure` covers the (rare) case of TLS terminated in-process.
//
// `X-Frame-Options` is deliberately absent: the CSP's `frame-ancestors 'none'`
// supersedes it in every browser that matters.
// ────────────────────────────────────────────────────────────────

import type { NextFunction, Request, Response } from 'express';

export const PERMISSIONS_POLICY = 'camera=(), microphone=(self), geolocation=()';
export const REFERRER_POLICY = 'strict-origin-when-cross-origin';
export const HSTS_VALUE = 'max-age=31536000; includeSubDomains';

/** True when the request reached us over HTTPS, directly or via a TLS-terminating proxy. */
export function isHttpsRequest(req: Pick<Request, 'secure' | 'headers'>): boolean {
  if (req.secure) return true;
  const forwarded = req.headers['x-forwarded-proto'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (!raw) return false;
  // A chain of proxies produces "https, http"; the first entry is the
  // client-facing hop, which is the one whose scheme the browser sees.
  const first = raw.split(',')[0]?.trim().toLowerCase();
  return first === 'https';
}

export function createSecurityHeadersMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', REFERRER_POLICY);
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
    if (isHttpsRequest(req)) {
      res.setHeader('Strict-Transport-Security', HSTS_VALUE);
    }
    next();
  };
}
