// ────────────────────────────────────────────────────────────────
// /api/auth — device pairing, sessions, and device administration
//
// Bootstrap endpoints (`/pair/complete`, `/token/refresh`, `/nonce`,
// `/server-info`) are PUBLIC in the route policy: a device that is pairing has
// no credential yet, and the single-use pairing grant IS the credential.
// Everything else requires `admin:devices`.
// ────────────────────────────────────────────────────────────────

import { Router, type Request, type Response } from 'express';
import * as os from 'node:os';
import { z } from 'zod';
import type {
  DpopVerifier} from '@generatorai/auth';
import {
  ALL_SCOPES,
  AuditAction,
  DEFAULT_CLI_SCOPES,
  DEFAULT_DEVICE_SCOPES,
  DEFAULT_MOBILE_SCOPES,
  DpopError,
  isNonceChallenge,
  HIGH_RISK_SCOPES,
  PairingError,
  SCOPES,
  isScope,
  normalizeScopes,
  type DevicePlatform,
  type DeviceRecord,
  type Principal,
  type Scope,
} from '@generatorai/auth';
import { PairingOfferSchema, encodePairingOffer, pairingOfferUrl } from '@generatorai/relay-protocol';
import { formatPairingCode } from '@generatorai/shared';
import { dirname, resolve } from 'node:path';
import type { Container } from '../composition-root.js';
import { removeBootstrapFile } from '../composition/bootstrapPairing.js';
import { isLoopbackRequest } from '../middleware/auth.js';
import {
  resolveAdvertisedEndpoints,
  selectPairingEndpoint,
  type AdvertisedEndpointCandidate,
} from '../network/advertisedEndpoints.js';

const PLATFORMS = ['web', 'desktop', 'cli', 'mobile', 'other'] as const;

const createPairingSchema = z.object({
  deviceName: z.string().min(1).max(64),
  platform: z.enum(PLATFORMS).default('other'),
  scopes: z.array(z.string()).optional(),
  ttlMs: z.number().int().min(30_000).max(10 * 60_000).optional(),
  /** Include a relay invite so the device can connect off-LAN. */
  includeRelay: z.boolean().default(false),
});

// Lower bound is 12 so the human-typeable pairing code is accepted; the
// generous upper bound still admits the legacy 43-char opaque grants.
const pairingTokenSchema = z.string().min(12).max(512);

const previewPairingSchema = z.object({
  pairingToken: pairingTokenSchema,
});

const completePairingSchema = z.object({
  pairingToken: pairingTokenSchema,
  publicJwk: z.object({
    kty: z.string(),
    crv: z.string().optional(),
    x: z.string().optional(),
    y: z.string().optional(),
    n: z.string().optional(),
    e: z.string().optional(),
    alg: z.string().optional(),
    kid: z.string().optional(),
    use: z.string().optional(),
  }).strict(),
  deviceName: z.string().min(1).max(64).optional(),
  platform: z.enum(PLATFORMS).optional(),
  connectionMode: z.enum(['loopback', 'lan', 'ssh', 'relay', 'auto']).optional(),
});

const refreshSchema = z.object({
  resumeSecret: z.string().min(16).max(512),
});

const renameSchema = z.object({ name: z.string().min(1).max(64) });
const scopesSchema = z.object({ scopes: z.array(z.string()).max(SCOPES.length) });
const revokeSchema = z.object({ reason: z.string().min(1).max(200).default('revoked by operator') });

/**
 * Push registration.
 *
 * Bounded on every field: the token is opaque and attacker-supplied from the
 * server's point of view, and an unbounded string here would be stored and
 * later sent to a third-party push service.
 */
const pushTokenSchema = z.object({
  provider: z.enum(['expo', 'apns', 'fcm']),
  token: z.string().min(1).max(512),
  platform: z.string().min(1).max(32),
});

const muteSchema = z.object({
  /** Epoch ms, or null to unmute. */
  mutedUntil: z.number().int().positive().nullable(),
});

export function createAuthRoutes(container: Container): Router {
  const router = Router();
  const { devices, tokens, dpop, audit, posture, identity } = container.security;
  const logger = container.logger;

  // ── Public bootstrap ─────────────────────────────────────────────

  /**
   * Server identity + capabilities. Deliberately reveals nothing secret: the
   * token public JWK is the *verification* key, and the fingerprint is what a
   * pairing QR pins so a client can detect a substituted host.
   */
  router.get('/server-info', (_req: Request, res: Response) => {
    const endpoints = advertisedEndpoints(container);
    res.json({
      issuer: 'generatorai',
      audience: posture.tokenAudience,
      /** Ed25519 JWS verification key for access tokens — safe to publish. */
      tokenPublicJwk: tokens.publicJwk(),
      /** X25519 host identity that paired clients pin. */
      serverId: identity.hostId,
      serverPublicKey: identity.publicKeyBase64Url,
      serverName: serverDisplayName(),
      protocolVersion: 2,
      authentication: {
        required: posture.authenticationRequired,
        dpopRequired: true,
        legacyApiKeyAccepted: posture.legacyApiKeyActive,
      },
      transports: {
        loopback: endpoints.some((endpoint) => endpoint.reachability === 'loopback'),
        lan: endpoints.some((endpoint) => endpoint.reachability === 'lan'),
        privateNetwork: endpoints.some((endpoint) => endpoint.reachability === 'private-network'),
        relay: false,
      },
      endpoints,
      scopes: SCOPES,
    });
  });

  /** Issues a DPoP nonce for clients whose clock is outside the skew window. */
  router.post('/nonce', (_req: Request, res: Response) => {
    void (async () => {
      const nonce = await dpop.issueNonce();
      res.set('DPoP-Nonce', nonce).status(204).end();
    })();
  });

  /**
   * Completes pairing. The caller proves possession of the device key with a
   * DPoP proof over THIS request, so a stolen pairing token alone is not
   * enough — the attacker would also need the private key they never had.
   */
  router.post('/pair/complete', (req: Request, res: Response) => {
    void (async () => {
      const parsed = completePairingSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
        return;
      }

      // Bind the proof to the exact request. The thumbprint proven here MUST
      // equal the thumbprint of the JWK being registered.
      let provenThumbprint: string;
      try {
        const result = await dpop.verify({
          proof: req.headers['dpop'],
          method: 'POST',
          url: absoluteUrl(req),
        });
        provenThumbprint = result.thumbprint;
      } catch (err) {
        const code = err instanceof DpopError ? err.code : 'INVALID_PROOF';
        if (err instanceof DpopError && isNonceChallenge(err.code)) {
          res.set('DPoP-Nonce', await dpop.issueNonce());
        }
        res.status(401).json({
          error: { code, message: err instanceof Error ? err.message : 'DPoP proof required' },
        });
        return;
      }

      try {
        const session = await devices.completePairing({
          pairingToken: parsed.data.pairingToken,
          publicJwk: parsed.data.publicJwk,
          ...(parsed.data.deviceName ? { deviceName: parsed.data.deviceName } : {}),
          ...(parsed.data.platform ? { platform: parsed.data.platform } : {}),
          ...(parsed.data.connectionMode ? { connectionMode: parsed.data.connectionMode } : {}),
          sourceAddress: req.socket.remoteAddress ?? null,
          requestId: req.requestId,
        });

        // Defence in depth: the DeviceService already checks this, but a
        // mismatch here would mean a device registered a key it cannot prove.
        const registered = await devices.getDevice(session.deviceId);
        if (!registered || registered.jwkThumbprint !== provenThumbprint) {
          await devices.revokeDevice(
            session.deviceId,
            'pairing proof key mismatch',
            systemPrincipal(),
          );
          res.status(401).json({
            error: {
              code: 'PROOF_KEY_MISMATCH',
              message: 'The DPoP proof key does not match the registered device key.',
            },
          });
          return;
        }

        // The server is now claimed, so the first-run bootstrap credential
        // must not survive on disk. Best effort: the grant behind it has been
        // consumed regardless, so a leftover file is inert.
        removeBootstrapFile(dirname(resolve(container.config.dbPath)));

        res.status(201).json(session);
      } catch (err) {
        handlePairingError(err, res, logger);
      }
    })();
  });

  /**
   * Resolves what a pairing code grants, without consuming it.
   *
   * The QR flow carries the requested scopes inside the offer payload, so the
   * joining device can render a consent screen offline. A 12-character typed
   * code cannot carry them, so it asks here instead. Without this, typing a
   * code would mean consenting to permissions the user was never shown.
   *
   * Public by necessity (the caller has no credential yet) and safe: the
   * response contains no credential and no grant id, the grant is not
   * consumed, and every rejection returns one indistinguishable error so the
   * route cannot be used to probe which codes exist.
   */
  router.post('/pair/preview', (req: Request, res: Response) => {
    void (async () => {
      const parsed = previewPairingSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
        return;
      }

      try {
        const preview = await devices.previewPairingGrant({
          pairingToken: parsed.data.pairingToken,
          sourceAddress: req.socket.remoteAddress ?? null,
          requestId: req.requestId,
        });
        res.json({
          serverId: identity.hostId,
          serverPublicKey: identity.publicKeyBase64Url,
          serverName: serverDisplayName(),
          endpoints: advertisedEndpoints(container),
          ...preview,
        });
      } catch (err) {
        handlePairingError(err, res, logger);
      }
    })();
  });

  /**
   * Exchanges a resume credential for a fresh access token. Rotates the
   * resume credential on every use, and requires a DPoP proof from the same
   * device key — a leaked resume secret alone is unusable.
   */
  router.post('/token/refresh', (req: Request, res: Response) => {
    void (async () => {
      const parsed = refreshSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
        return;
      }

      let thumbprint: string;
      try {
        const result = await dpop.verify({
          proof: req.headers['dpop'],
          method: 'POST',
          url: absoluteUrl(req),
        });
        thumbprint = result.thumbprint;
      } catch (err) {
        if (err instanceof DpopError && isNonceChallenge(err.code)) {
          res.set('DPoP-Nonce', await dpop.issueNonce());
        }
        res.status(401).json({
          error: {
            code: err instanceof DpopError ? err.code : 'INVALID_PROOF',
            message: 'A valid DPoP proof is required to refresh a session.',
          },
        });
        return;
      }

      try {
        const session = await devices.refreshSession({
          resumeSecret: parsed.data.resumeSecret,
          keyThumbprint: thumbprint,
          transport: isLoopbackRequest(req) ? 'loopback' : 'lan',
        });
        res.json(session);
      } catch (err) {
        handlePairingError(err, res, logger);
      }
    })();
  });

  // ── Administrative (requires admin:devices) ──────────────────────

  /** Creates (or rotates) a pairing grant and returns the QR-ready offer. */
  router.post('/pair', (req: Request, res: Response) => {
    void (async () => {
      const parsed = createPairingSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
        return;
      }
      const principal = requirePrincipal(req);
      const platform = parsed.data.platform as DevicePlatform;
      const requestedScopes = parsed.data.scopes
        ? normalizeScopes(parsed.data.scopes)
        : defaultScopesFor(platform);

      try {
        if (parsed.data.includeRelay) {
          res.status(409).json({
            error: {
              code: 'RELAY_CLIENT_UNAVAILABLE',
              message: 'Relay pairing is unavailable until the client relay transport is enabled.',
            },
          });
          return;
        }

        const endpoints = advertisedEndpoints(container);
        const selectedEndpoint = selectPairingEndpoint(endpoints, platform);
        if (!selectedEndpoint) {
          res.status(409).json({
            error: {
              code: 'NO_REACHABLE_ENDPOINT',
              message:
                'No endpoint is reachable from that device. Enable network access or configure ' +
                'GENERATORAI_ADVERTISED_URLS before generating a mobile pairing code.',
            },
          });
          return;
        }
        const orderedEndpoints = [
          selectedEndpoint,
          ...endpoints.filter((endpoint) => endpoint.origin !== selectedEndpoint.origin),
        ];

        const grant = await devices.createPairingGrant({
          deviceNameHint: parsed.data.deviceName,
          platform,
          requestedScopes,
          createdBy: principal,
          ...(parsed.data.ttlMs ? { ttlMs: parsed.data.ttlMs } : {}),
          relayInvite: null,
        });

        // Validate through the SAME schema clients use to decode. If the host
        // cannot produce a valid offer, that is a server bug — never ship a
        // half-valid offer that a client will reject after scanning.
        const offerResult = PairingOfferSchema.safeParse({
          v: 2,
          endpoint: selectedEndpoint.origin,
          endpoints: orderedEndpoints.map((endpoint, priority) => ({
            origin: endpoint.origin,
            reachability: endpoint.reachability,
            priority,
          })),
          serverId: identity.hostId,
          serverPublicKey: identity.publicKeyBase64Url,
          pairingGrant: grant.pairingToken,
          pairingExpiresAt: grant.expiresAt,
          requestedScopes: grant.requestedScopes,
          transportCapabilities: buildTransportCapabilities(orderedEndpoints),
          serverName: serverDisplayName(),
        });
        if (!offerResult.success) {
          logger.warn('[Auth] Generated pairing offer failed validation', {
            issues: offerResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
          });
          await devices.revokePairingGrant(grant.grantId, principal);
          res.status(500).json({
            error: {
              code: 'INVALID_PAIRING_OFFER',
              message:
                'Could not build a valid pairing offer. Set GENERATORAI_ADVERTISED_URL to a ' +
                'reachable http(s) origin for this server.',
            },
          });
          return;
        }

        res.status(201).json({
          grantId: grant.grantId,
          expiresAt: grant.expiresAt,
          deviceName: grant.deviceNameHint,
          platform: grant.platform,
          requestedScopes: grant.requestedScopes,
          serverId: identity.hostId,
          /**
           * The code a human reads out or types on the joining device, in
           * grouped display form. This is the same secret as the one inside
           * `pairingCode`, not a second credential — redeeming either consumes
           * the one grant.
           */
          shortCode: formatPairingCode(grant.pairingToken),
          /**
           * Where to type it. The joining device only needs this origin and
           * the short code; the offer blob below exists for QR scanning and
           * for clients that cannot reach this server same-origin.
           */
          joinUrl: selectedEndpoint.origin,
          /** Encoded offer — render as a QR code. */
          pairingCode: encodePairingOffer(offerResult.data),
          pairingUrl: pairingOfferUrl(offerResult.data),
        });
      } catch (err) {
        handlePairingError(err, res, logger);
      }
    })();
  });

  router.get('/pair/pending', (_req: Request, res: Response) => {
    void (async () => {
      const pending = await devices.listPendingPairings();
      // Never return `tokenHash` — it is a verifier, not a public identifier.
      res.json({
        pending: pending.map((p) => ({
          grantId: p.grantId,
          deviceName: p.deviceNameHint,
          platform: p.platform,
          requestedScopes: p.requestedScopes,
          createdAt: p.createdAt,
          expiresAt: p.expiresAt,
          attempts: p.attempts,
          maxAttempts: p.maxAttempts,
        })),
      });
    })();
  });

  router.delete('/pair/:grantId', (req: Request, res: Response) => {
    void (async () => {
      await devices.revokePairingGrant(pathParam(req, 'grantId'), requirePrincipal(req));
      res.status(204).end();
    })();
  });

  router.get('/devices', (req: Request, res: Response) => {
    void (async () => {
      const includeRevoked = req.query['includeRevoked'] === 'true';
      const list = await devices.listDevices(includeRevoked);
      res.json({ devices: list.map(toPublicDevice) });
    })();
  });

  router.get('/devices/:deviceId', (req: Request, res: Response) => {
    void (async () => {
      const device = await devices.getDevice(pathParam(req, 'deviceId'));
      if (!device) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Device not found' } });
        return;
      }
      res.json(toPublicDevice(device));
    })();
  });

  router.patch('/devices/:deviceId', (req: Request, res: Response) => {
    void (async () => {
      const parsed = renameSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
        return;
      }
      await devices.renameDevice(pathParam(req, 'deviceId'), parsed.data.name, requirePrincipal(req));
      res.status(204).end();
    })();
  });

  /**
   * Changes a device's scopes. `updateDeviceScopes` refuses to grant beyond
   * the caller's own authority; granting a high-risk scope is audited as
   * critical so terminal/browser/admin grants are always visible.
   */
  router.put('/devices/:deviceId/scopes', (req: Request, res: Response) => {
    void (async () => {
      const parsed = scopesSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
        return;
      }
      const unknown = parsed.data.scopes.filter((s) => !isScope(s));
      if (unknown.length > 0) {
        res.status(400).json({
          error: { code: 'UNKNOWN_SCOPE', message: `Unknown scope(s): ${unknown.join(', ')}` },
        });
        return;
      }
      const principal = requirePrincipal(req);
      try {
        await devices.updateDeviceScopes(
          pathParam(req, 'deviceId'),
          normalizeScopes(parsed.data.scopes),
          principal,
        );
      } catch (err) {
        handlePairingError(err, res, logger);
        return;
      }
      const granted = normalizeScopes(parsed.data.scopes).filter((s) =>
        HIGH_RISK_SCOPES.includes(s),
      );
      if (granted.length > 0) {
        audit.record({
          action: AuditAction.deviceScopesChanged,
          result: 'success',
          principal,
          resourceType: 'device',
          resourceId: pathParam(req, 'deviceId'),
          metadata: { highRiskGranted: granted },
          severity: 'critical',
        });
      }
      res.status(204).end();
    })();
  });

  router.post('/devices/:deviceId/rotate', (req: Request, res: Response) => {
    void (async () => {
      const result = await devices.rotateCredentials(pathParam(req, 'deviceId'), requirePrincipal(req));
      res.json(result);
    })();
  });

  const revokeDeviceHandler = (req: Request, res: Response): void => {
    void (async () => {
      const parsed = revokeSchema.safeParse(req.body ?? {});
      const reason = parsed.success ? parsed.data.reason : 'revoked by operator';
      await devices.revokeDevice(pathParam(req, 'deviceId'), reason, requirePrincipal(req));
      res.status(204).end();
    })();
  };
  router.delete('/devices/:deviceId', revokeDeviceHandler);
  // Alias for clients that cannot send a body with DELETE (and for the
  // mobile app's historical call shape). Same handler, same `/auth/devices`
  // route policy (`admin:devices`), so nothing is gained by choosing it.
  router.post('/devices/:deviceId/revoke', revokeDeviceHandler);

  // ── Push notification registration ───────────────────────────────
  //
  // A device registers its OWN token and nothing else. The device id comes
  // from the authenticated principal, never from the request body: accepting
  // a caller-supplied id would let any paired device redirect another
  // device's notifications to itself.

  router.put('/push-token', (req: Request, res: Response) => {
    void (async () => {
      const parsed = pushTokenSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
        return;
      }

      const principal = requirePrincipal(req);
      if (principal.type !== 'paired-device') {
        // Only a real device has somewhere to deliver a notification.
        res.status(403).json({
          error: { code: 'NOT_A_DEVICE', message: 'Only a paired device can register for push' },
        });
        return;
      }

      if (!container.pushTokens) {
        res.status(501).json({
          error: { code: 'PUSH_DISABLED', message: 'Push notifications are disabled on this server' },
        });
        return;
      }

      container.pushTokens.upsert({
        deviceId: principal.id,
        provider: parsed.data.provider,
        token: parsed.data.token,
        platform: parsed.data.platform,
        now: Date.now(),
      });

      await audit.record({
        action: 'pushTokenRegistered',
        result: 'success',
        principal,
        resourceType: 'device',
        resourceId: principal.id,
        // The token itself is never recorded: it is credential material.
        metadata: { provider: parsed.data.provider, platform: parsed.data.platform },
        severity: 'info',
      });

      res.status(204).end();
    })();
  });

  router.delete('/push-token', (req: Request, res: Response) => {
    void (async () => {
      const principal = requirePrincipal(req);
      container.pushTokens?.remove(principal.id);
      res.status(204).end();
    })();
  });

  /** Mute non-approval notifications until a timestamp. Approvals ignore it. */
  router.put('/push-token/mute', (req: Request, res: Response) => {
    void (async () => {
      const parsed = muteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
        return;
      }
      const principal = requirePrincipal(req);
      container.pushTokens?.setMutedUntil(principal.id, parsed.data.mutedUntil ?? null);
      res.status(204).end();
    })();
  });

  // ── Audit log ────────────────────────────────────────────────────

  router.get('/audit', (req: Request, res: Response) => {
    void (async () => {
      const limit = Math.min(parseInt(String(req.query['limit'] ?? '100'), 10) || 100, 500);
      const filter: Parameters<typeof audit.list>[0] = { limit };
      if (typeof req.query['action'] === 'string') filter.action = req.query['action'];
      if (typeof req.query['deviceId'] === 'string') filter.deviceId = req.query['deviceId'];
      if (typeof req.query['since'] === 'string') {
        const since = parseInt(req.query['since'], 10);
        if (!Number.isNaN(since)) filter.since = since;
      }
      res.json({ events: await audit.list(filter) });
    })();
  });

  return router;
}

// ── Helpers ────────────────────────────────────────────────────────

function toPublicDevice(device: DeviceRecord): Record<string, unknown> {
  // `publicJwk` and `jwkThumbprint` are intentionally omitted from list
  // responses — they are verification material, not UI data.
  return {
    deviceId: device.deviceId,
    ownerId: device.ownerId,
    name: device.name,
    platform: device.platform,
    scopes: device.scopes,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
    lastSeenTransport: device.lastSeenTransport,
    revokedAt: device.revokedAt,
    revokedReason: device.revokedReason,
    credentialVersion: device.credentialVersion,
    connectionMode: device.connectionMode,
    relayBound: device.relayBinding != null,
  };
}

function defaultScopesFor(platform: DevicePlatform): Scope[] {
  switch (platform) {
    case 'mobile':
      return [...DEFAULT_MOBILE_SCOPES];
    case 'cli':
      return [...DEFAULT_CLI_SCOPES];
    default:
      return [...DEFAULT_DEVICE_SCOPES];
  }
}

function requirePrincipal(req: Request): Principal {
  const principal = req.principal;
  if (!principal) {
    // Unreachable: the auth middleware rejects before the handler runs.
    throw new Error('No principal on an authenticated route');
  }
  return principal;
}

function systemPrincipal(): Principal {
  return {
    type: 'internal-service',
    id: 'system',
    displayName: 'System',
    scopes: [...ALL_SCOPES],
    transport: 'embedded',
  };
}

function absoluteUrl(req: Request): string {
  const proto = firstValue(req.headers['x-forwarded-proto']) ?? (req.secure ? 'https' : 'http');
  const host = firstValue(req.headers['host']) ?? 'localhost';
  return `${proto}://${host}${req.originalUrl}`;
}

function firstValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Express 5 types path params as `string | string[]`; we only ever want one. */
function pathParam(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

/**
 * Explicit origins are authoritative. Interface origins are derived only when
 * the server is deliberately bound beyond loopback.
 */
function advertisedEndpoints(container: Container): AdvertisedEndpointCandidate[] {
  const configured = [
    ...(process.env['GENERATORAI_ADVERTISED_URLS']?.split(',') ?? []),
    ...(process.env['GENERATORAI_ADVERTISED_URL'] ? [process.env['GENERATORAI_ADVERTISED_URL']] : []),
  ];
  return resolveAdvertisedEndpoints({
    port: container.config.port,
    bindHost: container.security.posture.bindHost,
    configuredOrigins: configured,
    networkInterfaces: os.networkInterfaces(),
  });
}

function buildTransportCapabilities(endpoints: readonly AdvertisedEndpointCandidate[]): string[] {
  const caps: string[] = [];
  if (endpoints.some((endpoint) => endpoint.reachability === 'loopback')) caps.push('loopback');
  if (endpoints.some((endpoint) => endpoint.reachability !== 'loopback')) caps.push('lan');
  return caps;
}

/** Friendly host label shown on the pairing consent screen. */
function serverDisplayName(): string {
  return (process.env['GENERATORAI_SERVER_NAME'] ?? os.hostname() ?? 'GeneratorAI').slice(0, 120);
}

function handlePairingError(
  err: unknown,
  res: Response,
  logger: { warn(msg: string, meta?: Record<string, unknown>): void },
): void {
  if (err instanceof PairingError) {
    const status =
      err.code === 'SCOPE_ESCALATION' ? 403 : err.code === 'THROTTLED' ? 429 : 400;
    res.status(status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  logger.warn('[Auth] Pairing operation failed', {
    error: err instanceof Error ? err.message : String(err),
  });
  res.status(500).json({
    error: { code: 'PAIRING_FAILED', message: 'The pairing operation could not be completed.' },
  });
}

export type { DpopVerifier };
