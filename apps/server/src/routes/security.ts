// ────────────────────────────────────────────────────────────────
// /api/security — posture, secret-backend diagnostics, relay status.
//
// This exists because of the plan's "make security behaviour observable" rule
// (§32.15): a user must be able to see which secret backend, transport, host
// identity and scopes are actually in effect — not guess from documentation.
//
// Read is `read:status`; anything that changes state requires `admin:settings`
// (see ROUTE_POLICIES). No endpoint here ever returns secret material.
//
// F-6 (D-120): `read:status` is held by every device, so the reads answer it
// with a `limited` view. Configuration detail that maps or fingerprints the
// host — bind address, secret backend, legacy key, every address, the
// certificate's names, proxy trust, warnings — is for `admin:settings`.
// ────────────────────────────────────────────────────────────────

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { dirname, resolve } from 'node:path';
import { SCOPES, type Principal } from '@generatorai/auth';
import type { NetworkAccess, SecurityPosture } from '@generatorai/shared';
import type { Container } from '../composition-root.js';
import { serverEndpoints } from '../network/serverEndpoints.js';
import { trustProxyPolicy } from '../network/requestOrigin.js';
import { limitedTailscaleStatus } from '../network/tailscale/TailscaleAccess.js';
import { CustomCertificateError, MAX_CERTIFICATE_PEM_BYTES, MAX_KEY_PEM_BYTES } from '../network/tls/customCertificate.js';
import {
  describeExposurePreconditions,
  readExposureMode,
  writeExposureMode,
} from '../network/exposure.js';

const networkAccessSchema = z.object({
  mode: z.enum(['local-only', 'network-accessible']),
});

/** `POST /security/tailscale` — turn "Connect with Tailscale" on or off (D-123). */
const tailscaleSchema = z.object({
  enabled: z.boolean(),
  /** Replace another app's Tailscale Serve handler on 443 (the status names it). */
  replace: z.boolean().optional(),
});

/** `PUT /security/tls/certificate` — a PEM certificate (chain allowed) and its unencrypted key (D-113). */
const customCertificateSchema = z.object({
  certificatePem: z.string().min(1).max(MAX_CERTIFICATE_PEM_BYTES),
  privateKeyPem: z.string().min(1).max(MAX_KEY_PEM_BYTES),
});

export function createSecurityRoutes(container: Container): Router {
  const router = Router();
  const { posture, identity, secretStore, deviceRepo } = container.security;

  /** Effective security posture. Safe to render in the settings UI. */
  router.get('/posture', (req: Request, res: Response) => {
    void (async () => {
      const limited: SecurityPosture = {
        detail: 'limited',
        server: { hostId: identity.hostId, loopbackOnly: posture.loopbackOnly },
        authentication: { required: posture.authenticationRequired, dpopRequired: true },
        relay: { enabled: posture.relayEnabled, clientAvailable: false },
        scopes: SCOPES,
      };
      if (!seesSecurityDetail(req.principal)) {
        res.json(limited);
        return;
      }
      const backend = await secretStore.backendInfo();
      const devices = await deviceRepo.list();
      const active = devices.filter((d) => d.revokedAt == null);
      const full: SecurityPosture = {
        detail: 'full',
        server: {
          hostId: identity.hostId,
          bindHost: posture.bindHost,
          loopbackOnly: posture.loopbackOnly,
          production: posture.production,
          tokenAudience: posture.tokenAudience,
        },
        authentication: {
          required: posture.authenticationRequired,
          unauthenticatedLoopback: posture.unauthenticatedLoopback,
          legacyApiKeyActive: posture.legacyApiKeyActive,
          dpopRequired: true,
        },
        secretStore: {
          kind: backend.kind,
          secure: backend.secure,
          reason: backend.reason ?? null,
          supportsRotation: backend.supportsRotation,
        },
        devices: {
          active: active.length,
          revoked: devices.length - active.length,
          relayBound: active.filter((d) => d.relayBinding != null).length,
        },
        relay: {
          enabled: posture.relayEnabled,
          clientAvailable: false,
          state: container.relayHostBroker.connectionState,
          hostId: posture.relayEnabled ? container.relayHostBroker.relayHostId : null,
        },
        scopes: SCOPES,
        /**
         * Actionable warnings. Surfaced prominently so an operator does not
         * have to read logs to discover an unsafe configuration.
         */
        warnings: buildWarnings(container, backend),
      };
      res.json(full);
    })();
  });

  /**
   * Current network exposure, plus everything the UI needs to explain it:
   * which addresses other devices would use, and what (if anything) is
   * blocking the server from being exposed.
   */
  router.get('/network-access', (req: Request, res: Response) => {
    void (async () => {
      const dataDir = dirname(resolve(container.config.dbPath));
      const mode = readExposureMode(dataDir);
      const base = {
        mode,
        /** What the server is doing right now, which may lag `mode` until a restart. */
        active: !posture.loopbackOnly,
        pendingRestart: (mode === 'network-accessible') !== !posture.loopbackOnly,
      };
      if (!seesSecurityDetail(req.principal)) {
        res.json({ detail: 'limited', ...base, blockers: [] } satisfies NetworkAccess);
        return;
      }
      const backend = await secretStore.backendInfo();
      const full: NetworkAccess = {
        detail: 'full',
        ...base,
        bindHost: posture.bindHost,
        /** Set in the environment, in which case the toggle cannot take effect. */
        envOverride: process.env['GENERATORAI_BIND_HOST'] ?? null,
        blockers: describeExposurePreconditions({
          unauthenticatedLoopback: posture.unauthenticatedLoopback,
          secretStoreSecure: backend.secure,
        }),
        endpoints: serverEndpoints({
          port: container.config.port,
          bindHost: posture.bindHost,
          tls: container.security.tls,
        }),
        /**
         * Built-in HTTPS for other devices (D-110). `null` while the listener is
         * loopback-only; `unavailableReason` says why an exposed server is not
         * serving it.
         */
        tls: container.security.tls
          ? { ...container.security.tls.status(), unavailableReason: null }
          : posture.loopbackOnly
            ? null
            : { enabled: false, unavailableReason: posture.tlsUnavailableReason },
        /** D-114 — whether X-Forwarded-Proto/Host are honoured, and from whom. */
        trustProxy: describeTrustProxy(),
      };
      res.json(full);
    })();
  });

  /**
   * "Connect with Tailscale" (D-123): what Tailscale on this machine reports
   * and whether `https://<machine>.<tailnet>.ts.net` serves this server. The
   * name and tailnet identify the machine, so a device without
   * `admin:settings` sees only on/off (D-120).
   */
  router.get('/tailscale', (req: Request, res: Response) => {
    void (async () => {
      const status = await container.tailscale.status();
      res.json(seesSecurityDetail(req.principal) ? status : limitedTailscaleStatus(status));
    })();
  });

  /**
   * Turns Tailscale access on (`tailscale serve --bg --https=443
   * http://127.0.0.1:<port>`) or off. 409 with the reason — and the status, so
   * the UI can show Tailscale's own "enable HTTPS" link — when it cannot.
   */
  router.post('/tailscale', (req: Request, res: Response) => {
    void (async () => {
      const parsed = tailscaleSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
        return;
      }
      if (!parsed.data.enabled) {
        const status = await container.tailscale.disconnect();
        container.security.audit.record({
          action: 'settings.updated',
          result: 'success',
          ...(req.principal ? { principal: req.principal } : {}),
          resourceType: 'security',
          resourceId: 'tailscale-access',
          metadata: { enabled: false },
          severity: 'warn',
        });
        res.json(status);
        return;
      }
      const result = await container.tailscale.connect({ replace: parsed.data.replace === true });
      container.security.audit.record({
        action: 'settings.updated',
        result: result.ok ? 'success' : 'failure',
        ...(req.principal ? { principal: req.principal } : {}),
        resourceType: 'security',
        resourceId: 'tailscale-access',
        metadata: result.ok
          ? { enabled: true, origin: result.status.origin }
          : { enabled: true, code: result.code },
        severity: 'warn',
      });
      if (result.ok) {
        res.json(result.status);
        return;
      }
      res.status(409).json({ error: { code: result.code, message: result.message, tailscale: result.status } });
    })();
  });

  /**
   * Serve an admin-supplied certificate instead of the generated one (D-113).
   * Validated before it is stored: it must match its key, be a server
   * certificate valid now, and name this computer.
   */
  router.put('/tls/certificate', (req: Request, res: Response) => {
    void (async () => {
      const tls = container.security.tls;
      if (!tls) {
        res.status(409).json({
          error: {
            code: 'TLS_NOT_ACTIVE',
            message: 'Turn on Network exposure first — a certificate is only served to other devices.',
          },
        });
        return;
      }
      const parsed = customCertificateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
        return;
      }
      try {
        const status = await tls.installCustomCertificate(parsed.data.certificatePem, parsed.data.privateKeyPem);
        container.security.audit.record({
          action: 'settings.updated',
          result: 'success',
          ...(req.principal ? { principal: req.principal } : {}),
          resourceType: 'security',
          resourceId: 'tls-certificate',
          metadata: { source: 'custom', fingerprintSha256: status.fingerprintSha256, names: status.names },
          severity: 'warn',
        });
        res.json({ tls: { ...status, unavailableReason: null } });
      } catch (err) {
        if (err instanceof CustomCertificateError) {
          res.status(400).json({ error: { code: err.code, message: err.message } });
          return;
        }
        res.status(400).json({
          error: { code: 'INVALID_CERTIFICATE', message: err instanceof Error ? err.message : String(err) },
        });
      }
    })();
  });

  /** Go back to the generated certificate. */
  router.delete('/tls/certificate', (req: Request, res: Response) => {
    void (async () => {
      const tls = container.security.tls;
      if (!tls) {
        res.status(409).json({ error: { code: 'TLS_NOT_ACTIVE', message: 'This server is not serving HTTPS.' } });
        return;
      }
      const status = await tls.removeCustomCertificate();
      container.security.audit.record({
        action: 'settings.updated',
        result: 'success',
        ...(req.principal ? { principal: req.principal } : {}),
        resourceType: 'security',
        resourceId: 'tls-certificate',
        metadata: { source: 'generated', fingerprintSha256: status.fingerprintSha256 },
        severity: 'warn',
      });
      res.json({ tls: { ...status, unavailableReason: null } });
    })();
  });

  /**
   * Changes network exposure. Requires `admin:settings` via ROUTE_POLICIES.
   *
   * Persists only — it deliberately does not try to rebind the running
   * listener. The bind address is an input to the startup security gates
   * (unauthenticated-mode refusal, secret-store strength), and those are
   * resolved once when the security context is built. Re-deriving them live
   * would mean rebuilding auth mid-flight, where a partial failure could leave
   * the process listening on a routable interface with the loopback posture
   * still in effect. A restart re-runs every gate from scratch.
   */
  router.post('/network-access', (req: Request, res: Response) => {
    void (async () => {
      const parsed = networkAccessSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
        return;
      }

      const { mode } = parsed.data;

      if (mode === 'network-accessible') {
        const backend = await secretStore.backendInfo();
        const blockers = describeExposurePreconditions({
          unauthenticatedLoopback: posture.unauthenticatedLoopback,
          secretStoreSecure: backend.secure,
        });
        // Refuse up front rather than persisting a mode that would make the
        // next start throw StartupSecurityError — that failure would surface
        // as a server that simply will not come back.
        if (blockers.length > 0) {
          res.status(409).json({
            error: {
              code: 'EXPOSURE_PRECONDITION_FAILED',
              message: blockers.map((blocker) => blocker.message).join(' '),
              blockers,
            },
          });
          return;
        }
      }

      try {
        writeExposureMode(dirname(resolve(container.config.dbPath)), mode);
      } catch (err) {
        res.status(500).json({
          error: {
            code: 'EXPOSURE_WRITE_FAILED',
            message: err instanceof Error ? err.message : String(err),
          },
        });
        return;
      }

      res.json({
        mode,
        pendingRestart: (mode === 'network-accessible') !== !posture.loopbackOnly,
        envOverride: process.env['GENERATORAI_BIND_HOST'] ?? null,
      });
    })();
  });

  return router;
}

/**
 * Whether a caller sees the configuration detail (D-120). No principal means
 * the dev unauthenticated-loopback mode, which already carries every scope.
 */
function seesSecurityDetail(principal: Principal | undefined): boolean {
  return !principal || principal.scopes.includes('admin:settings');
}

function buildWarnings(
  container: Container,
  backend: { kind: string; secure: boolean; reason?: string | undefined },
): { code: string; severity: 'warn' | 'critical'; message: string }[] {
  const warnings: { code: string; severity: 'warn' | 'critical'; message: string }[] = [];
  const { posture } = container.security;

  if (posture.unauthenticatedLoopback) {
    warnings.push({
      code: 'AUTH_DISABLED',
      severity: 'critical',
      message:
        'Authentication is disabled. Every request has full authority. ' +
        'Unset GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK.',
    });
  }
  if (!backend.secure) {
    warnings.push({
      code: 'INSECURE_SECRET_BACKEND',
      severity: 'critical',
      message:
        `Secrets are protected by "${backend.kind}", which is not OS-backed` +
        (backend.reason ? ` (${backend.reason})` : '') +
        '. Set GENERATORAI_SECRET_KEY or GENERATORAI_SECRET_PASSPHRASE.',
    });
  }
  if (posture.legacyApiKeyActive) {
    warnings.push({
      code: 'LEGACY_API_KEY',
      severity: 'warn',
      message:
        'GENERATORAI_API_KEY is set. It is a full-authority shared credential with no ' +
        'per-device revocation. Pair devices instead and remove it.',
    });
  }
  if (!posture.loopbackOnly) {
    warnings.push({
      code: 'NON_LOOPBACK_BIND',
      severity: 'warn',
      message: container.security.tls
        ? `This server is reachable on ${posture.bindHost}. Other devices connect over HTTPS and must pair.`
        : `This server is reachable on ${posture.bindHost} over plain HTTP. ` +
          (posture.tlsUnavailableReason ?? 'Ensure TLS terminates in front of it.'),
    });
  }
  if (posture.relayEnabled) {
    warnings.push({
      code: 'RELAY_CLIENT_UNAVAILABLE',
      severity: 'warn',
      message:
        'The relay host is configured, but client relay transport is not available yet. ' +
        'Pairing codes currently include direct endpoints only.',
    });
  }
  return warnings;
}

function describeTrustProxy(): { mode: 'off' | 'loopback' | 'addresses'; addresses: string[] } {
  const policy = trustProxyPolicy();
  return { mode: policy.mode, addresses: policy.mode === 'addresses' ? [...policy.addresses] : [] };
}
