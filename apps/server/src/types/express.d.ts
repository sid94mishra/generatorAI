// ────────────────────────────────────────────────────────────────
// Express type augmentations
// ────────────────────────────────────────────────────────────────

import 'express';
import type { Principal } from '@generatorai/auth';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      /**
       * Populated by the auth middleware when an API key was validated.
       * Undefined when auth is disabled (GENERATORAI_API_KEY not set) or
       * for exempt endpoints (/health, /webhooks/*).
       *
       * @deprecated Use `req.principal` — the global API key is a legacy
       * service-account credential and will be removed.
       */
      apiKey?: string;
      /**
       * The authenticated caller. Always set for non-public `/api` routes;
       * the middleware rejects the request before the handler runs otherwise.
       */
      principal?: Principal;
      /**
       * Raw request body bytes captured by the JSON body-parser `verify` hook.
       * Used by webhook HMAC signature verification, which must hash the exact
       * bytes received (not the re-serialized parsed object).
       */
      rawBody?: Buffer;
      /**
       * Zod-validated query params, populated by the `validate()` middleware
       * when a query schema is supplied. Shape varies per route; routes narrow
       * it to their own schema's inferred type.
       */
      validatedQuery?: unknown;
      /**
       * Zod-validated path params, populated by the `validate()` middleware
       * when a params schema is supplied. Shape varies per route.
       */
      validatedParams?: unknown;
    }
  }
}
