// ────────────────────────────────────────────────────────────────
// Internal desktop routes — the Electron shell's privileged back channel.
//
// The desktop renderer is the ordinary web SPA and pairs like any other
// client. But it cannot *ask* for a pairing code, because minting one needs
// `admin:devices` — the very credential it is trying to obtain.
//
// The Electron main process breaks that loop: it is co-resident with the
// server, it started the server, and it holds a random per-launch handshake
// token that exists only in those two process memories. So it is allowed to
// mint a pairing grant for its own renderer.
//
// This is NOT a general admin backdoor:
//   * loopback only (both ends of the socket)
//   * requires the per-launch token (never written to disk, rotated on every
//     app start, and redacted from logs)
//   * only ever returns *pairing* material, never a token or a device secret
//   * the grant is still single-use, short-lived and fully audited
//
// Mounted at `/internal/desktop`, outside the `/api` surface, so it can never
// be reached by a stream ticket, signed link, or any `/api` credential.
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { hostname } from 'node:os';
import { ALL_SCOPES } from '@generatorai/auth';
import { PairingOfferSchema, encodePairingOffer, pairingOfferUrl } from '@generatorai/relay-protocol';
import { formatPairingCode } from '@generatorai/shared';
import type { Container } from '../composition-root.js';
import { isLoopbackRequest } from '../middleware/auth.js';
import { createRateLimitMiddleware } from '../middleware/rateLimit.js';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Rate limit for the pairing mint. `/api` has its own limiter in app.ts; this
 * prefix is mounted outside `/api` and used to have none, so a compromised
 * renderer that found a way past the shell could mint all-scope grants as
 * fast as it liked. One real caller mints once per launch; a handful per
 * minute is generous.
 */
export interface InternalDesktopRateLimit {
  perKeyLimit: number;
  globalLimit: number;
  windowMs: number;
}

// NOTE: deliberately NOT `as const` — that would type this object's fields as
// the literal numbers 10/20/60000, and a caller (tests included) overriding
// with a different budget — e.g. `{ perKeyLimit: 3, ... }` — would fail to
// typecheck against `typeof INTERNAL_DESKTOP_RATE_LIMIT` even though any
// `number` is functionally valid here (see `RateLimitOptions`).
export const INTERNAL_DESKTOP_RATE_LIMIT: InternalDesktopRateLimit = { perKeyLimit: 10, globalLimit: 20, windowMs: 60_000 };

export function createInternalDesktopRoutes(
  container: Container,
  rateLimit: InternalDesktopRateLimit = INTERNAL_DESKTOP_RATE_LIMIT,
): Router {
  const router = Router();
  const { logger } = container;

  router.use(createRateLimitMiddleware({ ...rateLimit, logger }));

  router.use((req, res, next) => {
    if (!isLoopbackRequest(req)) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Loopback only' } });
      return;
    }
    const authHeader = req.headers.authorization ?? '';
    const provided = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';
    // Two credentials, one authority: the Electron shell's in-memory handshake
    // token, and the mode-0600 file that proves the caller is the OS user who
    // owns this server. The second exists so losing every admin device is
    // recoverable from the machine itself rather than being terminal.
    const accepted = [
      process.env['GENERATORAI_DESKTOP_ADMIN_TOKEN'],
      container.localAdminToken,
    ].filter((value): value is string => typeof value === 'string' && value.length > 0);

    if (!provided || !accepted.some((expected) => safeEqual(provided, expected))) {
      // Deliberately terse: a probing attacker learns nothing about whether
      // the feature is enabled or the token was merely wrong.
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or missing token' } });
      return;
    }
    next();
  });

  /**
   * Mints a pairing grant for the desktop renderer.
   *
   * Returns the same encoded offer a QR code would carry, so the renderer
   * runs the byte-identical pairing path as a phone or a remote browser —
   * there is no privileged "desktop-only" auth flow to get wrong.
   */
  router.post('/pairing', (req, res) => {
    void (async () => {
      try {
        const grant = await container.security.devices.createPairingGrant({
          deviceNameHint:
            typeof req.body?.deviceName === 'string' && req.body.deviceName.length > 0
              ? String(req.body.deviceName).slice(0, 64)
              : 'GeneratorAI Desktop',
          platform: 'desktop',
          requestedScopes: [...ALL_SCOPES],
          createdBy: {
            type: 'internal-service',
            id: 'desktop-shell',
            displayName: 'Electron desktop shell',
            scopes: [...ALL_SCOPES],
            transport: 'loopback',
          },
          ttlMs: 5 * 60_000,
          relayInvite: null,
        });

        const offer = PairingOfferSchema.parse({
          v: 1,
          endpoint: `http://127.0.0.1:${container.config.port}`,
          serverId: container.security.identity.hostId,
          serverPublicKey: container.security.identity.publicKeyBase64Url,
          pairingGrant: grant.pairingToken,
          pairingExpiresAt: grant.expiresAt,
          requestedScopes: grant.requestedScopes,
          transportCapabilities: ['loopback'],
          serverName: process.env['GENERATORAI_SERVER_NAME'] ?? `GeneratorAI (${hostname()})`,
        });

        res.status(201).json({
          pairingCode: encodePairingOffer(offer),
          pairingUrl: pairingOfferUrl(offer),
          // The recovery path is a human reading this off a terminal, so the
          // typeable form has to be here too, not only inside the offer blob.
          shortCode: formatPairingCode(grant.pairingToken),
          expiresAt: grant.expiresAt,
        });
      } catch (err) {
        logger.warn('[InternalDesktop] Could not mint a desktop pairing grant', {
          error: err instanceof Error ? err.message : String(err),
        });
        res.status(500).json({
          error: { code: 'PAIRING_FAILED', message: 'Could not create a pairing grant.' },
        });
      }
    })();
  });

  return router;
}
