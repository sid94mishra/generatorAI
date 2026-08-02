// ────────────────────────────────────────────────────────────────
// Test security context — a real-shaped `SecurityContext` for route tests.
//
// Route tests exercise handlers, not authentication, so this context resolves
// every `/api` request to a full-scope local principal — exactly what a dev
// server with `GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK=1` produces.
//
// It is deliberately NOT a bare `{}`: `createApp` must keep going through the
// real `createAuthMiddleware`, so a route that forgets its scope policy still
// fails closed in tests the same way it would in production.
//
// Auth *behaviour* is covered separately by `agent-tests/security-e2e.mjs`,
// which drives a real server with a real vault, real DPoP proofs and real
// device revocation.
// ────────────────────────────────────────────────────────────────

import { vi } from 'vitest';
import { ALL_SCOPES, type Principal } from '@generatorai/auth';
import type { SecurityContext } from '../../src/composition/security.js';

/** The principal every request in a route test resolves to. */
export const TEST_PRINCIPAL: Principal = {
  type: 'local-desktop',
  id: 'test-local',
  displayName: 'Route test principal',
  scopes: [...ALL_SCOPES],
  transport: 'loopback',
  unauthenticated: true,
};

export function createTestSecurityContext(
  overrides: Partial<SecurityContext> = {},
): SecurityContext {
  const audit = {
    record: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
  };

  return {
    secretStore: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
      getOrCreateRandom: vi.fn().mockResolvedValue(new Uint8Array(32)),
      backendInfo: vi
        .fn()
        .mockResolvedValue({ kind: 'test', secure: true, supportsRotation: false }),
    },
    auth: {
      authenticate: vi.fn().mockResolvedValue(TEST_PRINCIPAL),
      issueStreamTicket: vi
        .fn()
        .mockResolvedValue({ ticket: 'test-ticket', expiresAt: Date.now() + 30_000 }),
      isLegacyKeyConfigured: false,
    },
    audit,
    devices: {
      createPairingGrant: vi.fn(),
      completePairing: vi.fn(),
      listDevices: vi.fn().mockResolvedValue([]),
      listPendingPairings: vi.fn().mockResolvedValue([]),
      revokeDevice: vi.fn(),
      getDevice: vi.fn().mockResolvedValue(null),
    },
    identity: {
      hostId: 'test-host-id-0000000000000000000000000000',
      publicKey: new Uint8Array(32),
      publicKeyBase64Url: 'A'.repeat(43),
      secretKey: new Uint8Array(32),
    },
    posture: {
      bindHost: '127.0.0.1',
      loopbackOnly: true,
      production: false,
      authenticationRequired: false,
      unauthenticatedLoopback: true,
      secretBackend: { kind: 'test', secure: true },
      legacyApiKeyActive: false,
      relayEnabled: false,
      tokenAudience: 'test',
    },
    deviceRepo: { list: vi.fn().mockResolvedValue([]) },
    pairingRepo: {
      listPending: vi.fn().mockResolvedValue([]),
      revoke: vi.fn().mockResolvedValue(undefined),
    },
    shutdown: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as SecurityContext;
}
