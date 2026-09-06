// ────────────────────────────────────────────────────────────────
// Content-Security-Policy middleware — W31.
//
// Prevents model-authored markdown / widget content served from the same
// origin from exfiltrating data or loading rogue scripts. Rules are
// intentionally tight for the API server; the web SPA's own CSP lives in
// vite.config.ts (injected as a <meta> in dev and a response header in prod
// via the static-files middleware).
//
// This file sets ONLY the Content-Security-Policy header. The other
// hardening headers (X-Content-Type-Options, Referrer-Policy,
// Permissions-Policy, Strict-Transport-Security) live in the sibling
// `securityHeaders.ts`, wired immediately after this one in app.ts.
//
// △ Fixed during end-to-end review — `script-src` used to carry a blanket
// 'unsafe-inline', justified in a comment as "required by inline Vite HMR
// runtime in dev" — which does not apply to this process at all (Vite's dev
// server is a separate process; this CSP guards `apps/server`'s own
// responses, including the production static-file serve of the built SPA).
// The ACTUAL reason a script-src allowance was needed: `apps/web/index.html`
// has one genuinely inline, dependency-free bootstrap script (the
// theme-flash-prevention snippet — see its own comment there) that must run
// before first paint. That is a fixed, build-time-constant string, which is
// exactly what CSP's hash-source mechanism exists for: `THEME_SCRIPT_CSP_HASH`
// below allow-lists that ONE script by its SHA-256 digest instead of every
// inline script on the origin. `__tests__/csp.test.ts` recomputes the hash
// from the live source file on every run and fails loudly if they ever
// diverge, rather than letting the CSP silently stop protecting anything.
//
// • style-src googleapis.com — Google Fonts stylesheet URL.
// • font-src gstatic.com — Google Fonts font binary CDN.
// • img-src data: blob: — chat images pasted as data URIs, blob URLs for
//   screenshot previews from the Integrated Browser.
// • connect-src 'self' — SSE and API calls back to the same origin only.
// • frame-ancestors 'none' — the API server itself must never be embedded.
//   (Widget iframes are served from a SEPARATE origin — the widget asset
//    server — so this directive does NOT break the widget sandbox.)
//
// The API docs page (`GET /api/docs`) loads Swagger UI from a CDN and needs
// its own, more permissive CSP — it sets that itself, overriding this
// default (see `routes/openapi.ts`). It is not model-authored content and is
// explicitly a read-only reference page.
// ────────────────────────────────────────────────────────────────

import type { NextFunction, Request, Response } from 'express';

/**
 * CSP hash-source for `apps/web/index.html`'s inline theme-flash-prevention
 * script. `sha256-<base64 digest>` computed over the EXACT text between
 * `<script>` and `</script>` (CRLF line endings included, matching the
 * checked-in file — CSP hashes are byte-exact). If that script's content ever
 * changes, this constant must be regenerated or the CSP will silently block
 * it, reintroducing the theme flash rather than breaking the page.
 */
export const THEME_SCRIPT_CSP_HASH = 'sha256-BQvRuMaCC1KXd/oQ2/DaWqL9fxp/Evdu7lSis8R+8hQ=';

export function createCspMiddleware() {
  const header = [
    "default-src 'self'",
    `script-src 'self' '${THEME_SCRIPT_CSP_HASH}'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('Content-Security-Policy', header);
    next();
  };
}
