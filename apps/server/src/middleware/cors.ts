// ────────────────────────────────────────────────────────────────
// CORS Middleware — configurable CORS based on AppConfig
// ────────────────────────────────────────────────────────────────

import cors from 'cors';
import type { RequestHandler } from 'express';

export interface CorsConfig {
  origins?: string[];
}

/**
 * SEC-02 — Creates CORS middleware allowing specified origins.
 *
 * Security rules enforced at construction time (fail-fast, not per-request):
 *   1. `credentials: true` is ALWAYS set — we send session-bearing headers
 *      (Authorization, cookies if ever added). Browsers refuse to honour
 *      `Access-Control-Allow-Credentials: true` alongside
 *      `Access-Control-Allow-Origin: *`. Configuring `'*'` here would:
 *         (a) fail silently in browsers (requests work, responses are dropped),
 *         (b) give a false sense that everything is cross-origin-safe,
 *         (c) create a real CSRF risk the moment cookies land in this app.
 *      → We THROW at startup if any origin in the allowlist is `'*'`.
 *   2. Production (`NODE_ENV=production`) additionally REQUIRES an explicit
 *      allowlist. Leaving dev defaults in prod would permit Vite dev-server
 *      origins against a production server — broken prod, but the kind of
 *      broken that bypasses review.
 *
 * Defaults (development only): common Vite ports on localhost.
 */
export function createCorsMiddleware(config?: CorsConfig): RequestHandler {
  const configured = config?.origins;
  const isProd = process.env['NODE_ENV'] === 'production';

  if (isProd && (!configured || configured.length === 0)) {
    throw new Error(
      'CORS misconfiguration: NODE_ENV=production requires an explicit ' +
        '`security.corsOrigins` allowlist. Configure one or unset NODE_ENV.',
    );
  }

  // `localhost` and `127.0.0.1` are DIFFERENT origins to a browser even
  // though they resolve to the same host, so both spellings of each Vite
  // port have to be listed. Omitting the loopback-IP form meant opening the
  // dev UI at http://127.0.0.1:5173 — which is what the Vite banner prints
  // on some setups, and what any tooling that avoids the localhost DNS
  // lookup uses — failed every API call with an opaque CORS error.
  const allowedOrigins = configured ?? [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5174',
    'http://localhost:5175',
    'http://127.0.0.1:5175',
    'http://localhost:5176',
    'http://127.0.0.1:5176',
    // Expo web preview (`pnpm --filter @generatorai/mobile web`). Metro
    // defaults to 8081 and steps to 8082 when that is taken, so both are
    // listed — the mobile app runs on a different origin from the SPA and
    // otherwise fails every API call with an opaque CORS error, which looks
    // identical to "the server is down".
    'http://localhost:8081',
    'http://127.0.0.1:8081',
    'http://localhost:8082',
    'http://127.0.0.1:8082',
    // Dedicated widget-asset origin — widget iframes served here may fetch
    // the API cross-origin. Both loopback spellings are listed because the
    // iframe adopts whichever hostname the host page uses (Chrome aborts a
    // `localhost` page framing a `127.0.0.1` document).
    process.env['WIDGET_ORIGIN'] ??
      `http://127.0.0.1:${process.env['WIDGET_PORT'] ?? '3101'}`,
    `http://localhost:${process.env['WIDGET_PORT'] ?? '3101'}`,
    `http://127.0.0.1:${process.env['WIDGET_PORT'] ?? '3101'}`,
  ];

  // SEC-02 — hard-fail on the `credentials:true` + `*` combination.
  if (allowedOrigins.includes('*')) {
    throw new Error(
      "CORS misconfiguration: wildcard origin '*' is incompatible with " +
        "credentials:true. Browsers reject this combination and it creates " +
        'a CSRF risk. Replace `*` in `security.corsOrigins` with explicit ' +
        'origin URLs (e.g. "https://app.example.com").',
    );
  }

  return cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (same-origin, curl, server-to-server).
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    // `DPoP` carries the proof-of-possession JWT. It is a non-simple header,
    // so without it here every cross-origin request (a paired browser talking
    // to a remote server, the Vite dev proxy bypass, a mobile web build) fails
    // at preflight before it ever reaches the auth middleware.
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'DPoP',
      'x-request-id',
      'Last-Event-ID',
    ],
    // P0#5 — expose pagination metadata so the chat UI can drive "load older"
    // without a second round-trip.
    //
    // `DPoP-Nonce` and `WWW-Authenticate` must be readable by client JS: the
    // runtime retries with the server-supplied nonce when the two clocks
    // disagree, and cannot do that if the browser hides the header.
    exposedHeaders: [
      'x-request-id',
      'X-Total-Count',
      'X-Has-More',
      'X-Page-Offset',
      'X-Page-Limit',
      'DPoP-Nonce',
      'WWW-Authenticate',
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    maxAge: 86400,
  });
}
