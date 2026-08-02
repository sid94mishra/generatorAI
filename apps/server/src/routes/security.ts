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
import { SCOPES } from '@generatorai/auth';
import type { Container } from '../composition-root.js';

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
  return warnings;
}
