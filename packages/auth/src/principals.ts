// ────────────────────────────────────────────────────────────────
// Principals — who is making a request.
//
// Five planes (plan §8.1): human identity, device identity, harness
// credentials, integration credentials and transport. This file models the
// first two; the rest never authenticate a caller.
// ────────────────────────────────────────────────────────────────

import type { Scope } from './scopes.js';

export type PrincipalType =
  /** Trusted in-process/loopback desktop shell. */
  | 'local-desktop'
  /** Browser, mobile or CLI holding a device keypair. */
  | 'paired-device'
  /** OAuth/OIDC-authenticated human session (Phase 7). */
  | 'user-session'
  /** CI / automation / webhook client, incl. the legacy global API key. */
  | 'service-account'
  /** Short-lived, resource-scoped share link. */
  | 'signed-link'
  /** Relay connector and other internal runtime components. */
  | 'internal-service';

export type TransportKind = 'loopback' | 'lan' | 'ssh' | 'relay' | 'embedded';

export interface Principal {
  type: PrincipalType;
  /** Stable subject id: device id, service-account id, or `local`. */
  id: string;
  /** Human-facing label for audit + device lists. */
  displayName?: string;
  scopes: readonly Scope[];
  /** Present for `paired-device`. */
  deviceId?: string;
  /** Owning human, when identity is modelled (Phase 7). */
  ownerId?: string;
  /** JWK thumbprint the credential is bound to (`cnf.jkt`). */
  keyThumbprint?: string;
  /** Credential generation — bumped on rotation so old tokens stop working. */
  sessionVersion?: number;
  /** How the request reached us. Recorded for audit; never grants authority. */
  transport: TransportKind;
  /** Resource the principal is pinned to (signed links). */
  resource?: { type: string; id: string };
  /**
   * How the credential was presented. `stream-ticket` and `signed-link`
   * credentials are terminal: they must never be usable to mint another
   * credential, or a single leak becomes an endless chain.
   */
  credentialKind?: 'access-token' | 'service-account' | 'stream-ticket' | 'signed-link' | 'none';
  /** True when authentication was skipped because of an explicit dev override. */
  unauthenticated?: boolean;
}

/** True when this principal may mint short-lived derived credentials. */
export function canMintDerivedCredentials(principal: Principal): boolean {
  return principal.credentialKind !== 'stream-ticket' && principal.credentialKind !== 'signed-link';
}

export function isAdminCapable(principal: Principal): boolean {
  return principal.scopes.some((s) => s.startsWith('admin:'));
}

/** The always-allowed in-process principal used by the SDK / embedded mode. */
export function embeddedPrincipal(scopes: readonly Scope[]): Principal {
  return {
    type: 'internal-service',
    id: 'embedded',
    displayName: 'Embedded SDK',
    scopes,
    transport: 'embedded',
  };
}
