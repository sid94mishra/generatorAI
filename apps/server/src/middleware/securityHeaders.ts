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
//   response: TLS terminated in-process (Network exposure, D-110) or by a
//   proxy the operator trusts (`GENERATORAI_TRUST_PROXY`, D-114 — an
//   untrusted client's `X-Forwarded-Proto` no longer counts). Never for an IP
//   address or `localhost`: browsers ignore HSTS for IPs, and pinning
//   `localhost` to HTTPS would break the same machine's plain-HTTP loopback
//   once Network exposure is turned off again.
//
// `X-Frame-Options` is deliberately absent: the CSP's `frame-ancestors 'none'`
// supersedes it in every browser that matters.
// ────────────────────────────────────────────────────────────────

import { isIP } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { requestOrigin, type OriginRequest, type TrustProxyPolicy } from '../network/requestOrigin.js';

export const PERMISSIONS_POLICY = 'camera=(), microphone=(self), geolocation=()';
export const REFERRER_POLICY = 'strict-origin-when-cross-origin';
export const HSTS_VALUE = 'max-age=31536000; includeSubDomains';

/** True when the request reached us over HTTPS, directly or via a trusted TLS-terminating proxy. */
export function isHttpsRequest(req: OriginRequest, policy?: TrustProxyPolicy): boolean {
  return requestOrigin(req, policy).scheme === 'https';
}

/** HSTS is pinned to a hostname; an IP literal or `localhost` must never carry it. */
export function shouldSendHsts(req: OriginRequest, policy?: TrustProxyPolicy): boolean {
  const origin = requestOrigin(req, policy);
  if (origin.scheme !== 'https') return false;
  let hostname: string;
  try {
    hostname = new URL(`https://${origin.host}`).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  return isIP(hostname) === 0 && hostname !== 'localhost' && !hostname.endsWith('.localhost');
}

export function createSecurityHeadersMiddleware(policy?: TrustProxyPolicy) {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', REFERRER_POLICY);
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
    if (shouldSendHsts(req, policy)) {
      res.setHeader('Strict-Transport-Security', HSTS_VALUE);
    }
    next();
  };
}
