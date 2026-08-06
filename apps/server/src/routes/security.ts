// ────────────────────────────────────────────────────────────────
// /api/security — posture, secret-backend diagnostics, relay status.
//
// This exists because of the plan's "make security behaviour observable" rule
// (§32.15): a user must be able to see which secret backend, transport, host
// identity and scopes are actually in effect — not guess from documentation.
//
// Read is `read:status`; anything that changes state requires `admin:settings`
// (see ROUTE_POLICIES). No endpoint here ever returns secret material.
// ────────────────────────────────────────────────────────────────

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { dirname, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { SCOPES } from '@generatorai/auth';
import type { Container } from '../composition-root.js';
import { resolveAdvertisedEndpoints } from '../network/advertisedEndpoints.js';
import {
  describeExposurePreconditions,
  readExposureMode,
  writeExposureMode,
} from '../network/exposure.js';

const networkAccessSchema = z.object({
  mode: z.enum(['local-only', 'network-accessible']),
});

export function createSecurityRoutes(container: Container): Router {
  const router = Router();
  const { posture, identity, secretStore, deviceRepo } = container.security;

  /** Effective security posture. Safe to render in the settings UI. */
  router.get('/posture', (_req: Request, res: Response) => {
    void (async () => {
      const backend = await secretStore.backendInfo();
      const devices = await deviceRepo.list();
      const active = devices.filter((d) => d.revokedAt == null);
      res.json({
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
      });
    })();
  });

  /**
   * Current network exposure, plus everything the UI needs to explain it:
   * which addresses other devices would use, and what (if anything) is
   * blocking the server from being exposed.
   */
  router.get('/network-access', (_req: Request, res: Response) => {
    void (async () => {
      const backend = await secretStore.backendInfo();
      const dataDir = dirname(resolve(container.config.dbPath));
      const mode = readExposureMode(dataDir);
      res.json({
        mode,
        /** What the server is doing right now, which may lag `mode` until a restart. */
        active: !posture.loopbackOnly,
        pendingRestart: (mode === 'network-accessible') !== !posture.loopbackOnly,
        bindHost: posture.bindHost,
        /** Set in the environment, in which case the toggle cannot take effect. */
        envOverride: process.env['GENERATORAI_BIND_HOST'] ?? null,
        blockers: describeExposurePreconditions({
          unauthenticatedLoopback: posture.unauthenticatedLoopback,
          secretStoreSecure: backend.secure,
        }),
        endpoints: resolveAdvertisedEndpoints({
          port: container.config.port,
          bindHost: posture.bindHost,
          networkInterfaces: networkInterfaces(),
        }),
      });
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
      message:
        `This server is reachable on ${posture.bindHost}. Ensure TLS terminates in front of it ` +
        'or that clients connect over SSH/relay.',
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
