// ────────────────────────────────────────────────────────────────
// Express App Factory — creates and configures the Express app
// ────────────────────────────────────────────────────────────────

import express from 'express';
import type { Express, Request } from 'express';
import type { IncomingMessage } from 'http';
import type { Container } from './composition-root.js';
import { reachableOrigins } from './network/reachableOrigins.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { requestMetricsMiddleware } from './middleware/requestMetrics.js';
import { createCorsMiddleware } from './middleware/cors.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { createRateLimitMiddleware } from './middleware/rateLimit.js';
import { createErrorMiddleware } from './middleware/errorHandler.js';
import { createStaticFilesMiddleware } from './middleware/staticFiles.js';
import { createApiRouter } from './routes/index.js';
import { createInternalBrowserRoutes } from './routes/internal-browser.js';
import { createInternalDesktopRoutes } from './routes/internal-desktop.js';

/**
 * Creates an Express application wired with all middleware and routes.
 *
 * Middleware order:
 * 1. Request ID (assigns/propagates x-request-id)
 * 2. CORS (configured from AppConfig)
 * 3. JSON body parser
 * 4. URL-encoded parser
 * 5. API routes
 * 6. Static file serving (production only)
 * 7. Error handling middleware (must be last)
 */
export function createApp(container: Container): Express {
  const app = express();

  // 1. Request ID middleware
  app.use(requestIdMiddleware);

  // 1b. Request metrics (OTel) — must be after requestId, before routes
  app.use(requestMetricsMiddleware);

  // 2. CORS middleware
  //
  // The widget-asset origin is appended here rather than being baked into the
  // AppConfig default because it is a RUNTIME port: the desktop shell picks an
  // ephemeral one per launch and passes it via WIDGET_ORIGIN/WIDGET_PORT. It
  // has to be allowed because widget iframes are served from that separate
  // origin and fetch the API cross-origin. De-duplicated so an operator who
  // already lists it in CORS_ORIGINS doesn't get it twice.
  const widgetOrigin =
    process.env['WIDGET_ORIGIN'] ?? `http://127.0.0.1:${process.env['WIDGET_PORT'] ?? '3101'}`;
  const corsOrigins = [
    ...new Set([
      ...container.config.security.corsOrigins,
      widgetOrigin,
      ...reachableOrigins(container),
    ]),
  ];
  app.use(createCorsMiddleware({ origins: corsOrigins }));

  // 3+4. Body parsers.
  //
  // SEC-03 — explicit upper bounds on payload + query param count:
  //   - JSON body limit defaults to 2 MB (cover realistic prompts with
  //     attachments inline; larger payloads should stream to the uploads
  //     route, which has its own multer-scoped limit). Configurable via
  //     `GENERATORAI_JSON_BODY_LIMIT` — kept as an env because raising it
  //     is an operational trade-off that shouldn't require a code change.
  //   - URL-encoded limit is tighter (1 MB): nothing we accept uses large
  //     urlencoded bodies. `parameterLimit: 100` rejects pathological query
  //     parameter counts (default Express is 1000, which is a DoS vector).
  //   - Both parsers return 413 Payload Too Large on overflow via the
  //     default error handler.
  //
  // The webhook route captures `rawBody` via the verify hook for HMAC
  // signature verification — preserved exactly so SEC-12 still works.
  const jsonBodyLimit = process.env['GENERATORAI_JSON_BODY_LIMIT'] ?? '2mb';
  const urlencodedBodyLimit = process.env['GENERATORAI_URLENCODED_LIMIT'] ?? '1mb';
  app.use(express.json({
    limit: jsonBodyLimit,
    verify: (req: IncomingMessage, _res, buf) => {
      // Express's Request extends IncomingMessage; the augmented `rawBody`
      // field (see types/express.d.ts) is consumed by webhook HMAC verification.
      (req as Request).rawBody = buf;
    },
  }));
  app.use(express.urlencoded({
    extended: true,
    limit: urlencodedBodyLimit,
    parameterLimit: 100,
  }));

  // 4b. API auth gate. Resolves a `Principal` for every `/api` request and
  // enforces the route → scope table from `@generatorai/auth`. Routes that are
  // not classified fail CLOSED (they require `admin:settings`). Public routes
  // (health, webhooks, pairing bootstrap) are declared in ROUTE_POLICIES.
  app.use(
    '/api',
    createAuthMiddleware({
      auth: container.security.auth,
      audit: container.security.audit,
      logger: container.logger,
    }),
  );

  // 4c. SEC-07 / API-4 — per-`/api` rate limit. Defaults: 600 req/min per key,
  // 6000 global, in a 60s window. These ceilings are intentionally generous
  // because the web SPA (TanStack Query) fans many independent component
  // queries plus SSE reconnect bursts at the server from a SINGLE user on a
  // localhost trust boundary (no user auth) — a 60/min ceiling produces 429s
  // during normal dashboard use. They cap a runaway client/loop, not abuse by
  // distinct tenants. Tighten via the env vars below when exposing the server
  // beyond localhost (where a real auth/tenant boundary should also be added).
  app.use(
    '/api',
    createRateLimitMiddleware({
      perKeyLimit: parseInt(process.env['GENERATORAI_RATE_LIMIT_PER_KEY'] ?? '', 10) || 600,
      globalLimit: parseInt(process.env['GENERATORAI_RATE_LIMIT_GLOBAL'] ?? '', 10) || 6000,
      windowMs: parseInt(process.env['GENERATORAI_RATE_LIMIT_WINDOW_MS'] ?? '', 10) || 60_000,
      logger: container.logger,
    }),
  );

  // 4d. Internal desktop main → server handshake (scoped CDP endpoint
  // pushes). Deliberately NOT under /api — own auth (bearer token + loopback
  // check), not the API key gate. See routes/internal-browser.ts.
  app.use('/internal/browser', createInternalBrowserRoutes(container));

  // 4e. Internal desktop shell channel — lets the Electron main process mint
  // a pairing grant for its own renderer. Same loopback + per-launch-token
  // guard; see routes/internal-desktop.ts for why this is not a backdoor.
  app.use('/internal/desktop', createInternalDesktopRoutes(container));

  // 5. API routes
  app.use('/api', createApiRouter(container));

  // 6. Static files (production only)
  app.use(createStaticFilesMiddleware());

  // 7. Error handling (must be last)
  app.use(createErrorMiddleware(container.logger));

  return app;
}
