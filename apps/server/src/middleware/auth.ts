// ────────────────────────────────────────────────────────────────
// API auth middleware — principal resolution + scope enforcement
//
// Replaces the Phase-0 "one shared bearer key" gate. Every `/api` request now
// resolves to a `Principal` (device, service account, signed link, stream
// ticket, or the dev-only unauthenticated local principal) and is checked
// against the route → scope table in `@generatorai/auth`.
//
// Two hard rules this file exists to enforce:
//   1. An unclassified route fails CLOSED (`DEFAULT_POLICY` demands admin).
//   2. Credentials never appear in logs — we log `req.path`, never `req.url`,
//      and every log payload goes through `redactDeep`.
// ────────────────────────────────────────────────────────────────

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  AuthError,
  AuditAction,
  DPOP_NONCE_HEADER,
  hasAllScopes,
  isLoopbackAddress,
  missingScopes,
  requiredScopesFor,
  type AuthService,
  type SecurityAuditService,
} from '@generatorai/auth';
import { redactDeep } from '@generatorai/secrets';
import type { ILogger } from '@generatorai/shared';

export interface ApiAuthOptions {
  auth: AuthService;
  audit: SecurityAuditService;
  logger: ILogger;
}

/** Absolute URL for DPoP `htu` binding. Must match what the client signed. */
function absoluteUrl(req: Request): string {
  const forwardedProto = firstValue(req.headers['x-forwarded-proto']);
  const proto = forwardedProto ?? (req.secure ? 'https' : 'http');
  const host = firstValue(req.headers['host']) ?? 'localhost';
  return `${proto}://${host}${req.originalUrl}`;
}

function firstValue(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

/**
 * True only for a request that genuinely originated on this machine.
 *
 * Both ends of the socket must be loopback AND the request must carry no
 * evidence of having been forwarded. The socket check alone is not enough: a
 * reverse proxy running on the same host (the Vite dev server proxying `/api`
 * is exactly this) connects loopback-to-loopback, so traffic arriving from
 * anywhere on the network would otherwise be indistinguishable from a local
 * request — and in unauthenticated-loopback mode that means full authority.
 *
 * Any `x-forwarded-for` / `forwarded` header therefore disqualifies the
 * request. This server is only ever loopback-bound when unauthenticated mode
 * is permitted at all, so there is no legitimate trusted proxy in front of it
 * whose headers we would want to honour instead.
 */
export function isLoopbackRequest(req: {
  socket: { remoteAddress?: string | undefined; localAddress?: string | undefined };
  headers?: Record<string, string | string[] | undefined>;
}): boolean {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false;
  if (!isLoopbackAddress(req.socket.localAddress)) return false;

  const headers = req.headers ?? {};
  const forwardedFor = firstValue(headers['x-forwarded-for'] as string | string[] | undefined);
  if (forwardedFor) {
    // Only the left-most entry is the real client; the rest are proxies.
    const client = forwardedFor.split(',')[0]?.trim();
    if (!isLoopbackAddress(client)) return false;
  }
  if (headers['forwarded'] !== undefined) return false;

  return true;
}

export function createAuthMiddleware(options: ApiAuthOptions): RequestHandler {
  const { auth, audit, logger } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    // `req.path` is already `/api`-relative because the middleware is mounted
    // on `/api`, and it is query-string free.
    const apiPath = req.path;
    const { policy, scopes } = requiredScopesFor(req.method, apiPath);

    if (policy.public) {
      next();
      return;
    }

    void (async () => {
      try {
        // `/api/stream` is the only ticket-redeeming endpoint, and the ticket
        // must match the exact subscription it was minted for.
        const isStreamSubscription = apiPath === '/stream' || apiPath === '/stream/';
        // W09-a — `?c=` is the multiplexed form. Its ticket is bound to the
        // CONNECTION, not to a scope: the subscriptions are authorised
        // individually as they are added, so the ticket can never widen access
        // even though it names no scope of its own (N-12).
        const muxConnectionId =
          isStreamSubscription && typeof req.query['c'] === 'string' && req.query['c'].length > 0
            ? req.query['c']
            : null;
        const streamScope = !isStreamSubscription
          ? undefined
          : muxConnectionId
            ? { scope: 'connection', id: muxConnectionId }
            : {
                scope: String(req.query['scope'] ?? ''),
                id:
                  String(req.query['scope'] ?? '') === 'global'
                    ? 'all'
                    : typeof req.query['id'] === 'string'
                      ? req.query['id']
                      : null,
              };

        const principal = await auth.authenticate({
          method: req.method,
          url: absoluteUrl(req),
          headers: req.headers as Record<string, string | string[] | undefined>,
          query: req.query as Record<string, string | string[] | undefined>,
          remoteAddress: req.socket.remoteAddress,
          requestId: req.requestId,
          isLoopback: isLoopbackRequest(req),
          allowStreamTicket: isStreamSubscription,
          streamScope,
        });

        if (!hasAllScopes(principal.scopes, scopes)) {
          const missing = missingScopes(principal.scopes, scopes);
          audit.record({
            action: AuditAction.authDenied,
            result: 'denied',
            principal,
            resourceType: 'route',
            resourceId: `${req.method} ${apiPath}`,
            reasonCode: 'INSUFFICIENT_SCOPE',
            requestId: req.requestId,
            sourceAddress: req.socket.remoteAddress ?? null,
            metadata: { required: scopes, missing },
            severity: policy.riskLevel === 'high' ? 'critical' : 'warn',
          });
          res
            .status(403)
            .set('WWW-Authenticate', `DPoP error="insufficient_scope", scope="${scopes.join(' ')}"`)
            .json({
              error: {
                code: 'INSUFFICIENT_SCOPE',
                message: `This credential is missing required scope(s): ${missing.join(', ')}`,
                requiredScopes: scopes,
                requestId: req.requestId,
              },
            });
          return;
        }

        req.principal = principal;
        // Back-compat for the handful of routes still reading `req.apiKey`.
        if (principal.type === 'service-account') req.apiKey = principal.id;
        next();
      } catch (err) {
        if (err instanceof AuthError) {
          if (err.nonce) res.set(DPOP_NONCE_HEADER, err.nonce);
          logger.warn('[Auth] Unauthorized request', {
            requestId: req.requestId,
            // NEVER log req.url / req.originalUrl — they carry ?ticket= / ?apiKey=.
            path: apiPath,
            method: req.method,
            code: err.code,
          });
          res.status(err.status).set('WWW-Authenticate', wwwAuthenticate(err)).json({
            error: {
              code: err.code,
              message: err.message,
              requestId: req.requestId,
            },
          });
          return;
        }
        logger.error('[Auth] Authentication failed unexpectedly', {
          requestId: req.requestId,
          path: apiPath,
          error: redactDeep(err instanceof Error ? err.message : String(err)),
        });
        res.status(500).json({
          error: {
            code: 'AUTH_INTERNAL_ERROR',
            message: 'Authentication could not be completed.',
            requestId: req.requestId,
          },
        });
      }
    })();
  };
}

function wwwAuthenticate(err: AuthError): string {
  if (err.code === 'NONCE_REQUIRED') {
    return 'DPoP error="use_dpop_nonce", error_description="Authorization server requires nonce in DPoP proof"';
  }
  if (err.code === 'MISSING_CREDENTIAL') return 'DPoP';
  return `DPoP error="invalid_token", error_description="${err.code}"`;
}
